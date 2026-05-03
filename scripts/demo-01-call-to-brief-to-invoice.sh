#!/usr/bin/env bash
# demo-01-call-to-brief-to-invoice.sh
# Phase 5 demo: Full call-center pipeline — audio → transcript → brief → invoice.
set -euo pipefail

AUDIO="${1:-audio.wav}"
CLIENT_ID="${2:-demo-client}"

echo "[1/5] Transcribe ${AUDIO}"
TRANSCRIBE=$(akai transcribe audio --input "${AUDIO}" --language en --json)
TRANSCRIPT_ID=$(echo "$TRANSCRIBE" | jq -r '.artifact_id')
echo "  transcript: $TRANSCRIPT_ID"

echo "[2/5] Clean transcript"
CLEAN=$(akai transcript clean --id "${TRANSCRIPT_ID}" --json)
CLEAN_ID=$(echo "$CLEAN" | jq -r '.artifact_id')

echo "[3/5] Generate brief from ${CLEAN_ID}"
BRIEF=$(akai brief generate --artifact "${CLEAN_ID}" --json)
BRIEF_ID=$(echo "$BRIEF" | jq -r '.artifact_id')
echo "  brief: $BRIEF_ID"

echo "[4/5] Generate invoice for ${CLIENT_ID}"
INVOICE=$(akai pay invoice --client "${CLIENT_ID}" --period current --json)
INVOICE_ID=$(echo "$INVOICE" | jq -r '.invoice_id')
echo "  invoice: $INVOICE_ID"

echo "[5/5] Export proof bundle"
PROOF=$(akai proof bundle --json)
PROOF_URI=$(echo "$PROOF" | jq -r '.proof_uri')
echo "  proof: $PROOF_URI"

echo
echo "Done. brief=${BRIEF_ID} invoice=${INVOICE_ID} proof=${PROOF_URI}"
