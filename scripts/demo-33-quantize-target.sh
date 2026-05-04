#!/usr/bin/env bash
# demo-33-quantize-target.sh — Phase 15: Hardware-aware target quantization
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

echo "=== demo-33: quantize-target ==="

# ── Test 1: 4-bit ARM NEON ────────────────────────────────────────────
OUT=$($AKAI weights quantize-target \
  --model model.akmodel \
  --target arm-neon \
  --bits 4 \
  --dry-run 2>/dev/null)

check "outer schema_version"    "$(echo "$OUT" | jq -r '.schema_version')"           "aurekai.weightops.result.v1"
check "inner schema_version"    "$(echo "$OUT" | jq -r '.payload.schema_version')"   "aurekai.weightops.quantize_target.v1"
check "command name"            "$(echo "$OUT" | jq -r '.command')"                  "weights.quantize-target"
check "target arm-neon"         "$(echo "$OUT" | jq -r '.payload.target')"            "arm-neon"
check "bits 4"                  "$(echo "$OUT" | jq -r '.payload.bits')"               "4"
check "layer_schemes count"     "$(echo "$OUT" | jq -r '.payload.layer_schemes | length')" "9"
check "avg_bpw >=4"             "$(echo "$OUT" | jq -r '.payload.statistics.avg_bits_per_weight >= 4')" "true"
check "compression_ratio >1"    "$(echo "$OUT" | jq -r '.payload.statistics.compression_ratio > 1')" "true"
check "compressed_mb < baseline" "$(echo "$OUT" | jq -r '.payload.statistics.compressed_mb < .payload.statistics.baseline_mb')" "true"
check "hardware_fit present"    "$(echo "$OUT" | jq -r '.payload.hardware_fit | has("fits_memory")')" "true"
check "simd_accelerated true"   "$(echo "$OUT" | jq -r '.payload.hardware_fit.simd_accelerated')" "true"
check "status PASS"             "$(echo "$OUT" | jq -r '.status')"                   "PASS"
check "proof_root present"      "$(echo "$OUT" | jq -r '.proof_root | startswith("ak:")')" "true"

# ── Test 2: 8-bit Coral TPU ───────────────────────────────────────────
OUT2=$($AKAI weights quantize-target \
  --model model.akmodel \
  --target coral \
  --bits 8 \
  --dry-run 2>/dev/null)

check "target coral"            "$(echo "$OUT2" | jq -r '.payload.target')"           "coral"
check "bits 8"                  "$(echo "$OUT2" | jq -r '.payload.bits')"              "8"
check "avg_bpw >=8"             "$(echo "$OUT2" | jq -r '.payload.statistics.avg_bits_per_weight >= 8')" "true"
check "model_state_delta bits"  "$(echo "$OUT2" | jq -r '.model_state_delta.quantize_bits')" "8"
check "duration_ms >=0"         "$(echo "$OUT2" | jq -r '.duration_ms >= 0')"          "true"
check "bytes_read >0"           "$(echo "$OUT2" | jq -r '.bytes_read > 0')"             "true"

# ── Test 3: 16-bit x86-avx2 ──────────────────────────────────────────
OUT3=$($AKAI weights quantize-target \
  --model model.akmodel \
  --target x86-avx2 \
  --bits 16 \
  --dry-run 2>/dev/null)

check "target x86-avx2"         "$(echo "$OUT3" | jq -r '.payload.target')"            "x86-avx2"
check "bits 16"                 "$(echo "$OUT3" | jq -r '.payload.bits')"               "16"
check "compression_ratio >=1"   "$(echo "$OUT3" | jq -r '.payload.statistics.compression_ratio >= 1')" "true"
check "layer perp delta >0"     "$(echo "$OUT3" | jq -r '.payload.statistics.estimated_perplexity_delta > 0')" "true"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
