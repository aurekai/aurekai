#!/bin/sh
# Tenant-owned entrypoint for the existing Bonfyre CMS importers.
# No default database, credentials, engine binary or implicit publication.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
action=${1:-}
owner=${2:-}
case "$action:$owner" in
  check:houses|check:front-doors|check:work-examples|apply:houses|apply:front-doors|apply:work-examples) ;;
  *) echo "usage: sh deploy/install-owned-cms-content.sh check|apply houses|front-doors|work-examples" >&2; exit 2 ;;
esac
python3 "$root/scripts/check-business-boundary.py" >/dev/null
houses="$root/sites/content/territory-houses.json"
fronts="$root/sites/content/territory-presentations.jsonl"
work="$root/business/work-samples/work-examples.jsonl"
programs="$root/business/work-samples/work-example-programs.jsonl"

if [ "$action" = check ]; then
  if [ "$owner" = houses ] && [ -n "${BONFYRE_HOUSES_INSTALLER:-}" ]; then
    "${BONFYRE_BUN_BIN:-bun}" "$BONFYRE_HOUSES_INSTALLER" --data "$houses" --check
  fi
  if [ "$owner" = front-doors ] && [ -n "${BONFYRE_AUTHORED_ROWS_INSTALLER:-}" ]; then
    "${BONFYRE_BUN_BIN:-bun}" "$BONFYRE_AUTHORED_ROWS_INSTALLER" --type territory_presentation --dataset-file "territory_presentation=$fronts"
  fi
  echo "AUREKAI_SOURCE_CHECK_PASS owner=$owner (no CMS write)"
  exit 0
fi

: "${BONFYRE_CMS_DB:?set an explicit authorized CMS DB path}"
: "${BONFYRE_CMS_BINARY:?set the tested Bonfyre CMS binary path}"
[ -f "$BONFYRE_CMS_DB" ] || { echo "CMS DB must already exist; no implicit database creation" >&2; exit 2; }
[ -x "$BONFYRE_CMS_BINARY" ] || { echo "CMS binary must be executable" >&2; exit 2; }
if [ "$owner" = houses ]; then
  : "${BONFYRE_HOUSES_INSTALLER:?set the matching engine house importer path}"
  [ -f "$BONFYRE_HOUSES_INSTALLER" ] || { echo "house importer not found" >&2; exit 2; }
  exec "${BONFYRE_BUN_BIN:-bun}" "$BONFYRE_HOUSES_INSTALLER" --data "$houses" --db "$BONFYRE_CMS_DB" --cms "$BONFYRE_CMS_BINARY"
fi
if [ "$owner" = front-doors ]; then
  : "${BONFYRE_AUTHORED_ROWS_INSTALLER:?set the matching engine authored-row importer path}"
  : "${BONFYRE_CMS_NAMESPACE:?select a current authorized CMS namespace}"
  [ -f "$BONFYRE_AUTHORED_ROWS_INSTALLER" ] || { echo "authored-row importer not found" >&2; exit 2; }
  exec "${BONFYRE_BUN_BIN:-bun}" "$BONFYRE_AUTHORED_ROWS_INSTALLER" --type territory_presentation --dataset-file "territory_presentation=$fronts" --apply --db "$BONFYRE_CMS_DB" --cms "$BONFYRE_CMS_BINARY" --ns "$BONFYRE_CMS_NAMESPACE"
fi
: "${BONFYRE_WORK_EXAMPLES_INSTALLER:?set the matching Bonfyre work example importer path}"
[ -f "$BONFYRE_WORK_EXAMPLES_INSTALLER" ] || { echo "work importer not found" >&2; exit 2; }
export BONFYRE_WORK_EXAMPLES="$work"
export BONFYRE_WORK_EXAMPLE_PROGRAMS="$programs"
exec sh "$BONFYRE_WORK_EXAMPLES_INSTALLER" "$BONFYRE_CMS_DB"
