#!/usr/bin/env bash
# demo-23-tamper-detect.sh — Phase 6b: weight tamper detection
set -euo pipefail
AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"

PASS=0; FAIL=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $*"; FAIL=$((FAIL+1)); }

echo "================================================================"
echo " demo-23: tamper-detect — weight artifact tamper detection"
echo "================================================================"
echo ""

# ---
echo "[1/6] Clean model — no tampering expected (PASS)..."
OUT=$($AKAI_CMD weights tamper-detect --model mistral-7b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '{pass,baseline_match,regions_checked,regions_ok,regions_diverged,verdict}'
PASS_VAL=$(echo "$OUT" | jq -r '.pass')
BM=$(echo "$OUT" | jq -r '.baseline_match')
RC=$(echo "$OUT" | jq -r '.regions_checked')
RD=$(echo "$OUT" | jq -r '.regions_diverged')
[[ "$PASS_VAL" == "true" ]] && ok "pass=true (clean model)" || fail "expected pass=true"
[[ "$BM" == "true" ]] && ok "baseline_match=true" || fail "expected baseline_match=true"
[[ "$RC" -ge 8 ]] && ok "regions_checked=$RC ≥ 8" || fail "expected ≥8 regions"
[[ "$RD" -eq 0 ]] && ok "regions_diverged=0" || fail "expected 0 diverged regions"
echo ""

# ---
echo "[2/6] Inject drift — tampered model (FAIL expected)..."
OUT=$($AKAI_CMD weights tamper-detect --model mistral-7b.q4.akmodel --inject-drift 2>/dev/null)
echo "$OUT" | jq '{pass,regions_diverged,verdict}'
PASS_VAL=$(echo "$OUT" | jq -r '.pass')
RD=$(echo "$OUT" | jq -r '.regions_diverged')
VERDICT=$(echo "$OUT" | jq -r '.verdict')
[[ "$PASS_VAL" == "false" ]] && ok "pass=false (tampered model detected)" || fail "expected pass=false"
[[ "$RD" -ge 1 ]] && ok "regions_diverged=$RD ≥ 1" || fail "expected ≥1 diverged region"
[[ "$VERDICT" == *TAMPERED* ]] && ok "verdict contains TAMPERED" || fail "bad verdict: $VERDICT"
echo ""

# ---
echo "[3/6] Region-level detail: all regions present in results..."
OUT=$($AKAI_CMD weights tamper-detect --model llama-8b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '.region_results[] | {region,status}'
RCOUNT=$(echo "$OUT" | jq '.region_results | length')
OK_COUNT=$(echo "$OUT" | jq '[.region_results[] | select(.status=="OK")] | length')
[[ "$RCOUNT" -ge 8 ]] && ok "region_results has $RCOUNT entries" || fail "expected ≥8 region_results"
[[ "$OK_COUNT" -eq "$RCOUNT" ]] && ok "all $OK_COUNT regions status=OK" || fail "some regions not OK"
echo ""

# ---
echo "[4/6] Verify against SBOM artifact (round-trip baseline)..."
SBOM_PATH=/tmp/test-llama.aksbom
$AKAI_CMD weights sbom --model llama-8b.q4.akmodel --out "$SBOM_PATH" 2>/dev/null
OUT=$($AKAI_CMD weights tamper-detect --model llama-8b.q4.akmodel --sbom "$SBOM_PATH" 2>/dev/null)
echo "$OUT" | jq '{pass,baseline_source,regions_ok}'
BS=$(echo "$OUT" | jq -r '.baseline_source')
PASS_VAL=$(echo "$OUT" | jq -r '.pass')
[[ "$BS" == "$SBOM_PATH" ]] && ok "baseline_source matches SBOM path" || fail "baseline_source mismatch: $BS"
[[ "$PASS_VAL" == "true" ]] && ok "SBOM round-trip: PASS (baseline match)" || fail "SBOM round-trip tamper check failed"
echo ""

# ---
echo "[5/6] Dry-run flag present in output..."
OUT=$($AKAI_CMD weights tamper-detect --model phi-3-mini.q4.akmodel --dry-run 2>/dev/null)
echo "$OUT" | jq '{dry_run,pass,schema_version}'
DR=$(echo "$OUT" | jq -r '.dry_run')
SV=$(echo "$OUT" | jq -r '.schema_version')
[[ "$DR" == "true" ]] && ok "dry_run=true" || fail "expected dry_run=true"
[[ "$SV" == "aurekai.weightops.tamper_detect.v1" ]] && ok "schema_version correct" || fail "wrong schema: $SV"
echo ""

# ---
echo "[6/6] Alias: akai weights tamper (same as tamper-detect)..."
OUT=$($AKAI_CMD weights tamper --model mistral-7b.q4.akmodel 2>/dev/null)
SV=$(echo "$OUT" | jq -r '.schema_version')
PASS_VAL=$(echo "$OUT" | jq -r '.pass')
echo "$OUT" | jq '{schema_version,pass,verdict}'
[[ "$SV" == "aurekai.weightops.tamper_detect.v1" ]] && ok "alias 'tamper' routes correctly" || fail "wrong schema: $SV"
[[ "$PASS_VAL" == "true" ]] && ok "alias returns clean verdict" || fail "unexpected pass value: $PASS_VAL"
echo ""

# ---
echo "================================================================"
if [[ "$FAIL" -eq 0 ]]; then
  echo " demo-23 PASSED — tamper-detect working ($PASS/$((PASS+FAIL)))"
else
  echo " demo-23 FAILED — $FAIL failure(s) (passed: $PASS)"
  exit 1
fi
echo "================================================================"
