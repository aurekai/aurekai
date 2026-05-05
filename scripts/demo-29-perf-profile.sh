#!/usr/bin/env bash
# demo-29-perf-profile.sh — Phase 11: Performance profiling
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

echo "=== demo-29: perf-profile ==="

OUT=$($AKAI weights perf-profile \
  --model model.akmodel \
  --tasks "chat,summarize,embed,classify" \
  --hardware "apple-m3-pro" \
  --warmup 3 --runs 8 2>/dev/null)

check "outer schema_version"   "$(echo "$OUT" | jq -r '.schema_version')"          "aurekai.weightops.result.v1"
check "inner schema_version"   "$(echo "$OUT" | jq -r '.payload.schema_version')"  "aurekai.weightops.perf_profile.v1"
check "command name"           "$(echo "$OUT" | jq -r '.command')"                 "weights.perf-profile"
check "model_ref"              "$(echo "$OUT" | jq -r '.payload.model_ref')"        "model.akmodel"
check "warmup_runs"            "$(echo "$OUT" | jq -r '.payload.warmup_runs')"      "3"
check "benchmark_runs"         "$(echo "$OUT" | jq -r '.payload.benchmark_runs')"   "8"
check "task_profiles count"    "$(echo "$OUT" | jq -r '.payload.task_profiles | length')" "4"
check "throughput >0 chat"     "$(echo "$OUT" | jq -r '.payload.task_profiles[0].throughput_tok_per_s > 0')" "true"
check "latency.p50 present"    "$(echo "$OUT" | jq -r '.payload.task_profiles[0].latency_ms | has("p50")')" "true"
check "latency.p99 present"    "$(echo "$OUT" | jq -r '.payload.task_profiles[0].latency_ms | has("p99")')" "true"
check "memory_peak_mb >0"      "$(echo "$OUT" | jq -r '.payload.task_profiles[0].memory_peak_mb > 0')" "true"
check "summary.best_task set"  "$(echo "$OUT" | jq -r '.payload.summary.best_task | length > 0')" "true"
check "avg_p50_latency_ms >0"  "$(echo "$OUT" | jq -r '.payload.summary.avg_p50_latency_ms > 0')" "true"
check "hardware.resolved set"  "$(echo "$OUT" | jq -r '.payload.hardware.resolved | length > 0')" "true"
check "proof_root present"     "$(echo "$OUT" | jq -r '.proof_root | startswith("ak:")')" "true"
check "status PASS"            "$(echo "$OUT" | jq -r '.status')"                  "PASS"
check "exit_code 0"            "$(echo "$OUT" | jq -r '.exit_code')"               "0"
check "duration_ms >=0"        "$(echo "$OUT" | jq -r '.duration_ms >= 0')"        "true"

echo ""; echo "PASS=$PASS  FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && echo "ALL PASSED" || { echo "FAILURES: $FAIL"; exit 1; }
