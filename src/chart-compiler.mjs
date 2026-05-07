/**
 * src/chart-compiler.mjs
 *
 * Internal chart compiler — no user-facing surface.
 *
 * Maps heterogeneous Akai runtime state into a shared 8D coordinate frame,
 * then snaps to the nearest E8 lattice cell. The result is attached as
 * optional metadata on JSON output from existing commands.
 *
 * The design intent: every meaningful state object in Akai can optionally
 * declare:
 *   chart_id     — which chart was applied
 *   e8_cell      — the 8D discrete coordinate [c₀ … c₇]
 *   residual_norm — how far the raw coords were from the snapped cell
 *   witness_hash — SHA-256(cellKey + ":" + content_hash)
 *
 * This is NOT a user-facing embedding or a new command family.
 * It is the "connective tissue" that lets space, memory, vec, proof, and
 * model-block state share a common local coordinate system.
 *
 * Charts:
 *   text_proof   — text / proof / artifact content (SHA-256 → 8D)
 *   geo_runtime  — lat/lon/latency/region features
 *   memory       — task profile / feature / cache slot counts
 *   model_block  — eta_L, eta_R, spectral_gap, rank, energy, etc.
 *   generic      — fallback: serialize input → SHA-256 → 8D
 *
 * Exports:
 *   compile(chartType, input)  → { chart_id, coords, e8_cell, residual_norm, witness_hash }
 *   detectChart(input)         → chartType string (best-effort)
 */

import { createHash } from "node:crypto";
import { snapE8, cellKey } from "./e8-lattice.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Map 4 bytes from a Buffer to a float in [-2, 2].
 * Deterministic, no randomness.
 */
