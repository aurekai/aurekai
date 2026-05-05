#!/usr/bin/env bash
# demo-17-ghost-infer.sh — Phase 3b: ghost inference (zero tensor hydration)
#
# Demonstrates:
#   1. Pure SAE-only ghost inference (no memory pack, no distill)
#   2. Ghost inference with a .akmemory pack (memory-pack route)
#   3. Ghost inference with a .akdistill artifact (distill route)
#   4. Ghost inference with both memory + distill (distill route wins)
#   5. Dry-run route planner (--dry-run shows selected route without executing)
#   6. Alias check: ghost == ghost-infer
#
# Builds on demo-15 (.akmemory) and demo-16 (.akdistill) artifacts.
set -euo pipefail

AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"
WORK_DIR="${TMPDIR:-/tmp}/aurekai-demo-17"
MEM_DIR="${TMPDIR:-/tmp}/aurekai-demo-15"
DISTILL_DIR="${TMPDIR:-/tmp}/aurekai-demo-16"
mkdir -p "$WORK_DIR"

# Pre-populate artifacts if demos 15/16 weren't already run
echo "[setup] Ensuring .akmemory and .akdistill artifacts exist..."
$AKAI_CMD memory pack \
  --from "mistral-7b.q4.akmodel" \
  --tasks support-classify \
  --out "$WORK_DIR/support-classify.akmemory" >/dev/null 2>&1
$AKAI_CMD weights distill-feature-micro \
  --from "mistral-7b.q4.akmodel" \
  --feature support-intent \
  --out "$WORK_DIR/support-intent.akdistill" >/dev/null 2>&1
echo "  artifacts ready."
echo

echo "================================================================"
echo " demo-17: ghost-infer — zero tensor hydration inference"
echo "================================================================"
echo

# ── 1/6  Pure SAE ghost (baseline — no pack, no distill) ─────────────────────
echo "[1/6] SAE-only ghost inference (ladder step 3 — no files needed)..."
$AKAI_CMD weights ghost-infer \
  --recipe "support-classify.akrecipe" \
  --no-weights \
  | jq '{ghost_route, ghost_route_reason, no_weights_loaded, ghost_budget_mb,
         full_model_avoided, bytes_avoided, first_usable_seconds}'
echo

# ── 2/6  .akmemory ghost (memory-pack route) ─────────────────────────────────
echo "[2/6] Ghost inference with .akmemory pack (memory-pack route)..."
$AKAI_CMD weights ghost-infer \
  --recipe "support-classify.akrecipe" \
  --memory "$WORK_DIR/support-classify.akmemory" \
  --no-weights \
  | jq '{ghost_route, tasks_from_memory, ghost_budget_mb,
         inference: {latency_ms: .inference.latency_ms, memory_pack_hit: .inference.memory_pack_hit, sae_gate_hit: .inference.sae_gate_hit}}'
echo

# ── 3/6  .akdistill ghost (distill route) ────────────────────────────────────
echo "[3/6] Ghost inference with .akdistill artifact (distill route)..."
$AKAI_CMD weights ghost-infer \
  --recipe "support-classify.akrecipe" \
  --distill "$WORK_DIR/support-intent.akdistill" \
  --no-weights \
  | jq '{ghost_route, feature_from_distill, ghost_budget_mb,
         inference: {distill_hit: .inference.distill_hit, latency_ms: .inference.latency_ms}}'
echo

# ── 4/6  Both memory + distill (distill route wins) ──────────────────────────
echo "[4/6] Ghost inference with both .akmemory + .akdistill (distill route wins)..."
$AKAI_CMD weights ghost-infer \
  --recipe "support-classify.akrecipe" \
  --memory "$WORK_DIR/support-classify.akmemory" \
  --distill "$WORK_DIR/support-intent.akdistill" \
  --no-weights \
  | jq '{ghost_route, ghost_budget_mb, capability_ready_at_percent, proof_hash}'
echo

# ── 5/6  Dry-run planner ─────────────────────────────────────────────────────
echo "[5/6] Dry-run route planner (--dry-run — no inference executed)..."
$AKAI_CMD weights ghost-infer \
  --recipe "support-classify.akrecipe" \
  --memory "$WORK_DIR/support-classify.akmemory" \
  --dry-run \
  | jq '{ghost_route, dry_run, inference, ghost_budget_mb}'
echo

# ── 6/6  Alias: ghost == ghost-infer ─────────────────────────────────────────
echo "[6/6] Alias check — ghost (same as ghost-infer)..."
$AKAI_CMD weights ghost \
  --recipe "brief.akrecipe" \
  --no-weights \
  | jq '{schema_version, ghost_route, full_model_avoided, proof_hash}'
echo

echo "================================================================"
echo " demo-17 PASSED — ghost-infer (zero tensor hydration) working"
echo "================================================================"
