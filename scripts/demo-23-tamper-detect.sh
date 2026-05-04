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
echo "$OUT" | jq '{envelope_status:.status,payload:{pass,baseline_match,regions_checked,regions_ok,regions_diverged,verdict}}'
ENV_STATUS=$(echo "$OUT" | jq -r '.status')
PASS_VAL=$(echo "$OUT" | jq -r '.payload.pass')
BM=$(echo "$OUT" | jq -r '.payload.baseline_match')
RC=$(echo "$OUT" | jq -r '.payload.regions_checked')
RD=$(echo "$OUT" | jq -r '.payload.regions_diverged')
[[ "$ENV_STATUS" == "PASS" ]] && ok "envelope status=PASS" || fail "expected envelope status PASS"
[[ "$PASS_VAL" == "true" ]] && ok "pass=true (clean model)" || fail "expected pass=true"
[[ "$BM" == "true" ]] && ok "baseline_match=true" || fail "expected baseline_match=true"
[[ "$RC" -ge 8 ]] && ok "regions_checked=$RC ≥ 8" || fail "expected ≥8 regions"
[[ "$RD" -eq 0 ]] && ok "regions_diverged=0" || fail "expected 0 diverged regions"
echo ""

# ---
echo "[2/6] Inject drift — tampered model (FAIL expected)..."
OUT=$($AKAI_CMD weights tamper-detect --model mistral-7b.q4.akmodel --inject-drift 2>/dev/null)
echo "$OUT" | jq '{envelope_status:.status,payload:{pass,regions_diverged,verdict}}'
ENV_STATUS=$(echo "$OUT" | jq -r '.status')
PASS_VAL=$(echo "$OUT" | jq -r '.payload.pass')
RD=$(echo "$OUT" | jq -r '.payload.regions_diverged')
VERDICT=$(echo "$OUT" | jq -r '.payload.verdict')
[[ "$ENV_STATUS" == "FAIL" ]] && ok "envelope status=FAIL" || fail "expected envelope status FAIL"
[[ "$PASS_VAL" == "false" ]] && ok "pass=false (tampered model detected)" || fail "expected pass=false"
[[ "$RD" -ge 1 ]] && ok "regions_diverged=$RD ≥ 1" || fail "expected ≥1 diverged region"
[[ "$VERDICT" == *TAMPERED* ]] && ok "verdict contains TAMPERED" || fail "bad verdict: $VERDICT"
echo ""

# ---
echo "[3/6] Region-level detail: all regions present in results..."
OUT=$($AKAI_CMD weights tamper-detect --model llama-8b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '.payload.region_results[] | {region,status}'
RCOUNT=$(echo "$OUT" | jq '.payload.region_results | length')
OK_COUNT=$(echo "$OUT" | jq '[.payload.region_results[] | select(.status=="OK")] | length')
[[ "$RCOUNT" -ge 8 ]] && ok "region_results has $RCOUNT entries" || fail "expected ≥8 region_results"
[[ "$OK_COUNT" -eq "$RCOUNT" ]] && ok "all $OK_COUNT regions status=OK" || fail "some regions not OK"
echo ""

# ---
echo "[4/6] Verify against SBOM artifact (round-trip baseline)..."
SBOM_PATH=/tmp/test-llama.aksbom
$AKAI_CMD weights sbom --model llama-8b.q4.akmodel --out "$SBOM_PATH" 2>/dev/null
OUT=$($AKAI_CMD weights tamper-detect --model llama-8b.q4.akmodel --sbom "$SBOM_PATH" 2>/dev/null)
echo "$OUT" | jq '{envelope_status:.status,payload:{baseline_source,pass,regions_ok}}'
BS=$(echo "$OUT" | jq -r '.payload.baseline_source')
PASS_VAL=$(echo "$OUT" | jq -r '.payload.pass')
[[ "$BS" == "$SBOM_PATH" ]] && ok "baseline_source matches SBOM path" || fail "baseline_source mismatch: $BS"
[[ "$PASS_VAL" == "true" ]] && ok "SBOM round-trip: PASS (baseline match)" || fail "SBOM round-trip tamper check failed"
echo ""

# ---
echo "[5/6] Dry-run flag present in output..."
OUT=$($AKAI_CMD weights tamper-detect --model phi-3-mini.q4.akmodel --dry-run 2>/dev/null)
echo "$OUT" | jq '{envelope_status:.status,payload_dry_run:.payload.dry_run,payload_pass:.payload.pass,payload_schema:.payload.schema_version}'
ENV_SV=$(echo "$OUT" | jq -r '.schema_version')
PAY_SV=$(echo "$OUT" | jq -r '.payload.schema_version')
DR=$(echo "$OUT" | jq -r '.payload.dry_run')
[[ "$ENV_SV" == "aurekai.weightops.result.v1" ]] && ok "envelope schema_version correct" || fail "wrong envelope schema: $ENV_SV"
[[ "$PAY_SV" == "aurekai.weightops.tamper_detect.v1" ]] && ok "payload schema_version correct" || fail "wrong payload schema: $PAY_SV"
[[ "$DR" == "true" ]] && ok "dry_run=true" || fail "expected dry_run=true"
echo ""

# ---
echo "[6/6] Alias: akai weights tamper (same as tamper-detect)..."
OUT=$($AKAI_CMD weights tamper --model mistral-7b.q4.akmodel 2>/dev/null)
ENV_CMD=$(echo "$OUT" | jq -r '.command')
PAY_SV=$(echo "$OUT" | jq -r '.payload.schema_version')
PASS_VAL=$(echo "$OUT" | jq -r '.payload.pass')
echo "$OUT" | jq '{command,payload_schema:.payload.schema_version,payload_pass:.payload.pass,payload_verdict:.payload.verdict}'
[[ "$ENV_CMD" == "weights.tamper-detect" ]] && ok "command='weights.tamper-detect'" || fail "wrong command: $ENV_CMD"
[[ "$PAY_SV" == "aurekai.weightops.tamper_detect.v1" ]] && ok "alias routes to correct payload schema" || fail "wrong schema: $PAY_SV"
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
