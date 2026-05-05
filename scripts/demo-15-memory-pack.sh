#!/usr/bin/env bash
# demo-15-memory-pack.sh — Phase 2b: .akmemory artifact pipeline
#
# Demonstrates:
#   1. Pack a single-task memory (support-classify) from a q4 model
#   2. Pack a multi-task memory (rag + summarize + brief)
#   3. Inspect the packed .akmemory artifact
#   4. Check memory status (daemon-mode registry)
#   5. Re-inspect a multi-task pack to confirm contents
#
# No binary needed — pure akai memory pack / inspect / status.
set -euo pipefail

AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"
WORK_DIR="${TMPDIR:-/tmp}/aurekai-demo-15"
mkdir -p "$WORK_DIR"

echo "================================================================"
echo " demo-15: memory pack — .akmemory artifact pipeline"
echo "================================================================"
echo

# ── 1/5  Single-task pack: support-classify ──────────────────────────────────
echo "[1/5] Pack single-task memory (support-classify) from q4 model..."
$AKAI_CMD memory pack \
  --from "mistral-7b.q4.akmodel" \
  --tasks support-classify \
  --out  "$WORK_DIR/mistral-7b.support-classify.akmemory" \
  | jq '{schema_version, tasks, size_mb, full_model_avoided, model_memory_avoided_download_gb, proof_hash}'
echo

# ── 2/5  Multi-task pack: rag + summarize + brief ────────────────────────────
echo "[2/5] Pack multi-task memory (rag,summarize,brief) from same model..."
$AKAI_CMD memory pack \
  --from "mistral-7b.q4.akmodel" \
  --tasks rag,summarize,brief \
  --out  "$WORK_DIR/mistral-7b.multitask.akmemory" \
  | jq '{tasks, size_mb, contents: {
      feature_centroids: .contents.feature_centroids.count,
      sae_features:      .contents.sae_dictionaries.feature_count,
      routing_layers:    .contents.sae_dictionaries.layers,
      adapter_slots:     .contents.adapter_hints.slots
    }}'
echo

# ── 3/5  Inspect the single-task artifact ────────────────────────────────────
echo "[3/5] Inspect single-task .akmemory artifact..."
$AKAI_CMD memory inspect "$WORK_DIR/mistral-7b.support-classify.akmemory" \
  | jq '{file, tasks, size_mb, valid, contents_summary}'
echo

# ── 4/5  Memory status (daemon registry) ─────────────────────────────────────
echo "[4/5] Memory status (no packs loaded yet — registry check)..."
$AKAI_CMD memory status \
  | jq '{schema_version, loaded_packs, total_size_mb, notes}'
echo

# ── 5/5  Inspect multi-task artifact — verify adapter hints + eval summaries
echo "[5/5] Inspect multi-task .akmemory — adapter hints + eval summaries..."
$AKAI_CMD memory inspect "$WORK_DIR/mistral-7b.multitask.akmemory" \
  | jq '{tasks, size_mb, contents_summary: {adapter_slots: .contents_summary.adapter_slots, semantic_cache_slots: .contents_summary.semantic_cache_slots}}'
echo

echo "================================================================"
echo " demo-15 PASSED — memory pack / inspect / status working"
echo "================================================================"
