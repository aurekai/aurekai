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

# Applying content without an explicit authorized database and binary must fail.
if (unset BONFYRE_CMS_DB BONFYRE_CMS_BINARY; sh "$cmd" apply houses) >"$tmp/refused" 2>&1; then
    echo "FAIL: implicit CMS database or credentials admitted" >&2; exit 1
fi

touch "$tmp/cms.db" "$tmp/house-installer.mjs" "$tmp/authored-installer.mjs"
cat > "$tmp/cms-binary" <<'EOF'
#!/bin/sh
exit 100
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
export BONFYRE_WORK_EXAMPLES_INSTALLER="$tmp/work-installer.sh"
export BONFYRE_BUN_BIN="$tmp/mock-bun"
export OWNED_SOURCE_INVOKE_LOG="$tmp/invocation.log"

sh "$cmd" apply houses
grep -Fq "$root/sites/content/territory-houses.json" "$tmp/invocation.log"
grep -Fq -- '--db' "$tmp/invocation.log"
grep -Fq "$tmp/cms.db" "$tmp/invocation.log"
grep -Fq "$tmp/cms-binary" "$tmp/invocation.log"

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
echo 'AUREKAI_OWNED_CMS_IMPORT_BINDING_PASS'
