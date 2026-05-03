#!/usr/bin/env bash
# demo-08-live-moq-pipeline-monitor.sh
# Phase 5 demo: Real-time MoQ pipeline event stream monitor.
set -euo pipefail

NAMESPACE="${1:-default}"
INTERVAL="${2:-5}"

echo "Starting live MoQ pipeline monitor (namespace=${NAMESPACE}, interval=${INTERVAL}s)"
echo "Press Ctrl+C to stop."

while true; do
  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  EVENTS=$(akai moq events --namespace "${NAMESPACE}" --since "${INTERVAL}s" --json 2>/dev/null || echo '{"events":[]}')
  COUNT=$(echo "$EVENTS" | jq '.events | length // 0')

  if [ "$COUNT" -gt 0 ]; then
    echo "${TS} [${COUNT} events]"
    echo "$EVENTS" | jq -r '.events[] | "  \(.type // "unknown") \(.artifact_id // "") \(.proof_uri // "")'
  else
    echo "${TS} no events"
  fi

  sleep "${INTERVAL}"
done
