#!/usr/bin/env bash
# demo-07-sealed-netlist-proof.sh
# Flagship demo: AkaiNet seal → eval-sealed → Merkle graph → proof bundle.
#
# Usage:
#   ./scripts/demo-07-sealed-netlist-proof.sh [netlist-json]
#
# Default: seals the live capability registry as the netlist input.
#
# All three steps are native (no HyperRuntime required):
#   step 1 — akai net seal       (writes .aknetlist to ~/.aurekai/netlists/)
#   step 2 — akai net eval-sealed (verifies sealed artifact integrity)
#   step 3 — akai proof bundle   (assembles portable proof document from the sealed artifact)
set -euo pipefail

NETLIST="${1:-registry/aurekai.capabilities.json}"
OUT_DIR="${TMPDIR:-/tmp}/demo-07-sealed-netlist-$(date +%s)"
mkdir -p "$OUT_DIR"

echo "[1/3] Seal netlist: ${NETLIST}"
SEAL_OUT="${OUT_DIR}/seal.json"
akai net seal --netlist "${NETLIST}" --out "${OUT_DIR}/demo.aknetlist" --json > "$SEAL_OUT"
SEAL_ID=$(jq -r '.seal_id' "$SEAL_OUT")
echo "  seal_id: ${SEAL_ID}"
echo "  artifact: ${OUT_DIR}/demo.aknetlist"

echo ""
echo "[2/3] Eval sealed — verify integrity"
EVAL_OUT="${OUT_DIR}/eval.json"
akai net eval-sealed --netlist "${OUT_DIR}/demo.aknetlist" --json > "$EVAL_OUT"
VERDICT=$(jq -r '.verdict' "$EVAL_OUT")
echo "  verdict: ${VERDICT}"
if [ "$VERDICT" != "PASS" ]; then
  echo "  FAIL: sealed netlist verification did not pass" >&2
  jq '.verification_errors' "$EVAL_OUT" >&2
  exit 1
fi

echo ""
echo "[3/3] Proof bundle — assemble portable proof document"
BUNDLE_OUT="${OUT_DIR}/aurekai-proof.akproof.json"
akai proof bundle --in "${OUT_DIR}/demo.aknetlist" --out "$BUNDLE_OUT" --json
echo "  bundle: ${BUNDLE_OUT}"

echo ""
echo "Demo complete."
echo "  sealed netlist : ${OUT_DIR}/demo.aknetlist"
echo "  eval result    : ${OUT_DIR}/eval.json"
echo "  proof bundle   : ${BUNDLE_OUT}"
echo "  seal_id        : ${SEAL_ID}"