function bytesToFloat(buf, offset) {
  const u32 = ((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0;
  return (u32 / 0xFFFFFFFF) * 4 - 2;
}

/** Produce 8 floats in [-2, 2] from the first 32 bytes of a SHA-256 digest. */
function hashTo8D(hash32) {
  return Array.from({ length: 8 }, (_, i) => bytesToFloat(hash32, i * 4));
}

/** Clamp + linearly scale x from [lo, hi] into [-2, 2]. */
function scale(x, lo, hi) {
  const clamped = Math.max(lo, Math.min(hi, x));
  return ((clamped - lo) / (hi - lo)) * 4 - 2;
}

// ── chart functions ───────────────────────────────────────────────────────────

/**
 * text_proof chart
 * Input: string | Buffer | { text?, hash?, content_hash? }
 * Maps content via SHA-256 → 8D float coords.
 * Similar texts produce nearby cells because SHA-256 has good avalanche,
 * but more importantly exact-match produces the same cell (idempotent).
 */
function chartTextProof(input) {
  let raw;
  if (typeof input === "string") {
    raw = Buffer.from(input);
  } else if (Buffer.isBuffer(input)) {
    raw = input;
  } else if (input && typeof input === "object") {
    // Prefer a pre-computed hash over re-hashing the object
    const hex = (input.hash ?? input.content_hash ?? input.text_hash ?? "")
      .replace(/^sha256:/, "");
    if (hex.length >= 32) {
      return hashTo8D(Buffer.from(hex.slice(0, 64), "hex"));
    }
    const text = input.text ?? input.content ?? JSON.stringify(input);
    raw = Buffer.from(String(text));
  } else {
    raw = Buffer.from(String(input));
  }
  return hashTo8D(createHash("sha256").update(raw).digest());
}

/**
 * geo_runtime chart
 * Input: { lat?, lon?, latency_ms?, region_index?, bandwidth_mbps?,
 *           relay_count?, cache_hit_rate?, error_rate? }
 * Encodes spatial and runtime characteristics into 8D.
 * Dimensions with missing data fall back to a hash of the serialized input.
 */
function chartGeoRuntime(input) {
  const inp = (typeof input === "object" && input) ? input : {};
  const fallbackHash = createHash("sha256").update(JSON.stringify(inp)).digest();

  const dims = [
    inp.lat          != null ? scale(inp.lat, -90, 90)        : bytesToFloat(fallbackHash, 0),
    inp.lon          != null ? scale(inp.lon, -180, 180)       : bytesToFloat(fallbackHash, 4),
    inp.latency_ms   != null ? scale(Math.log1p(inp.latency_ms), 0, Math.log1p(2000)) * 2 - 2
                             : bytesToFloat(fallbackHash, 8),
    inp.region_index != null ? scale(inp.region_index, 0, 255) : bytesToFloat(fallbackHash, 12),
    inp.bandwidth_mbps != null ? scale(Math.log1p(inp.bandwidth_mbps), 0, Math.log1p(10000)) * 2 - 2
                              : bytesToFloat(fallbackHash, 16),
    inp.relay_count  != null ? scale(inp.relay_count, 0, 16)   : bytesToFloat(fallbackHash, 20),
    inp.cache_hit_rate != null ? scale(inp.cache_hit_rate, 0, 1) : bytesToFloat(fallbackHash, 24),
    inp.error_rate   != null ? scale(inp.error_rate, 0, 1) * -2 : bytesToFloat(fallbackHash, 28),
  ];
  return dims;
}

/**
 * memory chart
 * Input: { task_count?, feature_count?, slot_count?, proof_hash?,
 *           sae_dim?, routing_layers?, cache_slots?, revision? }
 * Captures compact memory state geometry.
 */
function chartMemory(input) {
  const inp = (typeof input === "object" && input) ? input : {};
  const fallbackHash = createHash("sha256").update(JSON.stringify(inp)).digest();

  const dims = [
    inp.task_count    != null ? scale(inp.task_count, 0, 1000)  : bytesToFloat(fallbackHash, 0),
    inp.feature_count != null ? scale(inp.feature_count, 0, 4096) : bytesToFloat(fallbackHash, 4),
    inp.slot_count    != null ? scale(inp.slot_count, 0, 256)   : bytesToFloat(fallbackHash, 8),
    inp.sae_dim       != null ? scale(Math.log2(Math.max(1, inp.sae_dim)), 0, 16) * 2 - 2
                             : bytesToFloat(fallbackHash, 12),
    inp.routing_layers != null ? scale(inp.routing_layers, 0, 32) : bytesToFloat(fallbackHash, 16),
    inp.cache_slots   != null ? scale(inp.cache_slots, 0, 512)  : bytesToFloat(fallbackHash, 20),
    inp.revision      != null ? scale(inp.revision % 256, 0, 255) : bytesToFloat(fallbackHash, 24),
    // dim 7: proof hash entropy
    (() => {
      const hex = (inp.proof_hash ?? inp.witness_hash ?? "").replace(/^sha256:/, "");
      if (hex.length >= 8) return bytesToFloat(Buffer.from(hex.slice(0, 8), "hex"), 0);
      return bytesToFloat(fallbackHash, 28);
    })(),
  ];
  return dims;
}

/**
 * model_block chart
 * Input: { eta_L?, eta_R?, spectral_gap?, effective_rank?,
 *           energy_closure?, subspace_compatibility?,
 *           layer_index?, block_type? }
 * Maps block-local model-state invariants to 8D.
 * Aligns with the FPQ/RLF quantization path in the Bonfyre runtime.
 */
function chartModelBlock(input) {
  const inp = (typeof input === "object" && input) ? input : {};
  const fallbackHash = createHash("sha256").update(JSON.stringify(inp)).digest();

  // Normalize: most of these are in [0, 1] by convention; spectral_gap can be larger.
  const dims = [
    inp.eta_L                != null ? scale(inp.eta_L, 0, 1)                       : bytesToFloat(fallbackHash, 0),
    inp.eta_R                != null ? scale(inp.eta_R, 0, 1)                       : bytesToFloat(fallbackHash, 4),
    inp.spectral_gap         != null ? scale(Math.min(inp.spectral_gap, 10), 0, 10) : bytesToFloat(fallbackHash, 8),
    inp.effective_rank       != null ? scale(Math.log2(Math.max(1, inp.effective_rank)), 0, 12) * 2 - 2
                                    : bytesToFloat(fallbackHash, 12),
    inp.energy_closure       != null ? scale(inp.energy_closure, 0, 1)              : bytesToFloat(fallbackHash, 16),
    inp.subspace_compatibility != null ? scale(inp.subspace_compatibility, 0, 1)    : bytesToFloat(fallbackHash, 20),
    inp.layer_index          != null ? scale(inp.layer_index, 0, 256)               : bytesToFloat(fallbackHash, 24),
    // block type as dim 7: hash of block_type string
    (() => {
      if (inp.block_type) return bytesToFloat(createHash("sha256").update(inp.block_type).digest(), 0);
      return bytesToFloat(fallbackHash, 28);
    })(),
  ];
  return dims;
}

/**
 * generic chart — fallback for unknown input types.
 * Serializes to JSON (or stringifies) then uses SHA-256 → 8D.
 */
function chartGeneric(input) {
  let raw;
  if (typeof input === "string") raw = Buffer.from(input);
  else if (Buffer.isBuffer(input)) raw = input;
  else raw = Buffer.from(JSON.stringify(input ?? ""));
  return hashTo8D(createHash("sha256").update(raw).digest());
}

// ── chart dispatcher ──────────────────────────────────────────────────────────

const CHART_FNS = {
  text_proof:  chartTextProof,
  geo_runtime: chartGeoRuntime,
  memory:      chartMemory,
  model_block: chartModelBlock,
  generic:     chartGeneric,
};

/**
 * Compile any Akai runtime state to an E8 cell annotation.
 *
 * @param {string} chartType  One of: text_proof | geo_runtime | memory | model_block | generic
 * @param {*}      input      Chart-specific input (see above)
 * @returns {object} {
 *   chart_id:      string,
 *   coords:        number[8],   // raw 8D coordinates before snapping
 *   e8_cell:       number[8],   // nearest E8 lattice point
 *   cell_key:      string,      // human-readable cell identifier
 *   residual_norm: number,      // quantization error ||coords - e8_cell||
 *   witness_hash:  string,      // sha256(cell_key + ":" + content_hash)
 * }
 */
export function compile(chartType, input) {
  const fn = CHART_FNS[chartType] ?? CHART_FNS.generic;
  const coords = fn(input);

  const { cell, residualNorm } = snapE8(coords);
  const key = cellKey(cell);

  // Witness: bind the cell address to the content hash
  const contentHash = sha256hex(Buffer.from(JSON.stringify(input ?? "")));
  const witnessHash = "sha256:" + sha256hex(Buffer.from(`${key}:${contentHash}`));

  return {
    chart_id:      chartType in CHART_FNS ? chartType : "generic",
    coords:        coords.map(v => parseFloat(v.toFixed(6))),
    e8_cell:       cell,
    cell_key:      key,
    residual_norm: residualNorm,
    witness_hash:  witnessHash,
  };
}

/**
 * Best-effort chart type detection from an input object's shape.
 * Falls back to "generic" when type is not obvious.
 */
export function detectChart(input) {
  if (!input || typeof input !== "object") return "text_proof";
  const keys = Object.keys(input);
  if (keys.some(k => ["eta_L", "eta_R", "spectral_gap", "effective_rank"].includes(k))) return "model_block";
  if (keys.some(k => ["lat", "lon", "latency_ms", "region_index"].includes(k))) return "geo_runtime";
  if (keys.some(k => ["task_count", "feature_count", "slot_count", "sae_dim"].includes(k))) return "memory";
  if (keys.some(k => ["text", "content", "proof_hash", "text_hash"].includes(k))) return "text_proof";
  return "generic";
}
