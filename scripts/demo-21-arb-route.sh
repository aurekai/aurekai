#!/usr/bin/env bash
# demo-21-arb-route.sh — Phase 5b: economic arbitrage router
set -euo pipefail
AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"

PASS=0; FAIL=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $*"; FAIL=$((FAIL+1)); }

echo "================================================================"
echo " demo-21: arb-route — economic arbitrage inference router"
echo "================================================================"
echo ""

# ---
echo "[1/6] Default SLA route (budget 0.10, latency 300ms, quality 0.85)..."
OUT=$($AKAI_CMD weights arb-route --recipe support-classify.akrecipe 2>/dev/null)
echo "$OUT" | jq '{selected_provider,cost_credits,latency_ms,quality_score,arbitrage_saved_credits,eligible_count}'
SEL=$(echo "$OUT" | jq -r '.selected_provider')
COST=$(echo "$OUT" | jq -r '.cost_credits')
SAVED=$(echo "$OUT" | jq -r '.arbitrage_saved_credits')
EC=$(echo "$OUT" | jq -r '.eligible_count')
[[ -n "$SEL" ]] && ok "selected_provider='$SEL'" || fail "no provider selected"
[[ "$EC" -ge 1 ]] && ok "eligible_count=$EC ≥ 1" || fail "expected ≥1 eligible providers"
[[ "$(echo "$SAVED >= 0" | bc -l)" == "1" ]] && ok "arbitrage_saved_credits=$SAVED ≥ 0" || fail "negative savings"
echo ""

# ---
echo "[2/6] Tight latency SLA (50ms) — forces local ghost route..."
OUT=$($AKAI_CMD weights arb-route --recipe rag-pipeline.akrecipe \
        --sla-latency-ms 50 --sla-quality 0.70 --budget-credits 0.05 2>/dev/null)
echo "$OUT" | jq '{selected_provider,latency_ms,quality_score,eligible_count}'
SEL=$(echo "$OUT" | jq -r '.selected_provider')
LAT=$(echo "$OUT" | jq -r '.latency_ms')
[[ "$SEL" == "local" ]] && ok "tight latency → local ghost route selected" || fail "expected local, got: $SEL"
[[ "$LAT" -le 50 ]] && ok "latency_ms=$LAT ≤ 50ms SLA" || fail "latency SLA violated: $LAT"
echo ""

# ---
echo "[3/6] High quality SLA (0.97) — forces RunPod or Anthropic..."
OUT=$($AKAI_CMD weights arb-route --recipe reasoning-heavy.akrecipe \
        --sla-quality 0.97 --sla-latency-ms 500 --budget-credits 0.20 2>/dev/null)
echo "$OUT" | jq '{selected_provider,quality_score,cost_credits}'
QUALITY=$(echo "$OUT" | jq -r '.quality_score')
SEL=$(echo "$OUT" | jq -r '.selected_provider')
[[ "$(echo "$QUALITY >= 0.97" | bc -l)" == "1" ]] && ok "quality_score=$QUALITY meets 0.97 SLA" || fail "quality SLA violated: $QUALITY"
[[ "$SEL" == "runpod" || "$SEL" == "anthropic" ]] && ok "high-quality route → $SEL" || fail "expected runpod or anthropic, got: $SEL"
echo ""

# ---
echo "[4/6] All provider scores visible in output..."
OUT=$($AKAI_CMD weights arb-route --recipe summarize.akrecipe \
        --sla-latency-ms 300 --sla-quality 0.85 --budget-credits 0.15 2>/dev/null)
echo "$OUT" | jq '.provider_scores[] | {provider,eligible,arbitrage_score,cost_credits}'
PCOUNT=$(echo "$OUT" | jq '.provider_scores | length')
[[ "$PCOUNT" -eq 5 ]] && ok "provider_scores contains 5 entries" || fail "expected 5 providers, got: $PCOUNT"
PROOF=$(echo "$OUT" | jq -r '.proof_hash')
[[ "$PROOF" == ak:sha256:* ]] && ok "proof_hash format ok" || fail "bad proof_hash: $PROOF"
echo ""

# ---
echo "[5/6] Dry-run — compute route without executing..."
OUT=$($AKAI_CMD weights arb-route --recipe classify.akrecipe --dry-run 2>/dev/null)
echo "$OUT" | jq '{dry_run,selected_provider,cost_credits}'
DR=$(echo "$OUT" | jq -r '.dry_run')
SEL=$(echo "$OUT" | jq -r '.selected_provider')
[[ "$DR" == "true" ]] && ok "dry_run=true" || fail "expected dry_run=true"
[[ -n "$SEL" ]] && ok "selected_provider='$SEL' included in dry-run plan" || fail "missing provider in dry-run"
echo ""

# ---
echo "[6/6] Alias: akai weights route (same as arb-route)..."
OUT=$($AKAI_CMD weights route --recipe ner.akrecipe 2>/dev/null)
SV=$(echo "$OUT" | jq -r '.schema_version')
echo "$OUT" | jq '{schema_version,selected_provider,arbitrage_saved_credits}'
[[ "$SV" == "aurekai.weightops.arb_route.v1" ]] && ok "alias 'route' routes to arb-route" || fail "wrong schema_version: $SV"
echo ""

# ---
echo "================================================================"
if [[ "$FAIL" -eq 0 ]]; then
  echo " demo-21 PASSED — arb-route economic arbitrage router working ($PASS/$((PASS+FAIL)))"
else
  echo " demo-21 FAILED — $FAIL failure(s) (passed: $PASS)"
  exit 1
fi
echo "================================================================"
