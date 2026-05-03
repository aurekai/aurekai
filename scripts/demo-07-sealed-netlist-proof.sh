#!/usr/bin/env bash
# demo-07-sealed-netlist-proof.sh
# Phase 5 demo: AkaiNet seal → eval-sealed → export proof.
set -euo pipefail

NETLIST="${1:-netlist.json}"

echo "[1/3] Seal netlist ${NETLIST}"
SEAL=$(akai net seal --netlist "${NETLIST}" --json)
SEAL_ID=$(echo "$SEAL" | jq -r '.artifact_id // .seal_id')
echo "  sealed: $SEAL_ID"

echo "[2/3] Eval sealed"
EVAL=$(akai net eval-sealed --id "${SEAL_ID}" --json)
echo "  eval: $(echo "$EVAL" | jq -r '.result // .status')"

echo "[3/3] Export proof bundle"
akai proof bundle --json | jq '{proof_uri}'
