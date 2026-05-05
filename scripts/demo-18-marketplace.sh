#!/usr/bin/env bash
# demo-18-marketplace.sh — Phase 4a: model marketplace + recommender
#
# Demonstrates:
#   1. Recommend top-3 models for support-classify task (4 GB budget)
#   2. Recommend for code-detect task (8 GB budget, higher quality)
#   3. Alias: akai weights recommend
#   4. List full catalog (--list)
#   5. Inspect a specific model entry (marketplace inspect)
#
# No binary needed — pure akai weights marketplace.
set -euo pipefail

AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"

echo "================================================================"
echo " demo-18: marketplace — model recommender"
echo "================================================================"
echo

# ── 1/5  Recommend for support-classify (4 GB budget) ────────────────────────
echo "[1/5] Recommend top-3 for support-classify (budget: 4 GB, quality: 0.85)..."
$AKAI_CMD weights marketplace \
  --tasks support-classify \
  --budget-gb 4 \
  --quality 0.85 \
  --top 3 \
  | jq '{best_match:.payload.best_match, recommendations: [.payload.recommendations[] | {rank, id, size_gb, ghost_ready, matched_features, recommendation_score}]}'
echo

# ── 2/5  Recommend for code-detect (8 GB budget, high quality) ───────────────
echo "[2/5] Recommend for code-detect task (budget: 8 GB, quality: 0.92)..."
$AKAI_CMD weights marketplace \
  --tasks code-detect \
  --budget-gb 8 \
  --quality 0.92 \
  --top 3 \
  | jq '{best_match:.payload.best_match, recommendations: [.payload.recommendations[] | {rank, id, family, sae_compatible, download_strategy}]}'
echo

# ── 3/5  Multi-task recommend: rag + summarize-extract ───────────────────────
echo "[3/5] Multi-task recommend: rag,summarize-extract (budget: 4 GB)..."
$AKAI_CMD weights marketplace \
  --tasks rag,summarize-extract \
  --budget-gb 4 \
  --top 2 \
  | jq '{best_match:.payload.best_match, query: {tasks:.payload.query.tasks, budget_gb:.payload.query.budget_gb}, recommendations:[.payload.recommendations[]|{rank,id,matched_features}]}'
echo

# ── 4/5  Alias: recommend ────────────────────────────────────────────────────
echo "[4/5] Alias check — akai weights recommend..."
$AKAI_CMD weights recommend \
  --tasks sentiment \
  --budget-gb 2 \
  --top 1 \
  | jq '{schema_version:.schema_version,command:.command,best_match:.payload.best_match,proof_hash:.payload.proof_hash}'
echo

# ── 5/5  List full catalog + inspect specific model ──────────────────────────
echo "[5/5] List catalog then inspect mistral-7b-q4..."
$AKAI_CMD weights marketplace --list \
  | jq '{catalog_size:.payload.catalog_size, models:[.payload.models[]|{id,size_gb,sae_compatible,memory_pack_available}]}'
echo "  --- inspect mistral-7b-q4 ---"
$AKAI_CMD weights marketplace inspect mistral-7b-q4 \
  | jq '{id:.payload.id,name:.payload.name,size_gb:.payload.size_gb,ghost_ready:.payload.ghost_ready,distill_features:.payload.distill_features,proof_hash:.payload.proof_hash}'
echo

echo "================================================================"
echo " demo-18 PASSED — marketplace + recommender working"
echo "================================================================"
