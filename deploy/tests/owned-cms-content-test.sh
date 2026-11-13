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

# The third real data path binds authored front-door content via the engine
# typed JSONL importer, never the old engine fixture pathname.
sh "$cmd" apply front-doors
grep -Fq "$root/sites/content/territory-presentations.jsonl" "$tmp/invocation.log"
grep -Fq -- '--dataset-file' "$tmp/invocation.log"
grep -Fq -- '--type' "$tmp/invocation.log"
grep -Fq -- '--apply' "$tmp/invocation.log"
grep -Fq 'aurekai' "$tmp/invocation.log"
if grep -Fq '/cmd/BonfyreCMS/data/' "$tmp/invocation.log"; then
    echo "FAIL: authored source came from old engine fixture" >&2; exit 1
fi

sh "$cmd" apply work-examples
grep -Fq "examples=$root/business/work-samples/work-examples.jsonl" "$tmp/invocation.log"
grep -Fq "programs=$root/business/work-samples/work-example-programs.jsonl" "$tmp/invocation.log"
grep -Fq "db=$tmp/cms.db" "$tmp/invocation.log"
if grep -Fq '/cmd/BonfyreCMS/data/' "$tmp/invocation.log"; then
    echo "FAIL: business source came from old engine folder" >&2; exit 1
fi
# Route composition rows and Stitch design templates are distinct typed CMS
# imports, with the exact Aurekai-owned source and explicit selected namespace.
# Simulate a reviewed CMS cohort that already contains all 95 business routes.
# The application-level importer must verify and skip the full cohort, rather
# than blindly invoking a second native create generation.
python3 - "$tmp/cms.db" "$root/sites/presentation/route-presentation.jsonl" <<'PY'
import json, sqlite3, sys
db, source = sys.argv[1:]
names = ("territory","route","when_query_key","pattern","template",
         "status","reference_source","cannot_infer")
with sqlite3.connect(db) as conn:
    conn.execute("CREATE TABLE route_presentation(id INTEGER PRIMARY KEY, namespace TEXT,"
                 + ",".join(k+" TEXT" for k in names) + ")")
    for line in open(source,encoding="utf-8"):
        if not line.strip():continue
        row=json.loads(line)
        conn.execute("INSERT INTO route_presentation(namespace," + ",".join(names)
                     + ") VALUES (" + ",".join("?" for _ in range(len(names)+1)) + ")",
                     ["aurekai"]+[row.get(k) for k in names])
PY
cp "$tmp/invocation.log" "$tmp/invocation-before-routes"
route_receipt=$(sh "$cmd" apply route-presentations)
printf '%s\n' "$route_receipt" | grep -Fq 'AUREKAI_ROUTE_PLAN total=95 existing=95 missing=0 namespace=aurekai'
cmp -s "$tmp/invocation.log" "$tmp/invocation-before-routes" || {
    echo "FAIL: reimport of 95 already-installed routes triggered a CMS write" >&2; exit 1;
}
sh "$cmd" apply stitch-template
grep -Fxq "presentation_template" "$tmp/invocation.log"
grep -Fxq "$root/sites/presentation/presentation-template-stitch.jsonl" "$tmp/invocation.log"
if grep -Fq '/packs/aurekai/presentation/' "$tmp/invocation.log"; then
    echo "FAIL: old engine brand pack still selected" >&2; exit 1
fi

echo 'AUREKAI_OWNED_CMS_IMPORT_BINDING_PASS'
