#!/usr/bin/env bash
# demo-12-pull-region.sh
# Phase 1 deep demo: trace-driven tensor pull-region planner.
set -euo pipefail

RECIPE="${1:-examples/audio-to-deliverable-phase6.akrecipe}"
MODEL="${2:-qwen3-8b.akmodel}"
TRACE_OUT="${3:-/tmp/phase1.trace.akweighttrace.json}"
PLAN_OUT="${4:-/tmp/phase1.pull.akhydrate.json}"

AKAI="${AKAI:-akai}"
if ! command -v "$AKAI" >/dev/null 2>&1; then
  AKAI="node bin/akai.mjs"
fi

echo ""
echo "=== Phase 1: Pull-Region Deep Demo ==="
echo ""

echo "[1/3] Build trace"
$AKAI weights trace --recipe "${RECIPE}" --model "${MODEL}" > "${TRACE_OUT}"
cat "${TRACE_OUT}" | jq '{model, recipe, hot_tensors: (.hot_tensors|length), cold_tensors: (.cold_tensors|length), lazy_regions: (.lazy_regions|length)}'

echo ""
echo "[2/3] Generate pull-region plan from trace"
$AKAI weights pull-region --trace "${TRACE_OUT}" --budget-gb 1.6 --out "${PLAN_OUT}" \
  | jq '{schema_version, estimated_download_gb, full_download_avoided, first_usable_seconds, capability_ready_at_percent}'

echo ""
echo "[3/3] Inspect plan artifact"
cat "${PLAN_OUT}" | jq '{
  phase_1_hot_tensors: (.plan.phase_1_hot_tensors|length),
  phase_2_lazy_regions: (.plan.phase_2_lazy_regions|length),
  skipped_cold_tensors: (.plan.skipped_cold_tensors|length),
  bytes_avoided,
  proof_boundary
}'

echo ""
echo "=== Done: pull-region plan created at ${PLAN_OUT} ==="
