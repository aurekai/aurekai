#!/usr/bin/env bash
# demo-32-edge-compile.sh — Phase 14: Edge hardware compilation
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

echo "=== demo-32: edge-compile ==="

# ── Test 1: Raspberry Pi 4 target ────────────────────────────────────
OUT=$($AKAI weights edge-compile \
  --model model.akmodel \
  --target rpi4 \
  --optimize size \
  --dry-run 2>/dev/null)

check "outer schema_version"    "$(echo "$OUT" | jq -r '.schema_version')"           "aurekai.weightops.result.v1"
check "inner schema_version"    "$(echo "$OUT" | jq -r '.payload.schema_version')"   "aurekai.weightops.edge_compile.v1"
check "command name"            "$(echo "$OUT" | jq -r '.command')"                  "weights.edge-compile"
check "target rpi4"             "$(echo "$OUT" | jq -r '.payload.target')"            "rpi4"
check "optimize size"           "$(echo "$OUT" | jq -r '.payload.optimize_for')"      "size"
check "hw arch arm-cortex-a72"  "$(echo "$OUT" | jq -r '.payload.hardware_profile.arch')" "arm-cortex-a72"
check "compile_steps count"     "$(echo "$OUT" | jq -r '.payload.compilation_steps | length')" "6"
check "all steps ok"            "$(echo "$OUT" | jq -r '[.payload.compilation_steps[].status] | all(. == "ok")')" "true"
check "output.size_mb >0"       "$(echo "$OUT" | jq -r '.payload.output.size_mb > 0')" "true"
check "compression_ratio >1"    "$(echo "$OUT" | jq -r '.payload.output.compression_ratio > 1')" "true"
check "perf_estimate present"   "$(echo "$OUT" | jq -r '.payload.performance_estimate | has("throughput_tok_per_s")')" "true"
check "status PASS"             "$(echo "$OUT" | jq -r '.status')"                   "PASS"

# ── Test 2: Jetson target, speed optimize ────────────────────────────
OUT2=$($AKAI weights edge-compile \
  --model nano.akmodel \
  --target jetson \
  --optimize speed \
  --dry-run 2>/dev/null)

check "target jetson"           "$(echo "$OUT2" | jq -r '.payload.target')"           "jetson"
check "hw simd cuda"            "$(echo "$OUT2" | jq -r '.payload.hardware_profile.simd')" "cuda"
check "runtime_deps list"       "$(echo "$OUT2" | jq -r '.payload.output.runtime_deps | type')" "array"
check "model_state_delta.edge_target" "$(echo "$OUT2" | jq -r '.model_state_delta.edge_target')" "jetson"
check "proof_root present"      "$(echo "$OUT2" | jq -r '.proof_root | startswith("ak:")')" "true"
check "duration_ms >=0"         "$(echo "$OUT2" | jq -r '.duration_ms >= 0')"          "true"

# ── Test 3: WASM target ───────────────────────────────────────────────
OUT3=$($AKAI weights edge-compile \
  --model web.akmodel \
  --target wasm \
  --optimize balanced \
  --dry-run 2>/dev/null)

check "target wasm"             "$(echo "$OUT3" | jq -r '.payload.target')"            "wasm"
check "wasm arch wasm32"        "$(echo "$OUT3" | jq -r '.payload.hardware_profile.arch')" "wasm32"
check "bytes_read >0"           "$(echo "$OUT3" | jq -r '.bytes_read > 0')"             "true"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
