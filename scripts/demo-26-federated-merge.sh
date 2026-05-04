#!/usr/bin/env bash
# demo-26-federated-merge.sh — Phase 8: Federated merge + DP accounting
set -euo pipefail
AKAI="node $(dirname "$0")/../bin/akai.mjs"
PASS=0; FAIL=0

check() {
  local desc="$1"; local actual="$2"; local expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc — got '$actual', want '$expected'"
    FAIL=$((FAIL+1))
  fi
}

echo "=== demo-26: federated-merge ==="

# ── Test 1: basic fedavg ──────────────────────────────────────────────
OUT=$($AKAI weights federated-merge \
  --nodes "node0.akmodel,node1.akmodel,node2.akmodel" \
  --algorithm fedavg --rounds 4 --dry-run 2>/dev/null)

check "outer schema_version"   "$(echo "$OUT" | jq -r '.schema_version')"         "aurekai.weightops.result.v1"
check "inner schema_version"   "$(echo "$OUT" | jq -r '.payload.schema_version')" "aurekai.weightops.federated_merge.v1"
check "command name"           "$(echo "$OUT" | jq -r '.command')"                "weights.federated-merge"
check "algorithm"              "$(echo "$OUT" | jq -r '.payload.algorithm')"      "fedavg"
check "rounds_completed"       "$(echo "$OUT" | jq -r '.payload.rounds_completed')" "4"
check "node_count"             "$(echo "$OUT" | jq -r '.payload.node_count')"     "3"
check "node_metrics length"    "$(echo "$OUT" | jq -r '.payload.node_metrics | length')" "3"
check "dp disabled by default" "$(echo "$OUT" | jq -r '.payload.privacy_accounting.enabled')" "false"
check "status PASS"            "$(echo "$OUT" | jq -r '.status')"                 "PASS"
check "exit_code 0"            "$(echo "$OUT" | jq -r '.exit_code')"              "0"

# ── Test 2: fedprox with DP ───────────────────────────────────────────
OUT2=$($AKAI weights federated-merge \
  --nodes "n0.akmodel,n1.akmodel,n2.akmodel,n3.akmodel" \
  --algorithm fedprox --rounds 10 --dp-epsilon 0.5 --dry-run 2>/dev/null)

check "fedprox algorithm"      "$(echo "$OUT2" | jq -r '.payload.algorithm')"      "fedprox"
check "rounds 10"              "$(echo "$OUT2" | jq -r '.payload.rounds_completed')" "10"
check "4 nodes"                "$(echo "$OUT2" | jq -r '.payload.node_count')"       "4"
check "dp enabled"             "$(echo "$OUT2" | jq -r '.payload.privacy_accounting.enabled')" "true"
check "dp epsilon 0.5"         "$(echo "$OUT2" | jq -r '.payload.privacy_accounting.epsilon')" "0.5"
check "input_artifacts >=4"    "$(echo "$OUT2" | jq -r '.input_artifacts | length >= 4')" "true"
check "duration_ms present"    "$(echo "$OUT2" | jq -r '.duration_ms >= 0')"        "true"
check "proof_root present"     "$(echo "$OUT2" | jq -r '.proof_root | startswith("ak:")')" "true"
check "convergence block"      "$(echo "$OUT2" | jq -r '.payload.global_model.convergence.converged')" "true"
check "aggregation_stats"      "$(echo "$OUT2" | jq -r '.payload.aggregation_stats | has("compression_ratio")')" "true"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
