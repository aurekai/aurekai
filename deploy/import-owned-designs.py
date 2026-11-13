#!/usr/bin/env python3
"""Import business-owned Stitch fingerprints into exactly the Aurekai CMS namespace.

The native BonfyreCMS remains the schema, SQL transaction and authority owner.
This tool compares the 97 reviewed/observed records to the destination before
any write, skips exact matches, and refuses conflicts. No effect or release.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import runpy
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "sites/design/stitch-fingerprints.jsonl"
FIELDS = ("fingerprint_id", "template", "reference_source", "reference_name",
          "status", "family", "renderer_affinity", "density", "visual_vector",
          "acceptance_contract", "cannot_infer")


def source_records() -> dict[str, dict]:
    # One validation owner, used by the CLI resolver and this installer.
    check = runpy.run_path(str(ROOT / "scripts/check-stitch-references.py"),
                          run_name="stitch_reference_library")
    return {r["fingerprint_id"]: r for r in check["load_and_verify"](SOURCE)}


def read_installed(db: Path, namespace: str) -> dict[str, dict]:
    uri = "file:" + quote(str(db.resolve()), safe="/") + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        conn.row_factory = sqlite3.Row
        cols = {row[1] for row in conn.execute("PRAGMA table_info(design_fingerprint)")}
        if not set(FIELDS + ("namespace",)).issubset(cols):
            raise ValueError("native design_fingerprint schema is absent or incomplete")
        sql = "SELECT " + ",".join(FIELDS) + " FROM design_fingerprint WHERE namespace=?"
        rows = {}
        for record in conn.execute(sql, (namespace,)):
            row = dict(record)
            if row["fingerprint_id"] in rows:
                raise ValueError("duplicate installed source fingerprint identity")
            if isinstance(row["visual_vector"], str):
                row["visual_vector"] = json.loads(row["visual_vector"])
            rows[row["fingerprint_id"]] = row
        return rows


def delta(source: dict, installed: dict) -> list[dict]:
    missing = []
    for fingerprint, row in source.items():
        prior = installed.get(fingerprint)
        if prior is None:
            missing.append(row)
            continue
        for field in FIELDS:
            if row[field] != prior[field]:
                raise ValueError(
                    f"source revision differs from installed {fingerprint}: {field}; "
                    "review the destination before an explicit update"
                )
    return missing


def import_checked(args: argparse.Namespace) -> None:
    if args.namespace != "aurekai":
        raise ValueError("business reference import must name exactly the aurekai CMS namespace")
    db = Path(args.db).resolve()
    if not db.is_file():
        raise ValueError("CMS target database must already exist")
    source = source_records()
    if len(source) != 97:
        raise ValueError("Stitch source cohort is not pinned")
    lock_path = db.with_name("." + db.name + ".aurekai-stitch.lock")
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        before = read_installed(db, args.namespace)
        missing = delta(source, before)
        print(f"AUREKAI_DESIGN_PLAN observations={len(source)} present={len(source)-len(missing)} "
              f"missing={len(missing)} namespace={args.namespace}", flush=True)
        if not args.apply or not missing:
            return
        cms = Path(args.cms).resolve() if args.cms else None
        schemas = Path(args.schemas).resolve() if args.schemas else None
        if not cms or not cms.is_file() or not os.access(cms, os.X_OK) or \
           not schemas or not schemas.is_dir():
            raise ValueError("apply requires exact native CMS executable and schema directory")
        with tempfile.TemporaryDirectory(prefix="aurekai-stitch-import-") as folder:
            selected = Path(folder) / "missing.jsonl"
            selected.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n"
                                        for row in missing), encoding="utf-8")
            process = subprocess.run(
                [str(cms), "entry", "import-jsonl", "design_fingerprint", str(selected),
                 "--ns", args.namespace, "--db", str(db), "--schemas", str(schemas)],
                text=True, capture_output=True
            )
            if process.returncode:
                raise RuntimeError("native CMS rejected reviewed design cohort: "
                                   + process.stderr.strip()[:1000])
        after = read_installed(db, args.namespace)
        if delta(source, after):
            raise RuntimeError("CMS import acknowledged without complete tenant readback")
        print(f"AUREKAI_DESIGN_IMPORT_VERIFIED observations={len(source)} "
              f"created={len(missing)} namespace={args.namespace}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile exact Aurekai Stitch references")
    parser.add_argument("--db", required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--cms")
    parser.add_argument("--schemas")
    parser.add_argument("--apply", action="store_true")
    try:
        import_checked(parser.parse_args())
        return 0
    except (ValueError, RuntimeError, OSError, sqlite3.Error, json.JSONDecodeError) as exc:
        print(f"AUREKAI_DESIGN_IMPORT_REFUSED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
