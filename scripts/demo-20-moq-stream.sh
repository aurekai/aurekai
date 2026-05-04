#!/usr/bin/env bash
# demo-20-moq-stream.sh — Phase 5a: MoQ tensor streaming
set -euo pipefail
AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"

PASS=0; FAIL=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $*"; FAIL=$((FAIL+1)); }

echo "================================================================"
echo " demo-20: moq-stream — MoQ-inspired tensor streaming"
echo "================================================================"
echo ""

# ---
echo "[1/6] Default single-model stream plan (mistral-7b.q4.akmodel)..."
OUT=$($AKAI_CMD weights moq-stream --model mistral-7b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '{relay_uri,track_name,chunks_published,first_chunk_latency_ms,subscriber_ready_at_pct}'
RELAY=$(echo "$OUT" | jq -r '.relay_uri')
CHUNKS=$(echo "$OUT" | jq -r '.chunks_published')
READY=$(echo "$OUT" | jq -r '.subscriber_ready_at_pct')
[[ "$RELAY" == moq://* ]] && ok "relay_uri starts with moq://" || fail "expected moq:// relay_uri, got: $RELAY"
[[ "$CHUNKS" -gt 0 ]] && ok "chunks_published=$CHUNKS > 0" || fail "no chunks published"
[[ "$READY" -eq 22 ]] && ok "subscriber_ready_at_pct=22" || fail "expected 22, got: $READY"
echo ""

# ---
echo "[2/6] Custom relay + track + 100ms chunk window..."
OUT=$($AKAI_CMD weights moq-stream --model llama-8b.q4.akmodel \
        --relay moq://my-relay.example.com:4433 \
        --track my-org/weights/llama8b \
        --chunk-ms 100 2>/dev/null)
echo "$OUT" | jq '{relay_uri,track_name,config}'
RELAY=$(echo "$OUT" | jq -r '.relay_uri')
TRACK=$(echo "$OUT" | jq -r '.track_name')
CMS=$(echo "$OUT" | jq -r '.config.chunk_ms')
[[ "$RELAY" == *my-relay* ]] && ok "custom relay accepted" || fail "custom relay not reflected"
[[ "$TRACK" == "my-org/weights/llama8b" ]] && ok "custom track name accepted" || fail "track mismatch"
[[ "$CMS" -eq 100 ]] && ok "chunk_ms=100" || fail "expected chunk_ms=100, got: $CMS"
echo ""

# ---
echo "[3/6] Dry-run — compute stream plan without publishing..."
OUT=$($AKAI_CMD weights moq-stream --model mistral-7b.q4.akmodel --dry-run 2>/dev/null)
echo "$OUT" | jq '{dry_run,chunks_published,bytes_streamed}'
DR=$(echo "$OUT" | jq -r '.dry_run')
CP=$(echo "$OUT" | jq -r '.chunks_published')
BS=$(echo "$OUT" | jq -r '.bytes_streamed')
[[ "$DR" == "true" ]] && ok "dry_run=true" || fail "expected dry_run=true"
[[ "$CP" -eq 0 ]] && ok "chunks_published=0 in dry-run" || fail "expected 0 chunks in dry-run"
[[ "$BS" -eq 0 ]] && ok "bytes_streamed=0 in dry-run" || fail "expected 0 bytes in dry-run"
echo ""

# ---
echo "[4/6] Proof-per-chunk sample (first 5 + last 2)..."
OUT=$($AKAI_CMD weights moq-stream --model phi-3-mini.q4.akmodel 2>/dev/null)
PROOF_COUNT=$(echo "$OUT" | jq '.proof_per_chunk | length')
FIRST_PROOF=$(echo "$OUT" | jq -r '.proof_per_chunk[0].proof_hash')
echo "$OUT" | jq '.proof_per_chunk'
[[ "$PROOF_COUNT" -ge 5 ]] && ok "proof_per_chunk has $PROOF_COUNT entries" || fail "expected ≥5 proof entries, got: $PROOF_COUNT"
[[ "$FIRST_PROOF" == ak:sha256:* ]] && ok "chunk proof hash format ok" || fail "bad proof hash: $FIRST_PROOF"
echo ""

# ---
echo "[5/6] Stream plan structure includes all 3 phases..."
OUT=$($AKAI_CMD weights moq-stream --model mistral-7b.q4.akmodel 2>/dev/null)
echo "$OUT" | jq '.stream_plan'
P1=$(echo "$OUT" | jq -r '.stream_plan.phase_1_hot_tensors')
P2=$(echo "$OUT" | jq -r '.stream_plan.phase_2_routing')
P3=$(echo "$OUT" | jq -r '.stream_plan.phase_3_remaining')
[[ -n "$P1" ]] && ok "stream_plan.phase_1_hot_tensors present" || fail "missing phase_1"
[[ -n "$P2" ]] && ok "stream_plan.phase_2_routing present"     || fail "missing phase_2"
[[ -n "$P3" ]] && ok "stream_plan.phase_3_remaining present"   || fail "missing phase_3"
echo ""

# ---
echo "[6/6] Alias: akai weights stream (same as moq-stream)..."
OUT=$($AKAI_CMD weights stream --model mistral-7b.q4.akmodel --dry-run 2>/dev/null)
SV=$(echo "$OUT" | jq -r '.schema_version')
echo "$OUT" | jq '{schema_version,relay_uri,dry_run}'
[[ "$SV" == "aurekai.weightops.moq_stream.v1" ]] && ok "alias 'stream' routes to moq-stream" || fail "wrong schema_version: $SV"
echo ""

# ---
echo "================================================================"
if [[ "$FAIL" -eq 0 ]]; then
  echo " demo-20 PASSED — moq-stream MoQ tensor streaming working ($PASS/$((PASS+FAIL)))"
else
  echo " demo-20 FAILED — $FAIL failure(s) (passed: $PASS)"
  exit 1
fi
echo "================================================================"
