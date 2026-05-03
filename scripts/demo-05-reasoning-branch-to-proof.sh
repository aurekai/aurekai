#!/usr/bin/env bash
# demo-05-reasoning-branch-to-proof.sh
# Phase 5 demo: Start reasoning session → branch → diff → proof.
set -euo pipefail

PROMPT="${1:-Analyze the system state}"

echo "[1/4] Start reasoning session"
SESSION=$(akai reason start --prompt "${PROMPT}" --json)
SESSION_ID=$(echo "$SESSION" | jq -r '.session_id')
echo "  session: $SESSION_ID"

echo "[2/4] Branch session"
BRANCH=$(akai reason branch --session "${SESSION_ID}" --json)
BRANCH_ID=$(echo "$BRANCH" | jq -r '.branch_id // .session_id')
echo "  branch: $BRANCH_ID"

echo "[3/4] Diff branches"
DIFF=$(akai reason diff --session "${SESSION_ID}" --json)
echo "  diff: $(echo "$DIFF" | jq -r '.summary // "ok"')"

echo "[4/4] Export proof bundle"
akai proof bundle --json | jq '{proof_uri}'
