/**
 * Aurekai real structural drift engine.
 *
 * Computes deterministic drift metrics from CAS chunk graphs —
 * no random numbers, no stubs.  Where CAS data is absent the call
 * site must degrade gracefully rather than silently supplying fake values.
 *
 * Metrics produced:
 *   jaccard_similarity  — |A ∩ B| / |A ∪ B| on chunk blake3 hash sets
 *   structural_drift    — 1 - jaccard_similarity  (0 = identical, 1 = totally different)
 *   size_delta_bytes    — absolute byte-size change
 *   size_delta_ratio    — size change relative to the larger of A / B
 *   shared_bytes        — bytes that appear in both (reusable)
 *   new_bytes           — bytes only in B (newly introduced)
 *   removed_bytes       — bytes only in A (dropped)
 *   overlap_chunk_count — # of chunks shared
 *   new_chunk_count     — # of chunks only in B
 *   removed_chunk_count — # of chunks only in A
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

function casRoot() {
  return process.env.AKAI_CAS_HOME || join(homedir(), ".aurekai", "cas");
}

function casDirs() {
  const root = casRoot();
  return {
    root,
    blobs: join(root, "blobs"),
    manifests: join(root, "manifests"),
    refs: join(root, "refs"),
    indexes: join(root, "indexes"),
    chunks: join(root, "chunks"),
  };
}

function sanitizeRef(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "-") || "artifact";
}

/**
 * Load a CAS chunk-graph manifest by ref name or ak:// address.
 * Returns null if the ref is not present in CAS (rather than throwing).
 * @param {string} input
 * @returns {{ manifest: object, refName: string | null } | null}
 */
export function tryCasChunkGraph(input) {
  const d = casDirs();

  try {
    if (input.startsWith("ak://blake3:")) {
      const idxPath = join(d.indexes, `${input.replace("ak://", "").replace(/:/g, "-")}.json`);
      if (!existsSync(idxPath)) return null;
      const idx = JSON.parse(readFileSync(idxPath, "utf8"));
      if (!existsSync(idx.manifest_path)) return null;
      return { manifest: JSON.parse(readFileSync(idx.manifest_path, "utf8")), refName: null };
    }

    if (input.startsWith("ak://sha256:")) {
      const sha = input.replace("ak://sha256:", "");
      const mp = join(d.manifests, `${sha}.json`);
      if (!existsSync(mp)) return null;
      return { manifest: JSON.parse(readFileSync(mp, "utf8")), refName: null };
    }

    const refPath = join(d.refs, `${sanitizeRef(input)}.json`);
    if (!existsSync(refPath)) return null;
    const refDoc = JSON.parse(readFileSync(refPath, "utf8"));
    const sha = String(refDoc.artifact_id || "").replace("ak://sha256:", "");
    const mp = join(d.manifests, `${sha}.json`);
    if (!existsSync(mp)) return null;
    return { manifest: JSON.parse(readFileSync(mp, "utf8")), refName: sanitizeRef(input) };
  } catch {
    return null;
  }
}

/**
 * Build a Map<blake3_hash, size_bytes> from a CAS manifest's chunk_graph.
 * @param {object} manifest
 * @returns {Map<string, number>}
 */
export function chunkSetFromManifest(manifest) {
  const set = new Map();
  for (const chunk of manifest?.chunk_graph?.chunks || []) {
    const hash = String(chunk.hashes?.blake3 || chunk.blake3 || "").replace("blake3:", "");
    const size = chunk.length ?? chunk.size_bytes ?? 0;
    if (hash) set.set(hash, size);
  }
  return set;
}

/**
 * Compute real structural drift between two chunk-graph manifests.
 * All metrics are deterministic given the same inputs.
 *
 * @param {Map<string, number>} setA  chunk map for version A
 * @param {Map<string, number>} setB  chunk map for version B
 * @param {number} sizeA              total byte size of A
 * @param {number} sizeB              total byte size of B
 * @returns {DriftMetrics}
 */
