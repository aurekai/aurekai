#!/usr/bin/env python3
"""Two real SQLite cohorts, one mock native create boundary per source family.
Verifies first import, no-write rerun, cross-tenant isolation and review refusal.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
RECONCILE=ROOT/"deploy/import-owned-presentations.py"
COHORTS={
  "territory_presentation":ROOT/"sites/content/territory-presentations.jsonl",
  "presentation_template":ROOT/"sites/presentation/presentation-template-stitch.jsonl",
}
CMS=r'''#!/usr/bin/env python3
import json,os,sqlite3,sys
a=sys.argv[1:]
assert a[:2]==["entry","import-jsonl"],a
kind=a[2]; path=a[3]; db=a[a.index("--db")+1]; ns=a[a.index("--ns")+1]
assert ns=="aurekai" and kind in ("territory_presentation","presentation_template"),a
if os.environ.get("MOCK_REJECT")=="1":sys.exit(2)
rows=[json.loads(line) for line in open(path,encoding="utf-8") if line.strip()]
with sqlite3.connect(db) as c:
    for row in rows:
        fields=list(row)
        c.execute("INSERT INTO "+kind+"(namespace,"+",".join(fields)+") VALUES ("+
                  ",".join("?" for _ in range(len(fields)+1))+")",
                  [ns]+[json.dumps(value) if isinstance(value,(list,dict)) else value
                        for value in row.values()])
with open(os.environ["MOCK_CALLS"],"a") as h:
    h.write(kind+":"+str(len(rows))+"\n")
'''

def execute(kind,db,cms,schemas,env,namespace="aurekai",apply=True):
    cmd=[sys.executable,str(RECONCILE),"--type",kind,"--namespace",namespace,
         "--db",str(db),"--cms",str(cms),"--schemas",str(schemas)]
    if apply:cmd.append("--apply")
    return subprocess.run(cmd,text=True,capture_output=True,env=env)

def nrows(db,kind,ns="aurekai"):
    with sqlite3.connect(db) as c:
        return c.execute("SELECT count(*) FROM "+kind+" WHERE namespace=?",(ns,)).fetchone()[0]

def exercise(kind,expected):
    original=[json.loads(x) for x in COHORTS[kind].read_text().splitlines() if x.strip()]
    assert len(original)==expected
    with tempfile.TemporaryDirectory(prefix="aurekai-owned-"+kind+"-") as temp:
        folder=Path(temp);db=folder/"cms.db";schemas=folder/"schema";schemas.mkdir()
        cms=folder/"mock-cms";cms.write_text(CMS);cms.chmod(0o755)
        log=folder/"calls.txt"
        env={**os.environ,"MOCK_CALLS":str(log)}
        fields=list(dict.fromkeys(key for row in original for key in row))
        with sqlite3.connect(db) as c:
            c.execute("CREATE TABLE "+kind+"(id INTEGER PRIMARY KEY,namespace TEXT,"
                      +",".join(x+" TEXT" for x in fields)+")")
            # Another institution can publish a row with the same key.
            row=original[0]
            c.execute("INSERT INTO "+kind+"(namespace,"+",".join(row)+") VALUES ("+
                      ",".join("?" for _ in range(len(row)+1))+")",
                      ["root"]+[json.dumps(v) if isinstance(v,(list,dict)) else v for v in row.values()])
        inserted=execute(kind,db,cms,schemas,env)
        assert inserted.returncode==0,inserted.stderr
        assert f"missing={expected}" in inserted.stdout
        assert nrows(db,kind)==expected and nrows(db,kind,"root")==1
        before=log.read_text()
        assert before==kind+":"+str(expected)+"\n"

        repeat=execute(kind,db,cms,schemas,env)
        assert repeat.returncode==0 and "missing=0" in repeat.stdout
        assert log.read_text()==before, "rerun attempted duplicate create"
        dry=execute(kind,db,cms,schemas,env,apply=False)
        assert dry.returncode==0 and log.read_text()==before

        key="territory" if kind=="territory_presentation" else "template"
        target=original[0][key]
        with sqlite3.connect(db) as c:
            c.execute("UPDATE "+kind+" SET status='draft' WHERE namespace=? AND "+key+"=?",
                      ("aurekai",target))
        conflict=execute(kind,db,cms,schemas,env)
        assert conflict.returncode!=0 and "review required" in conflict.stderr
        assert nrows(db,kind)==expected and log.read_text()==before
        with sqlite3.connect(db) as c:
            c.execute("UPDATE "+kind+" SET status=? WHERE namespace=? AND "+key+"=?",
                      (original[0]["status"],"aurekai",target))
        wrong=execute(kind,db,cms,schemas,env,namespace="root")
        assert wrong.returncode!=0 and "owner must be explicit" in wrong.stderr
        assert nrows(db,kind,"root")==1
        print("AUREKAI_PRESENTATION_RECONCILE_PASS",kind,expected)

if __name__=="__main__":
    for kind,expected in [("territory_presentation",4),("presentation_template",1)]:
        exercise(kind,expected)
