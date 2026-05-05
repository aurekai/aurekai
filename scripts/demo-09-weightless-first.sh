#!/usr/bin/env bash
# demo-09-weightless-first.sh
# Phase 6 demo: Run support classification without downloading full model weights.
# Shows weightless-first execution via SAE routing layer only.
set -euo pipefail

RECIPE="${1:-examples/support-classify.akrecipe}"

echo ""
echo "=== Phase 6 WeightOps: Weightless-First Demo ==="
echo ""

echo "[1/5] Check model skeleton availability"
akai weights skeleton qwen3-8b.akmodel | jq '{architecture, routing_map, sae_feature_map, remote_fallback}'

echo ""
echo "[2/5] Negotiate minimum weight plan for recipe"
PLAN=$(akai weights negotiate --for "${RECIPE}" --disk 2 --quality 0.75)
echo "$PLAN" | jq '{plan, download_gb, bytes_avoided_gb, full_download_avoided, first_usable_seconds}'

echo ""
echo "[3/5] Compile minimal weight regions"
akai weights compile "${RECIPE}" | jq '{required_weight_regions, avoid, metrics}'

echo ""
echo "[4/5] Trace hot vs cold tensors"
akai weights trace --recipe "${RECIPE}" --model qwen3-8b.akmodel \
  | jq '{hot_fraction, download_savings_pct, cold_tensors: .cold_tensors | length}'

echo ""
echo "[5/5] Generate weight proof (no full weights needed)"
akai weights prove qwen3-8b.akmodel --tasks "${RECIPE}" \
  | jq '.proof_bundle | {source_proof, capability_proof}'

echo ""
AVOIDED=$(echo "$PLAN" | jq '.full_download_avoided')
FIRST=$(echo "$PLAN" | jq '.first_usable_seconds')
SAVED=$(echo "$PLAN" | jq '.bytes_avoided_gb')
echo "Result: full_download_avoided=${AVOIDED}, first_usable=${FIRST}s, GB_saved=${SAVED}"
echo ""
echo "=== Done: model was usable without downloading full weights ==="