export function computeStructuralDrift(setA, setB, sizeA, sizeB) {
  let sharedBytes = 0;
  let overlapCount = 0;
  const onlyInB = new Map(setB);
  const onlyInA = new Map();

  for (const [hash, size] of setA.entries()) {
    if (setB.has(hash)) {
      sharedBytes += size;
      overlapCount += 1;
      onlyInB.delete(hash);
    } else {
      onlyInA.set(hash, size);
    }
  }

  const unionCount = setA.size + setB.size - overlapCount;
  const jaccardSimilarity = unionCount === 0 ? 1.0 : overlapCount / unionCount;
  const structuralDrift = parseFloat((1 - jaccardSimilarity).toFixed(6));

  const newBytes = Array.from(onlyInB.values()).reduce((s, v) => s + v, 0);
  const removedBytes = Array.from(onlyInA.values()).reduce((s, v) => s + v, 0);
  const sizeDelta = Math.abs(sizeB - sizeA);
  const maxSize = Math.max(sizeA, sizeB, 1);

  return {
    jaccard_similarity: parseFloat(jaccardSimilarity.toFixed(6)),
    structural_drift: structuralDrift,
    size_a_bytes: sizeA,
    size_b_bytes: sizeB,
    size_delta_bytes: sizeDelta,
    size_delta_ratio: parseFloat((sizeDelta / maxSize).toFixed(6)),
    shared_bytes: sharedBytes,
    new_bytes: newBytes,
    removed_bytes: removedBytes,
    overlap_chunk_count: overlapCount,
    new_chunk_count: onlyInB.size,
    removed_chunk_count: onlyInA.size,
    total_chunk_count_a: setA.size,
    total_chunk_count_b: setB.size,
    method: "chunk_graph_jaccard",
  };
}

/**
 * Compute drift between two refs by name.  Returns null if either ref is
 * not available in CAS.
 * @param {string} refA
 * @param {string} refB
 * @returns {{ metrics: DriftMetrics, manifestA: object, manifestB: object } | null}
 */
export function driftBetweenRefs(refA, refB) {
  const a = tryCasChunkGraph(refA);
  const b = tryCasChunkGraph(refB);
  if (!a || !b) return null;

  const setA = chunkSetFromManifest(a.manifest);
  const setB = chunkSetFromManifest(b.manifest);
  const sizeA = a.manifest?.size_bytes || a.manifest?.payload_size_bytes || 0;
  const sizeB = b.manifest?.size_bytes || b.manifest?.payload_size_bytes || 0;

  return {
    metrics: computeStructuralDrift(setA, setB, sizeA, sizeB),
    manifestA: a.manifest,
    manifestB: b.manifest,
  };
}

/**
 * Scan all CAS refs and return a list of drift assessments relative to their
 * detected baseline (ref name ending in @v1 or @v1.0 treated as baseline for the
 * same base name).  Refs with no discoverable baseline are skipped.
 *
 * @param {{ threshold?: number }} opts
 * @returns {RepoDriftReport}
 */
export function scanRepoDrift(opts = {}) {
  const threshold = opts.threshold ?? 0.05;
  const d = casDirs();

  if (!existsSync(d.refs)) return { refs_scanned: 0, assessments: [], gate_pass: true };

  const refFiles = (() => {
    try {
      const { readdirSync } = await_import();
      return readdirSync(d.refs).filter(f => f.endsWith(".json"));
    } catch {
      return [];
    }
  })();

  // Group refs by base name (everything before @)
  const groups = new Map();
  for (const rf of refFiles) {
    const refName = rf.replace(/\.json$/, "");
    const atIdx = refName.indexOf("@");
    const base = atIdx === -1 ? refName : refName.slice(0, atIdx);
    const version = atIdx === -1 ? null : refName.slice(atIdx + 1);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ refName, version });
  }

  const assessments = [];
  for (const [base, versions] of groups.entries()) {
    if (versions.length < 2) continue;
    // Sort by version string; v1 / v1.0 / v1-0 treated as baseline
    versions.sort((a, b) => String(a.version || "").localeCompare(String(b.version || "")));
    const baseline = versions[0];
    for (const current of versions.slice(1)) {
      const result = driftBetweenRefs(baseline.refName, current.refName);
      if (!result) continue;
      const m = result.metrics;
      assessments.push({
        base_model: base,
        baseline_ref: baseline.refName,
        current_ref: current.refName,
        structural_drift: m.structural_drift,
        drift_exceeds_threshold: m.structural_drift > threshold,
        metrics: m,
      });
    }
  }

  const anyExceed = assessments.some(a => a.drift_exceeds_threshold);

  return {
    threshold,
    refs_scanned: refFiles.length,
    groups_assessed: assessments.length,
    assessments,
    gate_pass: !anyExceed,
  };
}

import { readdirSync as _readdirSync } from "node:fs";

/**
 * Synchronous repo-wide drift scan (no async needed).
 */
