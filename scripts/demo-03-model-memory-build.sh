#!/usr/bin/env bash
# demo-03-model-memory-build.sh
# Phase 5 demo: FPQ compress → SAE audit → index vec memory → proof.
set -euo pipefail

MODEL_TAG="${1:-latest}"
BITS="${2:-8}"

echo "[1/4] FPQ compress model ${MODEL_TAG} at ${BITS}-bit"
FPQ=$(akai fpq compress --model "${MODEL_TAG}" --bits "${BITS}" --json)
COMPRESSED_ID=$(echo "$FPQ" | jq -r '.artifact_id')
echo "  compressed: $COMPRESSED_ID"

echo "[2/4] SAE audit"
SAE=$(akai sae audit --artifact "${COMPRESSED_ID}" --json)
FEATURES=$(echo "$SAE" | jq '.features | length // 0')
echo "  features: $FEATURES"

echo "[3/4] Vec index"
VEC=$(akai vec index --artifact "${COMPRESSED_ID}" --namespace "default" --json)
echo "  vec: $(echo "$VEC" | jq -r '.index_size // "indexed"')"

echo "[4/4] Export proof bundle"
akai proof bundle --json | jq '{proof_uri}'
