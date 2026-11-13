#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cmd="$root/deploy/install-owned-cms-content.sh"

# Both checks are read-only. They must succeed with no CMS or engine binaries.
sh "$cmd" check houses | grep -q 'AUREKAI_SOURCE_CHECK_PASS'
sh "$cmd" check work-examples | grep -q 'AUREKAI_SOURCE_CHECK_PASS'
sh "$cmd" check front-doors | grep -q 'AUREKAI_SOURCE_CHECK_PASS'
sh "$cmd" check route-presentations | grep -q 'AUREKAI_SOURCE_CHECK_PASS'
sh "$cmd" check stitch-template | grep -q 'AUREKAI_SOURCE_CHECK_PASS'

# Applying content without an explicit authorized database and binary must fail.
if (unset BONFYRE_CMS_DB BONFYRE_CMS_BINARY; sh "$cmd" apply houses) >"$tmp/refused" 2>&1; then
    echo "FAIL: implicit CMS database or credentials admitted" >&2; exit 1
fi

touch "$tmp/cms.db" "$tmp/house-installer.mjs" "$tmp/authored-installer.mjs"
mkdir "$tmp/schemas"
cat > "$tmp/cms-binary" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$OWNED_SOURCE_INVOKE_LOG"
EOF
cat > "$tmp/mock-bun" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$OWNED_SOURCE_INVOKE_LOG"
EOF
cat > "$tmp/work-installer.sh" <<'EOF'
#!/bin/sh
printf 'examples=%s\nprograms=%s\ndb=%s\n' \
 "$BONFYRE_WORK_EXAMPLES" "$BONFYRE_WORK_EXAMPLE_PROGRAMS" "$1" > "$OWNED_SOURCE_INVOKE_LOG"
EOF
chmod +x "$tmp/cms-binary" "$tmp/mock-bun"
export BONFYRE_CMS_DB="$tmp/cms.db"
export BONFYRE_CMS_BINARY="$tmp/cms-binary"
export BONFYRE_HOUSES_INSTALLER="$tmp/house-installer.mjs"
export BONFYRE_AUTHORED_ROWS_INSTALLER="$tmp/authored-installer.mjs"
export BONFYRE_CMS_NAMESPACE="aurekai"
export BONFYRE_CMS_SCHEMAS="$tmp/schemas"
export BONFYRE_WORK_EXAMPLES_INSTALLER="$tmp/work-installer.sh"
export BONFYRE_BUN_BIN="$tmp/mock-bun"
export OWNED_SOURCE_INVOKE_LOG="$tmp/invocation.log"

# The company wrapper must not write into root when the institution selection
# is missing or malformed, even if the file and CMS binary exist.
if (unset BONFYRE_CMS_NAMESPACE; sh "$cmd" apply houses) >"$tmp/refused-ns" 2>&1; then
    echo "FAIL: implicit root namespace was admitted" >&2; exit 1
fi
if BONFYRE_CMS_NAMESPACE="bad'institution" sh "$cmd" apply work-examples >"$tmp/refused-unsafe" 2>&1; then
    echo "FAIL: unsafe namespace was admitted" >&2; exit 1
fi
sh "$cmd" apply houses
grep -Fq "$root/sites/content/territory-houses.json" "$tmp/invocation.log"
grep -Fq -- '--db' "$tmp/invocation.log"
grep -Fq "$tmp/cms.db" "$tmp/invocation.log"
grep -Fq "$tmp/cms-binary" "$tmp/invocation.log"
grep -Fxq -- '--ns' "$tmp/invocation.log"
grep -Fxq 'aurekai' "$tmp/invocation.log"

# The canonical CMS target is already filled with the reviewed source cohorts.
# All three presentation imports must verify existing records and do zero writes.
python3 - "$tmp/cms.db" "$root" <<'PY'
import json, sqlite3, sys
db, root = sys.argv[1:]
from pathlib import Path
root = Path(root)
files = [
  ("territory_presentation",root/"sites/content/territory-presentations.jsonl"),
  ("route_presentation",root/"sites/presentation/route-presentation.jsonl"),
  ("presentation_template",root/"sites/presentation/presentation-template-stitch.jsonl")
]
with sqlite3.connect(db) as conn:
    for kind, path in files:
        rows=[json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        cols=list(dict.fromkeys(k for row in rows for k in row))
        conn.execute("CREATE TABLE "+kind+"(id INTEGER PRIMARY KEY,namespace TEXT,"
                     + ",".join(k+" TEXT" for k in cols)+")")
        for row in rows:
            conn.execute("INSERT INTO "+kind+"(namespace,"+",".join(cols)+") VALUES ("
                         + ",".join("?" for _ in range(len(cols)+1))+")",
                         ["aurekai"]+[json.dumps(row[k]) if isinstance(row.get(k),(dict,list))
                                      else row.get(k) for k in cols])
PY
cp "$tmp/invocation.log" "$tmp/pre-presentation-invocation"
front_receipt=$(sh "$cmd" apply front-doors)
printf '%s\n' "$front_receipt" | grep -Fq 'AUREKAI_PRESENTATION_PLAN type=territory_presentation reviewed=4 present=4 missing=0 namespace=aurekai'
cmp -s "$tmp/invocation.log" "$tmp/pre-presentation-invocation" || {
    echo "FAIL: duplicate front-door import invoked the native CMS" >&2; exit 1;
}

sh "$cmd" apply work-examples
grep -Fq "examples=$root/business/work-samples/work-examples.jsonl" "$tmp/invocation.log"
grep -Fq "programs=$root/business/work-samples/work-example-programs.jsonl" "$tmp/invocation.log"
grep -Fq "db=$tmp/cms.db" "$tmp/invocation.log"
if grep -Fq '/cmd/BonfyreCMS/data/' "$tmp/invocation.log"; then
    echo "FAIL: business source came from old engine folder" >&2; exit 1
fi
# Route composition rows and Stitch design templates are distinct typed CMS
# imports, with the exact Aurekai-owned source and explicit selected namespace.
# The 95-route cohort was seeded above with the other business data.
cp "$tmp/invocation.log" "$tmp/invocation-before-routes"
route_receipt=$(sh "$cmd" apply route-presentations)
printf '%s\n' "$route_receipt" | grep -Fq 'AUREKAI_ROUTE_PLAN total=95 existing=95 missing=0 namespace=aurekai'
cmp -s "$tmp/invocation.log" "$tmp/invocation-before-routes" || {
    echo "FAIL: reimport of 95 already-installed routes triggered a CMS write" >&2; exit 1;
}
stitch_receipt=$(sh "$cmd" apply stitch-template)
printf '%s\n' "$stitch_receipt" | grep -Fq 'AUREKAI_PRESENTATION_PLAN type=presentation_template reviewed=1 present=1 missing=0 namespace=aurekai'
cmp -s "$tmp/invocation.log" "$tmp/invocation-before-routes" || {
    echo "FAIL: duplicate Stitch template create was invoked" >&2; exit 1;
}

echo 'AUREKAI_OWNED_CMS_IMPORT_BINDING_PASS'