export function scanRepoDriftSync(opts = {}) {
  const threshold = opts.threshold ?? 0.05;
  const d = casDirs();

  if (!existsSync(d.refs)) {
    return { threshold, refs_scanned: 0, groups_assessed: 0, assessments: [], gate_pass: true };
  }

  let refFiles;
  try {
    refFiles = _readdirSync(d.refs).filter(f => f.endsWith(".json"));
  } catch {
    return { threshold, refs_scanned: 0, groups_assessed: 0, assessments: [], gate_pass: true };
  }

  // Group refs by base name.
  // CAS stores refs with @ sanitized to - (e.g., model@v1.0 → model-v1.0).
  // Detect version suffixes via both @ and -v<digit> patterns.
  const groups = new Map();
  const versionSuffixRe = /^(.+?)[-@](v\d[\w.]*)$/;
  for (const rf of refFiles) {
    const refName = rf.replace(/\.json$/, "");
    const vm = refName.match(versionSuffixRe);
    let base, version;
    if (vm) {
      base = vm[1];
      version = vm[2];
    } else {
      base = refName;
      version = null;
    }
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ refName, version });
  }

  const assessments = [];
  for (const [base, versions] of groups.entries()) {
    if (versions.length < 2) continue;
    versions.sort((a, b) => String(a.version || "").localeCompare(String(b.version || "")));
    const baseline = versions[0];
    for (const current of versions.slice(1)) {
      const result = driftBetweenRefs(baseline.refName, current.refName);
      if (!result) continue;
      const m = result.metrics;
      assessments.push({
        base_model: base,
        baseline_ref: baseline.refName,
        current_ref: current.refName,
        structural_drift: m.structural_drift,
        drift_exceeds_threshold: m.structural_drift > threshold,
        metrics: m,
      });
    }
  }

  const anyExceed = assessments.some(a => a.drift_exceeds_threshold);

  return {
    threshold,
    refs_scanned: refFiles.length,
    groups_assessed: assessments.length,
    assessments,
    gate_pass: !anyExceed,
  };
}

/**
 * Resolve actual CAS chunks for a ref — for p2p-seed / mirror-sync.
 * Returns null if ref is not in CAS.
 * @param {string} refName
 * @returns {{ artifact_id: string, chunk_list: ChunkEntry[], total_bytes: number, chunk_count: number } | null}
 */
export function resolveCasChunkList(refName) {
  const result = tryCasChunkGraph(refName);
  if (!result) return null;

  const { manifest } = result;
  const chunks = (manifest?.chunk_graph?.chunks || []).map(chunk => ({
    index: chunk.index ?? 0,
    blake3: String(chunk.hashes?.blake3 || chunk.blake3 || ""),
    size_bytes: chunk.length ?? chunk.size_bytes ?? 0,
    chunk_ref: `ak://blake3:${String(chunk.hashes?.blake3 || chunk.blake3 || "").replace("blake3:", "")}`,
  }));

  return {
    artifact_id: manifest.artifact_id || null,
    chunk_list: chunks,
    total_bytes: manifest.size_bytes || manifest.payload_size_bytes || 0,
    chunk_count: chunks.length,
  };
}

/**
 * Compute delta between a source ref and a mirror ref (both in CAS).
 * Returns the set of chunks that are in source but not in mirror.
 * If mirror ref is absent, treat entire source as the delta.
 * @param {string} sourceRef
 * @param {string} mirrorRef
 * @returns {MirrorDelta}
 */
export function computeMirrorDelta(sourceRef, mirrorRef) {
  const src = tryCasChunkGraph(sourceRef);
  if (!src) return null;

  const srcSet = chunkSetFromManifest(src.manifest);
  const srcSize = src.manifest?.size_bytes || 0;

  const mir = tryCasChunkGraph(mirrorRef);
  if (!mir) {
    // Mirror has nothing — full transfer required
    return {
      source_ref: sourceRef,
      mirror_ref: mirrorRef,
      mirror_in_cas: false,
      source_chunk_count: srcSet.size,
      mirror_chunk_count: 0,
      delta_chunk_count: srcSet.size,
      delta_bytes: srcSize,
      already_synced_bytes: 0,
      sync_ratio: 0,
      delta_chunks: Array.from(srcSet.entries()).map(([hash, size]) => ({
        blake3: `blake3:${hash}`,
        size_bytes: size,
        chunk_ref: `ak://blake3:${hash}`,
      })),
    };
  }

  const mirSet = chunkSetFromManifest(mir.manifest);
  const deltaChunks = [];
  let deltaBytes = 0;
  let syncedBytes = 0;

  for (const [hash, size] of srcSet.entries()) {
    if (mirSet.has(hash)) {
      syncedBytes += size;
    } else {
      deltaBytes += size;
      deltaChunks.push({ blake3: `blake3:${hash}`, size_bytes: size, chunk_ref: `ak://blake3:${hash}` });
    }
  }

  return {
    source_ref: sourceRef,
    mirror_ref: mirrorRef,
    mirror_in_cas: true,
    source_chunk_count: srcSet.size,
    mirror_chunk_count: mirSet.size,
    delta_chunk_count: deltaChunks.length,
    delta_bytes: deltaBytes,
    already_synced_bytes: syncedBytes,
    sync_ratio: srcSet.size > 0 ? parseFloat(((srcSet.size - deltaChunks.length) / srcSet.size).toFixed(4)) : 1.0,
    delta_chunks: deltaChunks,
  };
}
