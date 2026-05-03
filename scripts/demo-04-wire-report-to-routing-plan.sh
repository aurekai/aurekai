#!/usr/bin/env bash
# demo-04-wire-report-to-routing-plan.sh
# Phase 5 demo: PCAP capture → wire report → graph lineage → proof.
set -euo pipefail

CAPTURE_ID="${1:-latest}"

echo "[1/3] Generate wire report for capture ${CAPTURE_ID}"
WIRE=$(akai wire report --capture "${CAPTURE_ID}" --json)
REPORT_ID=$(echo "$WIRE" | jq -r '.artifact_id')
echo "  report: $REPORT_ID"

echo "[2/3] Graph lineage for report"
LINEAGE=$(akai graph lineage --artifact "${REPORT_ID}" --json)
echo "  lineage nodes: $(echo "$LINEAGE" | jq '.nodes | length // 0')"

echo "[3/3] Export proof bundle"
akai proof bundle --json | jq '{proof_uri}'
