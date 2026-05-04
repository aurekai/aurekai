#!/usr/bin/env bash
# demo-19-serve-cdn.sh — Phase 4b: AI-CDN multi-region serve plan
#
# Demonstrates:
#   1. Single-region CDN plan (us-east-1)
#   2. All-regions CDN plan with default settings
#   3. Prefetch flag + custom TTL (48h) + chunk size
#   4. Dry-run mode (plan without activating)
#   5. cdn status command (registry)
#   6. Alias: akai weights cdn
#
# No binary needed — pure akai weights serve-cdn.
set -euo pipefail

AKAI_CMD="${AKAI_CMD:-$(command -v akai 2>/dev/null || echo "node $(dirname "$0")/../bin/akai.mjs")}"

echo "================================================================"
echo " demo-19: serve-cdn — AI-CDN multi-region weight serving"
echo "================================================================"
echo

# ── 1/6  Single region: us-east-1 ────────────────────────────────────────────
echo "[1/6] Single-region CDN plan (us-east-1, default TTL 24h, chunk 64 MB)..."
$AKAI_CMD weights serve-cdn \
  --model "mistral-7b.q4.akmodel" \
  --region us-east-1 \
  | jq '{model, serve_uri, summary: {regions_served: .summary.regions_served, total_transfer_gb: .summary.total_transfer_gb, full_push_avoided_gb: .summary.full_push_avoided_gb, avg_latency_ms: .summary.avg_latency_ms, total_cost_usd: .summary.total_cost_usd}}'
echo

# ── 2/6  All regions (global plan) ───────────────────────────────────────────
echo "[2/6] All-regions global CDN plan..."
$AKAI_CMD weights serve-cdn \
  --model "mistral-7b.q4.akmodel" \
  --region all \
  | jq '{summary, cdn_plan: [.cdn_plan[] | {region, latency_ms, cache_hit_rate, transfer_gb, cost_usd_estimate}]}'
echo

# ── 3/6  Prefetch + custom TTL + smaller chunks ───────────────────────────────
echo "[3/6] Prefetch enabled, TTL=48h, chunk=32 MB..."
$AKAI_CMD weights serve-cdn \
  --model "llama-8b.q4.akmodel" \
  --region eu-west-1 \
  --ttl 48 \
  --chunk-mb 32 \
  --prefetch \
  | jq '{model, config: {ttl_hours: .config.ttl_hours, chunk_mb: .config.chunk_mb, chunk_count: .config.chunk_count, prefetch: .config.prefetch}, cdn_plan: [.cdn_plan[] | {region, chunks_needed, transfer_gb}]}'
echo

# ── 4/6  Dry-run mode ────────────────────────────────────────────────────────
echo "[4/6] Dry-run — compute plan without activating..."
$AKAI_CMD weights serve-cdn \
  --model "mistral-7b.q4.akmodel" \
  --region ap-south-1 \
  --dry-run \
  | jq '{dry_run, serve_uri, cdn_plan: [.cdn_plan[] | {region, transfer_gb, cost_usd_estimate}], proof_hash}'
echo

# ── 5/6  CDN status (registry) ───────────────────────────────────────────────
echo "[5/6] CDN status (no active plans)..."
$AKAI_CMD weights cdn status \
  | jq '{schema_version, active_plans, total_regions, notes}'
echo

# ── 6/6  Alias: cdn == serve-cdn ─────────────────────────────────────────────
echo "[6/6] Alias check — akai weights cdn (same as serve-cdn)..."
$AKAI_CMD weights cdn \
  --model "phi-3-mini.q4.akmodel" \
  --region us-west-2 \
  --dry-run \
  | jq '{schema_version, model, summary: {avg_latency_ms: .summary.avg_latency_ms, total_cost_usd: .summary.total_cost_usd}}'
echo

echo "================================================================"
echo " demo-19 PASSED — serve-cdn AI-CDN plan working"
echo "================================================================"
