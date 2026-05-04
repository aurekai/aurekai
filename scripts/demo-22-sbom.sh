#!/usr/bin/env bash
# demo-22-sbom.sh — Phase 6a: weight Software Bill of Materials
set -euo pipefail
AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"

PASS=0; FAIL=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $*"; FAIL=$((FAIL+1)); }

echo "================================================================"
echo " demo-22: sbom — weight artifact Software Bill of Materials"
echo "================================================================"
echo ""

# ---
echo "[1/6] Generate SBOM for mistral-7b.q4.akmodel..."
OUT=$($AKAI_CMD weights sbom --model mistral-7b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '{schema_version,command,status,payload:{model_id,quant,license,component_count}}'
SV=$(echo "$OUT" | jq -r '.schema_version')
CMD=$(echo "$OUT" | jq -r '.command')
STATUS=$(echo "$OUT" | jq -r '.status')
CC=$(echo "$OUT" | jq -r '.payload.component_count')
[[ "$SV" == "aurekai.weightops.result.v1" ]] && ok "envelope schema_version correct" || fail "wrong schema: $SV"
[[ "$CMD" == "weights.sbom" ]] && ok "command='weights.sbom'" || fail "wrong command: $CMD"
[[ "$STATUS" == "PASS" ]] && ok "status=PASS" || fail "wrong status: $STATUS"
[[ "$CC" -ge 8 ]] && ok "component_count=$CC ≥ 8 tensor regions" || fail "expected ≥8 components, got: $CC"
echo ""

# ---
echo "[2/6] All components have content_hash + supplier..."
OUT=$($AKAI_CMD weights sbom --model mistral-7b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '.payload.components[] | {name,content_hash,supplier}'
MISSING=$(echo "$OUT" | jq '[.payload.components[] | select(.content_hash == null or .supplier == null)] | length')
[[ "$MISSING" -eq 0 ]] && ok "all components have content_hash + supplier" || fail "$MISSING components missing hash or supplier"
echo ""

# ---
echo "[3/6] Lineage block: quant_method, source_uri, sae_version..."
OUT=$($AKAI_CMD weights sbom --model llama-8b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '.payload.lineage'
QM=$(echo "$OUT" | jq -r '.payload.lineage.quant_method')
SU=$(echo "$OUT" | jq -r '.payload.lineage.source_uri')
SV2=$(echo "$OUT" | jq -r '.payload.lineage.sae_version')
[[ -n "$QM" && "$QM" != "null" ]] && ok "lineage.quant_method='$QM'" || fail "missing quant_method"
[[ "$SU" == hf://* ]] && ok "lineage.source_uri starts with hf://" || fail "bad source_uri: $SU"
[[ -n "$SV2" ]] && ok "lineage.sae_version='$SV2'" || fail "missing sae_version"
echo ""

# ---
echo "[4/6] Checksums: model_root_hash + sbom_hash both present..."
OUT=$($AKAI_CMD weights sbom --model phi-3-mini.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '.payload.checksums'
MRH=$(echo "$OUT" | jq -r '.payload.checksums.model_root_hash')
SH=$(echo "$OUT" | jq -r '.payload.checksums.sbom_hash')
[[ "$MRH" == ak:sha256:* ]] && ok "model_root_hash format ok" || fail "bad model_root_hash: $MRH"
[[ "$SH" == ak:sha256:* ]] && ok "sbom_hash format ok" || fail "bad sbom_hash: $SH"
echo ""

# ---
echo "[5/6] Dry-run — compute SBOM without writing output_file..."
TMPOUT=/tmp/test-sbom-dryrun.aksbom
rm -f "$TMPOUT"
OUT=$($AKAI_CMD weights sbom --model mistral-7b.q4.akmodel --out "$TMPOUT" --dry-run 2>/dev/null)
DR=$(echo "$OUT" | jq -r '.payload.dry_run')
[[ "$DR" == "true" ]] && ok "dry_run=true" || fail "expected dry_run=true"
[[ ! -f "$TMPOUT" ]] && ok "output file NOT written in dry-run" || fail "file should not exist in dry-run"
echo ""

# ---
echo "[6/6] Write SBOM artifact to disk + verify file exists..."
SBOM_PATH=/tmp/test-mistral.aksbom
OUT=$($AKAI_CMD weights sbom --model mistral-7b.q4.akmodel --out "$SBOM_PATH" 2>/dev/null)
echo "$OUT" | jq '{output_file:.payload.output_file,proof_hash:.payload.proof_hash,envelope_status:.status}'
[[ -f "$SBOM_PATH" ]] && ok "SBOM artifact written to $SBOM_PATH" || fail "file not written"
RELOAD=$(cat "$SBOM_PATH" | jq -r '.schema_version')
[[ "$RELOAD" == "aurekai.weightops.sbom.v1" ]] && ok "SBOM artifact parses correctly on reload" || fail "reload failed: $RELOAD"
echo ""

# ---
echo "================================================================"
if [[ "$FAIL" -eq 0 ]]; then
  echo " demo-22 PASSED — sbom SBOM generation working ($PASS/$((PASS+FAIL)))"
else
  echo " demo-22 FAILED — $FAIL failure(s) (passed: $PASS)"
  exit 1
fi
echo "================================================================"
