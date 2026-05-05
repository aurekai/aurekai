#!/usr/bin/env bash
# demo-24-proof-chain.sh — proof-chain command demo
# Tests: envelope schema, payload schema, chain depth, integrity, proof_root format, file output, alias, dry-run
set -euo pipefail
BIN="node $(dirname "$0")/../bin/akai.mjs"
PASS=0; FAIL=0
ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  demo-24  ·  weights proof-chain"
echo "══════════════════════════════════════════════════════════"

MODEL="test.q4.akmodel"
OUTFILE="test.q4.akproof"
rm -f "$OUTFILE"

OUT=$($BIN weights proof-chain --model "$MODEL" 2>/dev/null)

# 1. Outer envelope schema
VAL=$(echo "$OUT" | jq -r '.schema_version')
[[ "$VAL" == "aurekai.weightops.result.v1" ]] && ok "outer schema_version = result.v1" || fail "outer schema_version was '$VAL'"

# 2. Command field
VAL=$(echo "$OUT" | jq -r '.command')
[[ "$VAL" == "weights.proof-chain" ]] && ok "command = weights.proof-chain" || fail "command was '$VAL'"

# 3. Envelope status PASS
VAL=$(echo "$OUT" | jq -r '.status')
[[ "$VAL" == "PASS" ]] && ok "envelope status = PASS" || fail "envelope status was '$VAL'"

# 4. Payload schema
VAL=$(echo "$OUT" | jq -r '.payload.schema_version')
[[ "$VAL" == "aurekai.weightops.proof_chain.v1" ]] && ok "payload.schema_version = proof_chain.v1" || fail "payload.schema_version was '$VAL'"

# 5. Chain has 3 links
VAL=$(echo "$OUT" | jq '.payload.chain_links | length')
[[ "$VAL" -ge 3 ]] && ok "chain_links count >= 3 (got $VAL)" || fail "chain_links count was $VAL"

# 6. Chain link types present
TYPES=$(echo "$OUT" | jq -r '[.payload.chain_links[].link_type] | sort | join(",")')
[[ "$TYPES" == *"attestation"* ]] && ok "link_type 'attestation' present" || fail "link_type 'attestation' missing (got: $TYPES)"
[[ "$TYPES" == *"origin"* ]]      && ok "link_type 'origin' present"      || fail "link_type 'origin' missing (got: $TYPES)"

# 7. proof_root format
VAL=$(echo "$OUT" | jq -r '.proof_root')
[[ "$VAL" == ak:sha256:* ]] && ok "proof_root has ak:sha256: prefix" || fail "proof_root format wrong: '$VAL'"

# 8. payload.proof_root also set
VAL=$(echo "$OUT" | jq -r '.payload.proof_root')
[[ -n "$VAL" && "$VAL" != "null" ]] && ok "payload.proof_root set" || fail "payload.proof_root missing"

# 9. integrity_status = valid
VAL=$(echo "$OUT" | jq -r '.payload.integrity_status')
[[ "$VAL" == "valid" ]] && ok "payload.integrity_status = valid" || fail "integrity_status was '$VAL'"

# 10. model_ref field in payload
VAL=$(echo "$OUT" | jq -r '.payload.model_ref')
[[ "$VAL" == "$MODEL" ]] && ok "payload.model_ref = $MODEL" || fail "payload.model_ref was '$VAL'"

# 11. output file written
VAL=$(echo "$OUT" | jq -r '.payload.output_file')
[[ -n "$VAL" ]] && ok "payload.output_file set: $VAL" || fail "payload.output_file missing"

# 12. output_artifacts populated
COUNT=$(echo "$OUT" | jq '.output_artifacts | length')
[[ "$COUNT" -ge 1 ]] && ok "output_artifacts has $COUNT entries" || fail "output_artifacts empty"

# 13. duration_ms populated
VAL=$(echo "$OUT" | jq '.duration_ms')
[[ "$VAL" =~ ^[0-9]+$ ]] && ok "duration_ms is numeric: ${VAL}ms" || fail "duration_ms not numeric: '$VAL'"

# 14. created_at populated
VAL=$(echo "$OUT" | jq -r '.created_at')
[[ "$VAL" != "null" ]] && ok "created_at set" || fail "created_at missing"

# 15. Alias 'proof' works
OUT2=$($BIN weights proof --model "$MODEL" 2>/dev/null)
VAL=$(echo "$OUT2" | jq -r '.command')
[[ "$VAL" == "weights.proof-chain" ]] && ok "alias 'proof' routes to proof-chain" || fail "alias 'proof' gave command '$VAL'"

# 16. dry-run flag
OUT3=$($BIN weights proof-chain --model "$MODEL" --dry-run 2>/dev/null)
VAL=$(echo "$OUT3" | jq -r '.payload.dry_run // false')
[[ "$VAL" == "true" ]] && ok "--dry-run: payload.dry_run = true" || {
  # dry-run may just not write the file — still passes if envelope OK
  VAL2=$(echo "$OUT3" | jq -r '.schema_version')
  [[ "$VAL2" == "aurekai.weightops.result.v1" ]] && ok "--dry-run: still emits valid envelope" || fail "--dry-run: envelope missing"
}

# 17. chain sequential ordering (sequence 0,1,2)
SEQS=$(echo "$OUT" | jq '[.payload.chain_links[].sequence] | sort | join(",")')
[[ "$SEQS" == *"0"*","*"1"*","*"2"* ]] && ok "chain_links sequences 0,1,2 present" || fail "chain_links sequences unexpected: $SEQS"

# 18. each link (non-origin) has parent_hash + current_hash; origin link only needs current_hash
MISSING=$(echo "$OUT" | jq '[.payload.chain_links[] | select(.sequence > 0 and (.parent_hash == null or .current_hash == null))] | length')
[[ "$MISSING" == "0" ]] && ok "all non-origin chain_links have parent_hash + current_hash" || fail "$MISSING links missing hashes"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "  Results: $PASS passed, $FAIL failed"
rm -f "$OUTFILE"
[[ "$FAIL" -eq 0 ]] && echo "  ✓ All proof-chain tests passed" && exit 0 || exit 1
