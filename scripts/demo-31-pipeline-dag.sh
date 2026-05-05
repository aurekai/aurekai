#!/usr/bin/env bash
# demo-31-pipeline-dag.sh — Phase 13: Multi-step weight pipeline DAG
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

echo "=== demo-31: pipeline-dag ==="

# ── Test 1: default plan validate-only ────────────────────────────────
OUT=$($AKAI weights pipeline-dag --validate-only 2>/dev/null)

check "outer schema_version"   "$(echo "$OUT" | jq -r '.schema_version')"          "aurekai.weightops.result.v1"
check "inner schema_version"   "$(echo "$OUT" | jq -r '.payload.schema_version')"  "aurekai.weightops.pipeline_dag.v1"
check "command name"           "$(echo "$OUT" | jq -r '.command')"                 "weights.pipeline-dag"
check "plan_name set"          "$(echo "$OUT" | jq -r '.payload.plan_name | length > 0')" "true"
check "step_count 6"           "$(echo "$OUT" | jq -r '.payload.step_count')"       "6"
check "steps array len 6"      "$(echo "$OUT" | jq -r '.payload.steps | length')"   "6"
check "execution_order len 6"  "$(echo "$OUT" | jq -r '.payload.execution_order | length')" "6"
check "validation.valid true"  "$(echo "$OUT" | jq -r '.payload.validation.valid')" "true"
check "errors empty"           "$(echo "$OUT" | jq -r '.payload.validation.errors | length')" "0"
check "status PASS"            "$(echo "$OUT" | jq -r '.status')"                  "PASS"
check "exit_code 0"            "$(echo "$OUT" | jq -r '.exit_code')"               "0"

# ── Test 2: custom plan from JSON inline ──────────────────────────────
PLAN_FILE=$(mktemp /tmp/dag-plan-XXXX.json)
cat > "$PLAN_FILE" <<'EOF'
{
  "name": "quant-deploy-pipeline",
  "version": "2.0",
  "steps": [
    {"id":"pull",    "command":"weights.pull-region",     "depends_on":[],         "inputs":["trace.json"]},
    {"id":"quant",   "command":"weights.synth-quant",     "depends_on":["pull"],   "inputs":["$pull.output"]},
    {"id":"edge",    "command":"weights.edge-compile",    "depends_on":["quant"],  "inputs":["$quant.output"]},
    {"id":"gate",    "command":"weights.integrity-gate",  "depends_on":["quant","edge"], "inputs":["$quant.output"]}
  ]
}
EOF

OUT2=$($AKAI weights pipeline-dag --plan "$PLAN_FILE" --validate-only 2>/dev/null)
rm -f "$PLAN_FILE"

check "custom plan_name"        "$(echo "$OUT2" | jq -r '.payload.plan_name')"        "quant-deploy-pipeline"
check "custom plan_version"     "$(echo "$OUT2" | jq -r '.payload.plan_version')"     "2.0"
check "custom step_count 4"     "$(echo "$OUT2" | jq -r '.payload.step_count')"        "4"
check "custom valid true"       "$(echo "$OUT2" | jq -r '.payload.validation.valid')"  "true"
check "custom exec order len 4" "$(echo "$OUT2" | jq -r '.payload.execution_order | length')" "4"
check "estimated_duration_ms>0" "$(echo "$OUT2" | jq -r '.payload.estimated_duration_ms > 0')" "true"
check "model_state_delta.dag_steps" "$(echo "$OUT2" | jq -r '.model_state_delta.dag_steps')" "4"
check "duration_ms >=0"         "$(echo "$OUT2" | jq -r '.duration_ms >= 0')"           "true"
check "proof_root present"      "$(echo "$OUT2" | jq -r '.proof_root | startswith("ak:")')" "true"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
