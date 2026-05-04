#!/usr/bin/env bash
# demo-28-drift-monitor.sh — Phase 10: Weight distribution drift detection
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

echo "=== demo-28: drift-monitor ==="

OUT=$($AKAI weights drift-monitor \
  --model model-v2.akmodel \
  --baseline model-v2.akmodel@v1.0 \
  --window 48 \
  --threshold 0.05 \
  --dry-run 2>/dev/null)

check "outer schema_version"   "$(echo "$OUT" | jq -r '.schema_version')"          "aurekai.weightops.result.v1"
check "inner schema_version"   "$(echo "$OUT" | jq -r '.payload.schema_version')"  "aurekai.weightops.drift_monitor.v1"
check "command name"           "$(echo "$OUT" | jq -r '.command')"                 "weights.drift-monitor"
check "model_ref"              "$(echo "$OUT" | jq -r '.payload.model_ref')"        "model-v2.akmodel"
check "baseline_ref"           "$(echo "$OUT" | jq -r '.payload.baseline_ref')"    "model-v2.akmodel@v1.0"
check "window_hours"           "$(echo "$OUT" | jq -r '.payload.window_hours')"    "48"
check "threshold"              "$(echo "$OUT" | jq -r '.payload.threshold')"       "0.05"
check "layer_drifts count"     "$(echo "$OUT" | jq -r '.payload.layer_drifts | length')" "8"
check "jsd in layers"          "$(echo "$OUT" | jq -r '.payload.layer_drifts[0] | has("jsd")')" "true"
check "drifted field in layers" "$(echo "$OUT" | jq -r '.payload.layer_drifts[0] | has("drifted")')" "true"
check "severity in [none,warning,critical]" \
  "$(echo "$OUT" | jq -r '[.payload.summary.severity] | inside(["none","warning","critical"])')" "true"
check "total_layers 8"         "$(echo "$OUT" | jq -r '.payload.summary.total_layers')" "8"
check "recommendations present" "$(echo "$OUT" | jq -r '.payload.recommendations | length > 0')" "true"
check "proof_root present"     "$(echo "$OUT" | jq -r '.proof_root | startswith("ak:")')" "true"
check "duration_ms >=0"        "$(echo "$OUT" | jq -r '.duration_ms >= 0')"        "true"
check "bytes_read >0"          "$(echo "$OUT" | jq -r '.bytes_read > 0')"           "true"
check "input_artifacts count"  "$(echo "$OUT" | jq -r '.input_artifacts | length')" "2"
check "model_state_delta.drift_jsd" "$(echo "$OUT" | jq -r '.model_state_delta | has("drift_jsd")')" "true"
check "exit_code 0"            "$(echo "$OUT" | jq -r '.exit_code')"                "0"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
