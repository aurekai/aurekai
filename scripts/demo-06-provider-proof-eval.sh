#!/usr/bin/env bash
# demo-06-provider-proof-eval.sh
# Phase 5 demo: Verify provider artifact → proof eval → gate.
set -euo pipefail

ARTIFACT_ID="${1:-latest}"

echo "[1/4] Verify manifest"
akai verify --manifest artifact.json --json | jq '{ok: .ok}'

echo "[2/4] Canon hash"
HASH=$(akai canon hash --artifact "${ARTIFACT_ID}" --json)
echo "  hash: $(echo "$HASH" | jq -r '.hash // .canon_hash')"

echo "[3/4] Export proof bundle"
PROOF=$(akai proof bundle --json)
PROOF_URI=$(echo "$PROOF" | jq -r '.proof_uri')
echo "  proof: $PROOF_URI"

echo "[4/4] Release gate"
GATE=$(akai release gate --strict --json)
echo "  gate: $(echo "$GATE" | jq -r '.passed // .ok')"
