#!/usr/bin/env python3
"""Exercise reviewed reference import against real SQLite and a mock native CMS."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
CHECK=ROOT/"scripts/check-stitch-references.py"
IMPORT=ROOT/"deploy/import-owned-designs.py"
SOURCE=ROOT/"sites/design/stitch-fingerprints.jsonl"
FIELDS=("fingerprint_id","template","reference_source","reference_name",
        "status","family","renderer_affinity","density","visual_vector",
        "acceptance_contract","cannot_infer")
MOCK=r'''#!/usr/bin/env python3
import json, os, sqlite3, sys
args=sys.argv[1:]
assert args[:3]==["entry","import-jsonl","design_fingerprint"],args
ns=args[args.index("--ns")+1]
assert ns=="aurekai"
db=args[args.index("--db")+1]
if os.environ.get("FAIL_NATIVE_CMS")=="1":
    sys.exit("simulated native importer refusal")
with sqlite3.connect(db) as conn:
    rows=[json.loads(line) for line in open(args[3],encoding="utf-8") if line.strip()]
    for row in rows:
        keys=list(row)
        conn.execute("INSERT INTO design_fingerprint(namespace,"+",".join(keys)+") VALUES ("
                     +",".join("?" for _ in range(len(keys)+1))+")",
                     [ns]+[json.dumps(v) if isinstance(v,(dict,list)) else v
                           for v in row.values()])
with open(os.environ["MOCK_CMS_CALLS"],"a",encoding="utf-8") as f:
    f.write(str(len(rows))+"\n")
'''
def run(db,cms,schemas,env,ns="aurekai",apply=True):
    args=[sys.executable,str(IMPORT),"--db",str(db),"--namespace",ns,
          "--cms",str(cms),"--schemas",str(schemas)]
    if apply:args.append("--apply")
    return subprocess.run(args,capture_output=True,text=True,env=env)
def count(db,ns):
    with sqlite3.connect(db) as conn:
        return conn.execute("SELECT count(*) FROM design_fingerprint WHERE namespace=?",
                            (ns,)).fetchone()[0]

def main():
    source=[json.loads(x) for x in SOURCE.read_text(encoding="utf8").splitlines() if x.strip()]
    assert len(source)==97 and len(set(x["template"] for x in source))==91
    assert subprocess.run([sys.executable,str(CHECK)],capture_output=True).returncode==0
    with tempfile.TemporaryDirectory(prefix="aurekai-stitch-cms-") as folder:
        root=Path(folder)
        db=root/"cms.db"
        schemas=root/"schemas"
        schemas.mkdir()
        cms=root/"native-cms"
        cms.write_text(MOCK)
        cms.chmod(0o755)
        calls=root/"calls.log"
        env={**os.environ,"MOCK_CMS_CALLS":str(calls)}
        with sqlite3.connect(db) as conn:
            conn.execute("CREATE TABLE design_fingerprint(id INTEGER PRIMARY KEY,namespace TEXT,"
                         +",".join(field+" TEXT" for field in FIELDS)+")")
            # Existing distinct tenant material must remain unaffected.
            row=source[0].copy()
            row["fingerprint_id"]="ghost:existing-candidate"
            row["template"]="ghost-existing"
            keys=list(row)
            conn.execute("INSERT INTO design_fingerprint(namespace,"+",".join(keys)+") VALUES ("
                         +",".join("?" for _ in range(len(keys)+1))+")",
                         ["aurekai"]+[json.dumps(v) if isinstance(v,(dict,list)) else v
                                      for v in row.values()])
            conn.execute("INSERT INTO design_fingerprint(namespace,"+",".join(keys)+") VALUES ("
                         +",".join("?" for _ in range(len(keys)+1))+")",
                         ["root"]+[json.dumps(v) if isinstance(v,(dict,list)) else v
                                    for v in row.values()])
        preview=run(db,cms,schemas,env,apply=False)
        assert preview.returncode==0 and "missing=97" in preview.stdout,preview.stderr
        assert not calls.exists()
        first=run(db,cms,schemas,env)
        assert first.returncode==0,first.stderr
        assert "AUREKAI_DESIGN_IMPORT_VERIFIED observations=97 created=97" in first.stdout
        assert count(db,"aurekai")==98 and count(db,"root")==1
        assert calls.read_text()=="97\n"
        repeat=run(db,cms,schemas,env)
        assert repeat.returncode==0 and "missing=0" in repeat.stdout,repeat.stderr
        assert calls.read_text()=="97\n", "duplicate native create was invoked"
        assert count(db,"root")==1
        with sqlite3.connect(db) as conn:
            one=source[0]["fingerprint_id"]
            state=conn.execute("SELECT status FROM design_fingerprint "
                               "WHERE namespace='aurekai' AND fingerprint_id=?",(one,)).fetchone()[0]
            conn.execute("UPDATE design_fingerprint SET status='published' "
                         "WHERE namespace='aurekai' AND fingerprint_id=?",(one,))
        refuse=run(db,cms,schemas,env)
        assert refuse.returncode!=0 and "source revision differs" in refuse.stderr
        assert calls.read_text()=="97\n"
        with sqlite3.connect(db) as conn:
            conn.execute("UPDATE design_fingerprint SET status=? "
                         "WHERE namespace='aurekai' AND fingerprint_id=?",(state,one))
        assert run(db,cms,schemas,env,ns="root").returncode!=0
        # Existing status remains observational. The import is not a release.
        with sqlite3.connect(db) as conn:
            n=conn.execute("SELECT count(*) FROM design_fingerprint "
                           "WHERE namespace='aurekai' AND status='observed_reference'").fetchone()[0]
            excluded=conn.execute("SELECT count(*) FROM design_fingerprint "
                                  "WHERE namespace='aurekai' AND status='excluded_reference_folder'").fetchone()[0]
        assert n==6 and excluded==2
        print("AUREKAI_DESIGN_IMPORT_PASS observations=97 unique=91 "
              "root_preserved=1 ghost_preserved=1 duplicate_writes=0 visual_release=0")
if __name__=="__main__":
    main()
