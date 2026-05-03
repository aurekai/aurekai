#!/usr/bin/env bash
# demo-02-audio-to-deliverable.sh
# Phase 5 demo: Audio → transcript → brief → pack deliverable → distribute.
set -euo pipefail

AUDIO="${1:-audio.wav}"

echo "[1/5] Transcribe ${AUDIO}"
T=$(akai transcribe audio --input "${AUDIO}" --language en --json)
TRANSCRIPT_ID=$(echo "$T" | jq -r '.artifact_id')

echo "[2/5] Clean transcript"
C=$(akai transcript clean --id "${TRANSCRIPT_ID}" --json)
CLEAN_ID=$(echo "$C" | jq -r '.artifact_id')

echo "[3/5] Generate brief"
B=$(akai brief generate --artifact "${CLEAN_ID}" --json)
BRIEF_ID=$(echo "$B" | jq -r '.artifact_id')

echo "[4/5] Pack deliverable"
P=$(akai pack deliverable --brief "${BRIEF_ID}" --json)
PACK_ID=$(echo "$P" | jq -r '.artifact_id')
echo "  pack: $PACK_ID"

echo "[5/5] Distribute bundle"
D=$(akai distribute bundle --artifact "${PACK_ID}" --json)
DIST_URL=$(echo "$D" | jq -r '.url // .artifact_id')
echo "  distributed: $DIST_URL"

akai proof bundle --json | jq '{proof_uri}'
