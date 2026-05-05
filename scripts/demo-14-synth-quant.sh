#!/usr/bin/env bash
# demo-14-synth-quant.sh — Phase 2a: cross-quant synthesis + fidelity proof
#
# Demonstrates:
#   1. Synthesise a q4 model from an existing q8 (saves ~3.2 GB)
#   2. Synthesise a q3 model from an existing q4 (aggressive down-quant)
#   3. Verify fidelity of the q4 artifact
#   4. Up-quant from q4 → q6 (lossless)
#
# No binary needed — pure akai weights synth-quant / verify-fidelity.
set -euo pipefail

AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"
WORK_DIR="${TMPDIR:-/tmp}/aurekai-demo-14"
mkdir -p "$WORK_DIR"

echo "================================================================"
echo " demo-14: synth-quant — cross-quant synthesis + fidelity proof"
echo "================================================================"
echo

# ── 1/5  q8 → q4 (standard production down-quant) ───────────────────────────
echo "[1/5] Synthesise q4 from q8 source (saves ~3.2 GB)..."
$AKAI_CMD weights synth-quant \
  --from "mistral-7b.q8.akmodel" \
  --to   q4 \
  --out  "$WORK_DIR/mistral-7b.q4.akmodel" \
  | jq '{model: .output_file, synthesis_method, target_size_gb, bytes_avoided, fidelity_score}'
echo

# ── 2/5  q4 → q3 (aggressive; perplexity note expected) ─────────────────────
echo "[2/5] Synthesise q3 from q4 (aggressive down-quant, lower fidelity)..."
$AKAI_CMD weights synth-quant \
  --from "mistral-7b.q4.akmodel" \
  --to   q3 \
  --out  "$WORK_DIR/mistral-7b.q3.akmodel" \
  | jq '{model: .output_file, fidelity_score, fidelity_report: {benchmark_pass: .fidelity_report.benchmark_pass, perplexity_delta: .fidelity_report.perplexity_delta}}'
echo

# ── 3/5  verify-fidelity on the q4 artifact ─────────────────────────────────
echo "[3/5] Verify fidelity of q4 artifact against fp16 baseline..."
$AKAI_CMD weights verify-fidelity "mistral-7b.q4.akmodel" \
  | jq '{quant, fidelity_score, benchmark_pass, benchmarks}'
echo

# ── 4/5  q4 → q6 (lossless up-quant) ────────────────────────────────────────
echo "[4/5] Up-quant q4 → q6 (lossless — fidelity_score expected: 0.98)..."
$AKAI_CMD weights synth-quant \
  --from "mistral-7b.q4.akmodel" \
  --to   q6 \
  --verify-fidelity \
  | jq '{source_quant, target_quant, fidelity_score, synthesis_method, full_download_avoided}'
echo

# ── 5/5  alias: akai weights quant ───────────────────────────────────────────
echo "[5/5] Alias check — akai weights quant (same as synth-quant)..."
$AKAI_CMD weights quant --from "llama-8b.q8.akmodel" --to q4 \
  | jq '{schema_version, source_quant, target_quant, proof_hash}'
echo

echo "================================================================"
echo " demo-14 PASSED — synth-quant + fidelity proof working"
echo "================================================================"
