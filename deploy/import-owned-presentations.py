#!/usr/bin/env python3
"""Owned CMS front-door and design-template reconciliation for the Aurekai tenant.
Existing identical rows are retained. Differences require review; only missing
records can be created through the real transactional native CMS importer.
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

KEYS = {"territory_presentation": "territory", "presentation_template": "template"}
REVIEWED_SOURCE = {
    "territory_presentation": "sites/content/territory-presentations.jsonl",
    "presentation_template": "sites/presentation/presentation-template-stitch.jsonl",
}
ROOT = Path(__file__).resolve().parents[1]
HOSTS = ROOT / "deploy/tenant-hosts.tsv"


def rows_from_source(kind: str) -> dict[str, dict]:
    path = ROOT / REVIEWED_SOURCE[kind]
    rows = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict) or not isinstance(row.get(KEYS[kind]), str) or \
           not row[KEYS[kind]] or not isinstance(row.get("status"), str):
            raise ValueError(f"invalid {kind} source row at line {number}")
        key = row[KEYS[kind]]
        if key in rows:
            raise ValueError(f"duplicate {kind} source key {key}")
        rows[key] = row
    if kind == "territory_presentation" and set(rows) != {"work", "life", "live", "shop"}:
        raise ValueError("front-door source requires four distinct Aurekai territories")
    if kind == "presentation_template" and len(rows) != 1:
        raise ValueError("Stitch template import must be a single reviewed choice")
    return rows


def verify_owner(ns: str) -> None:
    if ns != "aurekai":
        raise ValueError("Aurekai CMS owner must be explicit and exact")
    territories = set()
    for line in HOSTS.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 4 or parts[3] != ns or parts[0] in territories:
            raise ValueError("host map does not bind all sites to the requested CMS owner")
        territories.add(parts[0])
    if territories != {"work", "life", "live", "shop"}:
        raise ValueError("four-site tenant host map is incomplete")


def installed(db: Path, kind: str, ns: str) -> dict[str, dict]:
    uri = "file:" + quote(str(db.resolve()), safe="/") + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as con:
        con.row_factory = sqlite3.Row
        cols = {row[1] for row in con.execute(f"PRAGMA table_info({kind})")}
        if "namespace" not in cols or KEYS[kind] not in cols:
            raise ValueError(f"CMS {kind} schema is missing")
        rows = {}
        for record in con.execute(f"SELECT * FROM {kind} WHERE namespace=?", (ns,)):
            row = dict(record)
            key = row[KEYS[kind]]
            if key in rows:
                raise ValueError(f"duplicate installed {kind} key: {key}")
            for name in ("layout_tokens", "semantic_roles"):
                if isinstance(row.get(name), str):
                    try:
                        row[name] = json.loads(row[name])
                    except json.JSONDecodeError:
                        pass
            rows[key] = row
        return rows


def plan(kind: str, source: dict, database: dict) -> list[dict]:
    if kind == "territory_presentation":
        unexpected = set(database) - set(source)
        if unexpected:
            raise ValueError("unexpected front-door CMS owners: " + repr(sorted(unexpected)))
    missing = []
    for key, row in source.items():
        old = database.get(key)
        if old is None:
            missing.append(row)
            continue
        for field, value in row.items():
            if value != old.get(field):
                raise ValueError(f"review required for changed {kind} {key} field {field}")
    return missing


def reconcile(args: argparse.Namespace) -> None:
    kind, ns = args.type, args.namespace
    verify_owner(ns)
    db = Path(args.db).resolve()
    if not db.is_file():
        raise ValueError("explicit destination CMS database does not exist")
    source = rows_from_source(kind)
    lock_path = db.with_name("." + db.name + ".aurekai-presentations.lock")
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        before = installed(db, kind, ns)
        missing = plan(kind, source, before)
        print(f"AUREKAI_PRESENTATION_PLAN type={kind} reviewed={len(source)} "
              f"present={len(source)-len(missing)} missing={len(missing)} namespace={ns}", flush=True)
        if not args.apply or not missing:
            return
        cms = Path(args.cms).resolve() if args.cms else None
        schemas = Path(args.schemas).resolve() if args.schemas else None
        if not cms or not cms.is_file() or not os.access(cms, os.X_OK) or \
           not schemas or not schemas.is_dir():
            raise ValueError("write requires an explicit executable native CMS and schema directory")
        with tempfile.TemporaryDirectory(prefix="aurekai-presentation-") as folder:
            selected = Path(folder) / "reviewed.jsonl"
            selected.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n"
                                        for row in missing), encoding="utf-8")
            process = subprocess.run([str(cms), "entry", "import-jsonl", kind,
                                      str(selected), "--ns", ns, "--db", str(db),
                                      "--schemas", str(schemas)],
                                     text=True, capture_output=True)
            if process.returncode:
                raise RuntimeError("native CMS refused reviewed presentation: "
                                   + process.stderr.strip()[:1200])
        after = installed(db, kind, ns)
        if plan(kind, source, after):
            raise RuntimeError("CMS import acknowledged without verified owned records")
        print(f"AUREKAI_PRESENTATION_IMPORT_VERIFIED type={kind} created={len(missing)} "
              f"namespace={ns}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Institution-owned presentation import")
    parser.add_argument("--type", choices=tuple(KEYS), required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--cms")
    parser.add_argument("--schemas")
    parser.add_argument("--apply", action="store_true")
    try:
        reconcile(parser.parse_args())
        return 0
    except (OSError, ValueError, RuntimeError, sqlite3.Error, json.JSONDecodeError) as error:
        print("AUREKAI_PRESENTATION_REFUSED: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
