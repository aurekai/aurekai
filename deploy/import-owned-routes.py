#!/usr/bin/env python3
"""Reconcile Aurekai-owned route presentation rows into one explicit native CMS.
The source and live CMS are compared before any write. Already-imported rows
remain untouched; changed/foreign rows refuse instead of overwriting owners.
No deployment, publication activation, provider effects, or DNS action.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import quote

IDENTITY = ("territory", "route", "when_query_key")
FIELDS = ("territory", "route", "when_query_key", "pattern", "template",
          "status", "reference_source", "cannot_infer")
NS = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


def read_source(path: Path) -> dict[tuple[str, str, str], dict]:
    rows = {}
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        row = json.loads(raw)
        if not isinstance(row, dict) or not isinstance(row.get("territory"), str) or \
           not isinstance(row.get("route"), str) or not row["route"].startswith("/") or \
           not isinstance(row.get("pattern"), str) or not isinstance(row.get("status"), str):
            raise ValueError(f"invalid route_presentation line {n}")
        if set(row) - set(FIELDS):
            raise ValueError(f"undeclared route field at line {n}")
        key = tuple((row.get(field) or "") for field in IDENTITY)
        if key in rows:
            raise ValueError(f"duplicate source key at line {n}: {key!r}")
        rows[key] = row
    if not rows:
        raise ValueError("empty source cohort")
    return rows


def verify_hosts(path: Path, ns: str, source: dict) -> None:
    territory_owners = {}
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split()
        if len(fields) != 4:
            raise ValueError(f"host binding at line {n} lacks exact CMS owner")
        territory, public_host, account_host, owner = fields
        if territory in territory_owners or owner != ns or public_host == account_host:
            raise ValueError(f"host map missing/mismatched CMS owner at line {n}")
        territory_owners[territory] = owner
    if set(territory_owners) != {"work", "life", "live", "shop"}:
        raise ValueError("Aurekai host map must name its four exact territories")
    if {key[0] for key in source} - territory_owners.keys():
        raise ValueError("route references undeclared tenant territory")


def read_installed(dbpath: Path, ns: str) -> dict[tuple[str, str, str], dict]:
    uri = "file:" + quote(str(dbpath.resolve()), safe="/") + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        conn.row_factory = sqlite3.Row
        cols = {row[1] for row in conn.execute("PRAGMA table_info(route_presentation)")}
        if not set(FIELDS + ("namespace",)).issubset(cols):
            raise ValueError("native CMS route_presentation table/schema missing or incomplete")
        sql = "SELECT " + ",".join(FIELDS) + " FROM route_presentation WHERE namespace=?"
        rows = {}
        for record in conn.execute(sql, (ns,)):
            row = dict(record)
            key = tuple((row.get(field) or "") for field in IDENTITY)
            if key in rows:
                raise ValueError(f"duplicate installed CMS route key: {key!r}")
            rows[key] = row
    return rows


def normalized(row: dict) -> dict:
    return {field: row.get(field) or "" for field in FIELDS}


def plan(source: dict, installed: dict) -> list[dict]:
    extras = installed.keys() - source.keys()
    if extras:
        raise ValueError(f"CMS has {len(extras)} routes absent from owned source: "
                         + repr(sorted(extras)[:4]))
    missing = []
    for key, row in source.items():
        current = installed.get(key)
        if current is None:
            missing.append(row)
        elif normalized(row) != normalized(current):
            raise ValueError(f"CMS route changed outside owner-reviewed source: {key!r}")
    return missing


def reconcile(args: argparse.Namespace) -> None:
    if not NS.fullmatch(args.namespace) or args.namespace != "aurekai":
        raise ValueError("Aurekai import requires the exact company CMS namespace")
    dbpath = Path(args.db).resolve()
    if not dbpath.is_file():
        raise ValueError("named CMS database must already exist")
    source = read_source(Path(args.source).resolve())
    verify_hosts(Path(args.hosts).resolve(), args.namespace, source)

    # Serialize our own installs on a given CMS database without modifying
    # native CMS state. Native CMS still enforces its independent authority.
    lockfile = dbpath.with_name("." + dbpath.name + ".aurekai-routes.lock")
    fd = os.open(str(lockfile), os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "r+") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            installed = read_installed(dbpath, args.namespace)
            missing = plan(source, installed)
            print(f"AUREKAI_ROUTE_PLAN total={len(source)} existing={len(installed)} "
                  f"missing={len(missing)} namespace={args.namespace}", flush=True)
            if not args.apply or not missing:
                return
            cms = Path(args.cms).resolve() if args.cms else None
            schemas = Path(args.schemas).resolve() if args.schemas else None
            if not cms or not cms.is_file() or not os.access(cms, os.X_OK) or \
               not schemas or not schemas.is_dir():
                raise ValueError("apply requires exact executable native CMS and schema directory")
            # A native create-jsonl generation is transactional. Submit only
            # rows missing from the reviewed company source, not its full cohort.
            with tempfile.TemporaryDirectory(prefix="aurekai-routes-") as folder:
                selection = Path(folder) / "missing.jsonl"
                selection.write_text("".join(json.dumps(row, separators=(",", ":"))
                                             + "\n" for row in missing), encoding="utf-8")
                proc = subprocess.run(
                    [str(cms), "entry", "import-jsonl", "route_presentation",
                     str(selection), "--ns", args.namespace, "--db", str(dbpath),
                     "--schemas", str(schemas)], text=True, capture_output=True)
                if proc.returncode:
                    raise RuntimeError("native CMS rejected missing-row transaction: "
                                       + proc.stderr.strip()[:1200])
            current = read_installed(dbpath, args.namespace)
            if plan(source, current):
                raise RuntimeError("native import returned without complete company readback")
            print(f"AUREKAI_ROUTE_IMPORT_VERIFIED rows={len(current)} created={len(missing)} "
                  f"namespace={args.namespace}", flush=True)
    except Exception:
        # fdopen owns the descriptor after entry. Do not unlock a different owner.
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Aurekai-owned native CMS route reconciliation")
    parser.add_argument("--source", required=True)
    parser.add_argument("--hosts", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--cms")
    parser.add_argument("--schemas")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        reconcile(args)
        return 0
    except (OSError, ValueError, RuntimeError, sqlite3.Error, json.JSONDecodeError) as error:
        print("AUREKAI_ROUTE_REFUSED: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
