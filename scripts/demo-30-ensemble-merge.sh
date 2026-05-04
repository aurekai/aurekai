#!/usr/bin/env bash
# demo-30-ensemble-merge.sh — Phase 12: Multi-model ensemble merge
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

echo "=== demo-30: ensemble-merge ==="

# ── Test 1: linear merge ──────────────────────────────────────────────
OUT=$($AKAI weights ensemble-merge \
  --models "base.akmodel,instruct.akmodel,chat.akmodel" \
  --method linear --weights "0.5,0.3,0.2" \
  --dry-run 2>/dev/null)

check "outer schema_version"   "$(echo "$OUT" | jq -r '.schema_version')"          "aurekai.weightops.result.v1"
check "inner schema_version"   "$(echo "$OUT" | jq -r '.payload.schema_version')"  "aurekai.weightops.ensemble_merge.v1"
check "command name"           "$(echo "$OUT" | jq -r '.command')"                 "weights.ensemble-merge"
check "method linear"          "$(echo "$OUT" | jq -r '.payload.method')"           "linear"
check "source_models count"    "$(echo "$OUT" | jq -r '.payload.source_models | length')" "3"
check "weights sum ~1"         "$(echo "$OUT" | jq -r '(.payload.source_models | map(.weight) | add) | . > 0.99 and . < 1.01')" "true"
check "layer_merge_stats >0"   "$(echo "$OUT" | jq -r '.payload.layer_merge_stats | length > 0')" "true"
check "cosine_alignment >0.9"  "$(echo "$OUT" | jq -r '.payload.quality_estimate.alignment_score > 0.9')" "true"
check "status PASS"            "$(echo "$OUT" | jq -r '.status')"                  "PASS"
check "proof_root present"     "$(echo "$OUT" | jq -r '.proof_root | startswith("ak:")')" "true"

# ── Test 2: slerp merge ───────────────────────────────────────────────
OUT2=$($AKAI weights ensemble-merge \
  --models "model-a.akmodel,model-b.akmodel" \
  --method slerp \
  --dry-run 2>/dev/null)

check "method slerp"           "$(echo "$OUT2" | jq -r '.payload.method')"          "slerp"
check "2 source models"        "$(echo "$OUT2" | jq -r '.payload.source_models | length')" "2"
check "equal weights"          "$(echo "$OUT2" | jq -r '.payload.source_models[0].weight == .payload.source_models[1].weight')" "true"
check "diversity_score >0"     "$(echo "$OUT2" | jq -r '.payload.quality_estimate.diversity_score > 0')" "true"
check "input_artifacts count"  "$(echo "$OUT2" | jq -r '.input_artifacts | length')" "2"
check "model_state_delta"      "$(echo "$OUT2" | jq -r '.model_state_delta | has("ensemble_method")')" "true"
check "duration_ms >=0"        "$(echo "$OUT2" | jq -r '.duration_ms >= 0')"        "true"

# ── Test 3: task-vector ───────────────────────────────────────────────
OUT3=$($AKAI weights ensemble-merge \
  --models "base.akmodel,ft-code.akmodel,ft-math.akmodel" \
  --method task-vector \
  --dry-run 2>/dev/null)

check "method task-vector"     "$(echo "$OUT3" | jq -r '.payload.method')"          "task-vector"
check "expected_improvement"   "$(echo "$OUT3" | jq -r '.payload.quality_estimate.expected_improvement_pct > 0')" "true"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
