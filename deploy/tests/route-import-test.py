#!/usr/bin/env python3
"""Exercise real SQLite cohort planning and the native CMS argv boundary.
Mock CMS is an isolated test double; the engine's C importer is tested separately.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PROGRAM = ROOT / "deploy/import-owned-routes.py"
SOURCE = ROOT / "sites/presentation/route-presentation.jsonl"
HOSTS = ROOT / "deploy/tenant-hosts.tsv"
FIELDS = ("territory", "route", "when_query_key", "pattern", "template",
          "status", "reference_source", "cannot_infer")
MOCK = r'''#!/usr/bin/env python3
import json, os, sqlite3, sys
args = sys.argv[1:]
assert args[:3] == ["entry","import-jsonl","route_presentation"],args
ns=args[args.index("--ns")+1]
db=args[args.index("--db")+1]
assert ns=="aurekai"
source=args[3]
if os.environ.get("MOCK_CMS_FAIL") == "1":
    sys.exit(2)
names=("territory","route","when_query_key","pattern","template","status","reference_source","cannot_infer")
rows=[json.loads(x) for x in open(source, encoding="utf-8") if x.strip()]
with sqlite3.connect(db) as conn:
    for row in rows:
        conn.execute("INSERT INTO route_presentation(namespace," + ",".join(names) + ") "
                     "VALUES (" + ",".join("?" for _ in range(len(names)+1)) + ")",
                     [ns]+[row.get(k) for k in names])
with open(os.environ["MOCK_CMS_CALLS"],"a",encoding="utf-8") as log:
    log.write(str(len(rows))+"\n")
print('{"imported":' + str(len(rows)) + '}')
'''


def call(path: Path, db: Path, source: Path, mock: Path, schemas: Path,
         hosts: Path = HOSTS, namespace: str = "aurekai", apply: bool = True,
         env: dict | None = None) -> subprocess.CompletedProcess:
    args = [sys.executable, str(path), "--source", str(source),
            "--hosts", str(hosts), "--db", str(db), "--namespace", namespace,
            "--cms", str(mock), "--schemas", str(schemas)]
    if apply:
        args.append("--apply")
    return subprocess.run(args, text=True, capture_output=True, env=env, check=False)


def count(db: Path, namespace: str = "aurekai") -> int:
    with sqlite3.connect(db) as con:
        return con.execute("SELECT count(*) FROM route_presentation WHERE namespace=?",
                           (namespace,)).fetchone()[0]


def verify() -> None:
    with tempfile.TemporaryDirectory(prefix="aurekai-route-test-") as dirname:
        folder = Path(dirname)
        db = folder / "cms.db"
        schemas = folder / "schemas"
        schemas.mkdir()
        mock = folder / "mock-cms"
        mock.write_text(MOCK, encoding="utf-8")
        mock.chmod(0o755)
        calls = folder / "calls.log"
        env = {**os.environ, "MOCK_CMS_CALLS": str(calls)}
        with sqlite3.connect(db) as con:
            con.execute("CREATE TABLE route_presentation(id INTEGER PRIMARY KEY, "
                        "namespace TEXT," +
                        ",".join(field + " TEXT" for field in FIELDS) + ")")
            first = json.loads(SOURCE.read_text().splitlines()[0])
            con.execute(
                "INSERT INTO route_presentation(namespace," + ",".join(FIELDS) + ") "
                "VALUES (" + ",".join("?" for _ in range(len(FIELDS) + 1)) + ")",
                ["root"] + [first.get(field) if field != "pattern" else "root-owner"
                            for field in FIELDS])

        current = call(PROGRAM, db, SOURCE, mock, schemas, env=env)
        assert current.returncode == 0, current.stderr
        assert "total=95 existing=0 missing=95" in current.stdout
        assert "AUREKAI_ROUTE_IMPORT_VERIFIED rows=95 created=95" in current.stdout
        assert count(db) == 95 and count(db, "root") == 1
        initial = calls.read_text()
        assert initial == "95\n"

        repeat = call(PROGRAM, db, SOURCE, mock, schemas, env=env)
        assert repeat.returncode == 0 and "existing=95 missing=0" in repeat.stdout
        assert calls.read_text() == initial, "rerun must never invoke CMS create"
        assert count(db) == 95

        no_write = call(PROGRAM, db, SOURCE, mock, schemas, apply=False, env=env)
        assert no_write.returncode == 0 and calls.read_text() == initial

        source_rows = [json.loads(line) for line in SOURCE.read_text().splitlines() if line.strip()]
        edited = folder / "changed.jsonl"
        source_rows[0]["pattern"] = "wrong-review-variation"
        edited.write_text("".join(json.dumps(x) + "\n" for x in source_rows))
        conflict = call(PROGRAM, db, edited, mock, schemas, env=env)
        assert conflict.returncode != 0 and "changed outside owner-reviewed source" in conflict.stderr
        assert count(db) == 95 and calls.read_text() == initial

        dupe = folder / "duplicate.jsonl"
        dupe.write_text(SOURCE.read_text() + json.dumps(source_rows[0]) + "\n")
        bad = call(PROGRAM, db, dupe, mock, schemas, env=env)
        assert bad.returncode != 0 and "duplicate source" in bad.stderr

        unowned_hosts = folder / "unowned.tsv"
        unowned_hosts.write_text(HOSTS.read_text().replace(" aurekai\n", "\n"))
        bad = call(PROGRAM, db, SOURCE, mock, schemas, hosts=unowned_hosts, env=env)
        assert bad.returncode != 0 and "lacks exact CMS owner" in bad.stderr
        bad = call(PROGRAM, db, SOURCE, mock, schemas, namespace="root", env=env)
        assert bad.returncode != 0 and "exact company CMS namespace" in bad.stderr

        appended = folder / "additional.jsonl"
        additional = {"territory": "work", "route": "/new-owned",
                      "pattern": "reader", "status": "draft"}
        appended.write_text(SOURCE.read_text().rstrip("\n") + "\n" + json.dumps(additional) + "\n")
        env_fail = {**env, "MOCK_CMS_FAIL": "1"}
        failed = call(PROGRAM, db, appended, mock, schemas, env=env_fail)
        assert failed.returncode != 0 and count(db) == 95
        extra = call(PROGRAM, db, appended, mock, schemas, env=env)
        assert extra.returncode == 0 and count(db) == 96
        assert calls.read_text() == "95\n1\n"
        again = call(PROGRAM, db, appended, mock, schemas, env=env)
        assert again.returncode == 0 and count(db) == 96

        with sqlite3.connect(db) as con:
            con.execute(
                "INSERT INTO route_presentation(namespace,territory,route,pattern,status)"
                " VALUES ('aurekai','work','/unexpected','reader','draft')")
        rejected = call(PROGRAM, db, appended, mock, schemas, env=env)
        assert rejected.returncode != 0 and "absent from owned source" in rejected.stderr
        assert count(db, "root") == 1 and calls.read_text() == "95\n1\n"
        print("AUREKAI_ROUTE_RECONCILE_PASS: full cohort, no-op rerun, isolated owner,"
              " source conflicts, missing rows, wrong owner and failure recovery")


if __name__ == "__main__":
    verify()
