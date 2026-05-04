#!/usr/bin/env bash
# demo-27-dp-noise.sh — Phase 9: Differential Privacy noise injection
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

echo "=== demo-27: dp-noise ==="

# ── Test 1: Gaussian mechanism ────────────────────────────────────────
OUT=$($AKAI weights dp-noise \
  --model weights-v2.akmodel \
  --epsilon 1.0 --delta 1e-5 \
  --mechanism gaussian --sensitivity 1.0 \
  --dry-run 2>/dev/null)

check "outer schema_version"    "$(echo "$OUT" | jq -r '.schema_version')"          "aurekai.weightops.result.v1"
check "inner schema_version"    "$(echo "$OUT" | jq -r '.payload.schema_version')"  "aurekai.weightops.dp_noise.v1"
check "command name"            "$(echo "$OUT" | jq -r '.command')"                 "weights.dp-noise"
check "epsilon"                 "$(echo "$OUT" | jq -r '.payload.privacy_guarantee.epsilon')" "1"
check "mechanism gaussian"      "$(echo "$OUT" | jq -r '.payload.privacy_guarantee.mechanism')" "gaussian"
check "noise_multiplier >0"     "$(echo "$OUT" | jq -r '.payload.privacy_guarantee.noise_multiplier > 0')" "true"
check "params_noised >0"        "$(echo "$OUT" | jq -r '.payload.noise_application.params_noised > 0')" "true"
check "layer_stats count"       "$(echo "$OUT" | jq -r '.payload.layer_stats | length')" "6"
check "status PASS"             "$(echo "$OUT" | jq -r '.status')"                  "PASS"
check "proof_root"              "$(echo "$OUT" | jq -r '.proof_root | startswith("ak:")')" "true"

# ── Test 2: Laplace mechanism, high epsilon ────────────────────────────
OUT2=$($AKAI weights dp-noise \
  --model weights-v2.akmodel \
  --epsilon 8.0 --delta 1e-6 \
  --mechanism laplace \
  --dry-run 2>/dev/null)

check "laplace mechanism"       "$(echo "$OUT2" | jq -r '.payload.privacy_guarantee.mechanism')" "laplace"
check "epsilon 8"               "$(echo "$OUT2" | jq -r '.payload.privacy_guarantee.epsilon')"   "8"
check "fidelity_retained >0.9"  "$(echo "$OUT2" | jq -r '.payload.quality_impact.fidelity_retained > 0.9')" "true"
check "zcdp_rho present"        "$(echo "$OUT2" | jq -r '.payload.privacy_guarantee | has("zcdp_rho")')" "true"
check "duration_ms >=0"         "$(echo "$OUT2" | jq -r '.duration_ms >= 0')"       "true"
check "bytes_read >0"           "$(echo "$OUT2" | jq -r '.bytes_read > 0')"          "true"
check "model_state_delta.dp_epsilon" "$(echo "$OUT2" | jq -r '.model_state_delta.dp_epsilon')" "8"
check "composition field"       "$(echo "$OUT2" | jq -r '.payload.privacy_guarantee | has("composition")')" "true"
check "params_clipped present"  "$(echo "$OUT2" | jq -r '.payload.noise_application | has("params_clipped")')" "true"
check "clip_norm present"       "$(echo "$OUT2" | jq -r '.payload.noise_application | has("clip_norm")')" "true"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
