#!/usr/bin/env bash
# demo-13-delta-patch.sh
# Phase 1 deep demo: model revision delta + patch flow.
set -euo pipefail

BASE="${1:-qwen3-8b@2026-04-15}"
TARGET="${2:-qwen3-8b@2026-05-04}"
DELTA_OUT="${3:-/tmp/qwen3-8b.akdelta.json}"
PATCHED_OUT="${4:-/tmp/qwen3-8b@2026-05-04.akmodel.json}"

AKAI="${AKAI:-akai}"
if ! command -v "$AKAI" >/dev/null 2>&1; then
  AKAI="node bin/akai.mjs"
fi

echo ""
echo "=== Phase 1: Delta/Patch Deep Demo ==="
echo ""

echo "[1/3] Compute revision delta"
$AKAI weights diff "${BASE}" "${TARGET}" --out "${DELTA_OUT}" \
  | jq '{schema_version, base, target, delta_levels, summary}'

echo ""
echo "[2/3] Apply patch from delta"
$AKAI weights patch "${BASE}" "${DELTA_OUT}" --out "${PATCHED_OUT}" \
  | jq '{schema_version, base, target, full_download_avoided, first_usable_seconds, capability_ready_at_percent}'

echo ""
echo "[3/3] Verify artifacts"
cat "${DELTA_OUT}" | jq '{changed_regions: (.changed_regions|length), proofs}'
cat "${PATCHED_OUT}" | jq '{changed_regions_applied: (.changed_regions_applied|length), proofs}'

echo ""
echo "=== Done: delta=${DELTA_OUT}, patched=${PATCHED_OUT} ==="
