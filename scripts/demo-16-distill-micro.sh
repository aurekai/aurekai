#!/usr/bin/env bash
# demo-16-distill-micro.sh — Phase 3a: micro-distill feature slices
#
# Demonstrates:
#   1. Distill a single-feature slice (support-intent) from a q4 model
#   2. Distill a multi-layer routing feature (topic-route)
#   3. Distill a code-detect feature (larger dim)
#   4. Alias check: distill-micro == distill-feature-micro
#   5. Inspect artifact size + fidelity_vs_full
#
# No binary needed — pure akai weights distill-feature-micro.
set -euo pipefail

AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"
WORK_DIR="${TMPDIR:-/tmp}/aurekai-demo-16"
mkdir -p "$WORK_DIR"

echo "================================================================"
echo " demo-16: distill-feature-micro — capability slice extraction"
echo "================================================================"
echo

# ── 1/5  support-intent feature slice ────────────────────────────────────────
echo "[1/5] Distill support-intent feature from q4 model..."
$AKAI_CMD weights distill-feature-micro \
  --from "mistral-7b.q4.akmodel" \
  --feature support-intent \
  --out "$WORK_DIR/mistral-7b.support-intent.akdistill" \
  | jq '{feature_id, feature_family, size_mb, full_model_avoided, fidelity_vs_full,
         distilled_artifact: {sae_cluster: .distilled_artifact.sae_cluster, source_layers: .distilled_artifact.source_layers, feature_dim: .distilled_artifact.feature_dim}}'
echo

# ── 2/5  topic-route (multi-layer routing feature) ───────────────────────────
echo "[2/5] Distill topic-route feature (3 layers — routing family)..."
$AKAI_CMD weights distill-feature-micro \
  --from "mistral-7b.q4.akmodel" \
  --feature topic-route \
  --out "$WORK_DIR/mistral-7b.topic-route.akdistill" \
  | jq '{feature_id, feature_family, size_mb, fidelity_vs_full, bytes_avoided,
         distilled_artifact: {source_layers: .distilled_artifact.source_layers}}'
echo

# ── 3/5  code-detect (high-dim, 3 layers) ────────────────────────────────────
echo "[3/5] Distill code-detect feature (dim=128, 3 layers)..."
$AKAI_CMD weights distill-feature-micro \
  --from "mistral-7b.q4.akmodel" \
  --feature code-detect \
  --out "$WORK_DIR/mistral-7b.code-detect.akdistill" \
  | jq '{feature_id, size_mb, distilled_artifact: {feature_dim: .distilled_artifact.feature_dim, routing_compatible: .distilled_artifact.routing_compatible}}'
echo

# ── 4/5  alias: distill-micro ────────────────────────────────────────────────
echo "[4/5] Alias check — distill-micro (same as distill-feature-micro)..."
$AKAI_CMD weights distill-micro \
  --from "mistral-7b.q4.akmodel" \
  --feature sentiment \
  | jq '{schema_version, feature_id, feature_family, proof_hash}'
echo

# ── 5/5  target model injection ──────────────────────────────────────────────
echo "[5/5] Distill with --target (inject into specific pipeline model)..."
$AKAI_CMD weights distill-feature-micro \
  --from "mistral-7b.q4.akmodel" \
  --feature ner-entity \
  --target "pipeline-v2.akmodel" \
  | jq '{feature_id, target_model, deployment: {standalone: .deployment.standalone, embed_in_pipeline: .deployment.embed_in_pipeline}}'
echo

echo "================================================================"
echo " demo-16 PASSED — distill-feature-micro working"
echo "================================================================"
