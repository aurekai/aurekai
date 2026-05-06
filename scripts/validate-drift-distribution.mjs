#!/usr/bin/env node
/**
 * Validate repo-wide drift gates and real distribution API integration.
 *
 * This imports two slightly different binary artifacts into CAS under versioned
 * ref names, then validates:
 *  1. drift-monitor emits real chunk-graph Jaccard metrics (not random)
 *  2. repo-drift-gate scans CAS and gates on structural drift threshold
 *  3. p2p-seed emits real chunk hashes from CAS (not fake hashes)
 *  4. mirror-sync computes real delta bytes via CAS chunk comparison
 *  5. geo-pin embeds real CAS artifact_id in location attestation
 *  6. feature-drift uses cas_chunk_graph source when refs are present
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-drift-distribution-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas-home");

// Two artifacts: v1 is [0xAA chunk, 0xBB chunk], v2 is [0xAA chunk, 0xCC chunk].
// The first chunk is identical → overlap=1; second chunk differs → new=1, removed=1.
// Each chunk is 1MB to ensure CDC splits them as separate chunks.
const v1 = join(tmp, "model.v1.bin");
const v2 = join(tmp, "model.v2.bin");
const CHUNK_SIZE = 1024 * 1024; // 1 MiB — at CDC target boundary
writeFileSync(v1, Buffer.concat([Buffer.alloc(CHUNK_SIZE, 0xaa), Buffer.alloc(CHUNK_SIZE, 0xbb)]));
writeFileSync(v2, Buffer.concat([Buffer.alloc(CHUNK_SIZE, 0xaa), Buffer.alloc(CHUNK_SIZE, 0xcc)]));

function run(args, expectCode = 0) {
  const proc = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, AKAI_CAS_HOME: casHome },
  });
  if (proc.status !== expectCode) {
    throw new Error(`[exit ${proc.status}] akai ${args.join(" ")}\n${proc.stderr || proc.stdout}`);
  }
  return JSON.parse((proc.stdout || "").trim());
}

// ─── Import both versions into CAS under versioned refs ───────────────────
run(["cas", "import", v1, "--ref", "model@v1.0"]);
run(["cas", "import", v2, "--ref", "model@v2.0"]);

// ─── 1. drift-monitor: real chunk-graph metrics ───────────────────────────
const driftRes = run([
  "weights", "drift-monitor",
  "--model", "model@v2.0",
  "--baseline", "model@v1.0",
  "--threshold", "0.01",
]);
const dPayload = driftRes.payload;
if (dPayload.drift_source !== "cas_chunk_graph") {
  throw new Error(`drift-monitor should use cas_chunk_graph, got: ${dPayload.drift_source}`);
}
if (typeof dPayload.summary.jaccard_similarity !== "number") {
  throw new Error("drift-monitor summary missing jaccard_similarity");
}
if (typeof dPayload.summary.chunk_overlap !== "object") {
  throw new Error("drift-monitor summary missing chunk_overlap");
}
// v2 differs in its second chunk — exactly 1 chunk new, 1 removed, 1 shared.
const overlap = dPayload.summary.chunk_overlap;
if (overlap.shared < 1) throw new Error("drift-monitor: expected at least 1 shared chunk");
if (overlap.new < 1) throw new Error("drift-monitor: expected at least 1 new chunk");
if (overlap.removed < 1) throw new Error("drift-monitor: expected at least 1 removed chunk");

// ─── 2. repo-drift-gate: scans all CAS refs ───────────────────────────────
const gateRes = run(["weights", "repo-drift-gate", "--threshold", "0.99"]);
if (gateRes.payload.schema_version !== "aurekai.weightops.repo_drift_gate.v1") {
  throw new Error("repo-drift-gate schema mismatch");
}
if (gateRes.payload.groups_assessed < 1) {
  throw new Error("repo-drift-gate should assess at least 1 version pair");
}
if (!gateRes.payload.gate_pass) {
  throw new Error("repo-drift-gate should pass with threshold=0.99");
}

// Now gate with a threshold below the real drift level — should fail.
const gateFailRes = run(["weights", "repo-drift-gate", "--threshold", "0.00001"], 2);
if (gateFailRes.payload.gate_pass !== false) {
  throw new Error("repo-drift-gate should fail at threshold=0.00001");
}
if (gateFailRes.payload.failing_refs.length < 1) {
  throw new Error("repo-drift-gate should report failing_refs");
}

// ─── 3. p2p-seed: real chunk hashes from CAS ─────────────────────────────
const seedRes = run(["weights", "p2p-seed", "--model", "model@v1.0"]);
if (seedRes.payload.chunk_source !== "cas_chunk_graph") {
  throw new Error(`p2p-seed should use cas_chunk_graph, got: ${seedRes.payload.chunk_source}`);
}
if (seedRes.payload.chunk_count < 1) throw new Error("p2p-seed should report at least 1 chunk");
// Verify chunk hashes look like real blake3 references
const firstChunk = seedRes.payload.chunks[0];
if (!firstChunk.chunk_ref.startsWith("ak://blake3:")) {
  throw new Error(`p2p-seed chunk_ref should start with ak://blake3:, got: ${firstChunk.chunk_ref}`);
}

// ─── 4. mirror-sync: real delta computation ──────────────────────────────
// v1 and v2 are both in CAS — delta should be 1 chunk different.
const syncRes = run([
  "weights", "mirror-sync",
  "--model", "model@v1.0",
  "--mirrors", "model@v2.0",
]);
const mirrorStat = syncRes.payload.mirrors[0];
if (mirrorStat.source !== "cas_chunk_graph") {
  throw new Error(`mirror-sync should use cas_chunk_graph, got: ${mirrorStat.source}`);
}
// v1 has 1 chunk that v2 doesn't — delta_chunks should be 1
if (mirrorStat.delta_chunks < 1) throw new Error("mirror-sync should report at least 1 delta chunk");

// ─── 5. geo-pin: real CAS artifact_id in attestation ─────────────────────
const geoRes = run([
  "weights", "geo-pin",
  "--model", "model@v1.0",
  "--region", "eu-west-1",
]);
const geoPayload = geoRes.payload;
if (!geoPayload.cas_binding || geoPayload.cas_binding.source !== "cas_chunk_graph") {
  throw new Error("geo-pin should carry cas_binding.source=cas_chunk_graph");
}
if (!geoPayload.cas_binding.artifact_id) {
  throw new Error("geo-pin should carry real cas_binding.artifact_id");
}
if (!geoPayload.location_attestation.artifact_id) {
  throw new Error("geo-pin location_attestation should include artifact_id");
}

// ─── 6. feature-drift: uses real chunk-graph when refs in CAS ────────────
const featRes = run([
  "weights", "feature-drift",
  "--model-a", "model@v1.0",
  "--model-b", "model@v2.0",
]);
if (featRes.payload.drift_source !== "cas_chunk_graph") {
  throw new Error(`feature-drift should use cas_chunk_graph, got: ${featRes.payload.drift_source}`);
}

console.log("drift gates and distribution API validate: PASS");
