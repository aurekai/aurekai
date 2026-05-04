#!/usr/bin/env bash
# demo-10-capability-negotiate.sh
# Phase 6 demo: Capability negotiation — finds the smallest verified weight plan
# that satisfies a multi-step business recipe under disk and quality constraints.
set -euo pipefail

RECIPE="${1:-examples/call-to-brief-to-invoice.akrecipe}"
DISK="${2:-5}"
HW="${3:-m3-16gb}"
QUALITY="${4:-0.95}"

echo ""
echo "=== Phase 6 WeightOps: Capability Negotiation Demo ==="
echo "  recipe:  ${RECIPE}"
echo "  disk:    ${DISK}GB"
echo "  hw:      ${HW}"
echo "  quality: ${QUALITY}"
echo ""

echo "[1/4] Negotiate weight plan"
PLAN=$(akai weights negotiate \
  --for "${RECIPE}" \
  --disk "${DISK}" \
  --hardware "${HW}" \
  --quality "${QUALITY}")
echo "$PLAN" | jq '.'

echo ""
echo "[2/4] Compile weight regions from negotiation"
akai weights compile "${RECIPE}" | jq '{
  required_weight_regions,
  optional_weight_regions,
  avoid,
  hydration_order,
  metrics
}'

echo ""
echo "[3/4] Create temporary lease (weights deleted after task)"
akai weights lease qwen3-8b.akmodel \
  --duration 2h \
  --for "${RECIPE}" \
  | jq '{model, duration, expires_at, delete_on_expiry, proof_retained}'

echo ""
echo "[4/4] Negotiation summary"
echo "$PLAN" | jq '{
  plan,
  download_gb,
  full_download_avoided,
  first_usable_seconds,
  execution_ladder,
  proof_uri
}'

echo ""
echo "=== Done: selected minimum weight plan without violating quality target ==="
