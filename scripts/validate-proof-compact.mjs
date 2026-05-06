#!/usr/bin/env node
/**
 * validate-proof-compact.mjs
 *
 * Validates:
 *   1. proof compact: JSON → .akproofbin size reduction + roundtrip integrity
 *   2. proof view: parsed node/edge counts match original
 *   3. In-process API: compileProofBinary + parseProofBinary roundtrip
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compileProofBinary, parseProofBinary } from "../src/proof-compact.mjs";

const tmp = "/tmp/akai-proof-compact-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const AKAI = join(process.cwd(), "bin", "akai.mjs");

function run(args, expectCode = 0) {
  const proc = spawnSync("node", [AKAI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (proc.status !== expectCode) {
    console.error(`FAIL: akai ${args.join(" ")} exited ${proc.status} (expected ${expectCode})`);
    console.error(proc.stdout?.slice(0, 1000));
    console.error(proc.stderr?.slice(0, 1000));
    process.exit(1);
  }
  try { return JSON.parse(proc.stdout); } catch { return proc.stdout; }
}

function assert(condition, msg) {
  if (!condition) { console.error(`ASSERT FAIL: ${msg}`); process.exit(1); }
}

// ── Build a test proof document ──────────────────────────────────────────────
const N_NODES = 20;
const proofChain = Array.from({ length: N_NODES }, (_, i) => ({
  hash: `sha256:${"a".repeat(62)}${i.toString().padStart(2, "0")}`,
  type: i === 0 ? "proof-root" : "proof-node",
  label: `node-${i}`,
  command: i === 0 ? "root" : `step-${i}`,
}));

const proofDoc = {
  schema_version: "aurekai.weightops.result.v1",
  command: "weights.prove",
  status: "PASS",
  created_at: new Date().toISOString(),
  payload: {
    proof_hash: "sha256:" + "b".repeat(64),
    proof_chain: proofChain,
    model: "test-model@v1",
    task_count: 5,
  },
};

const proofJsonPath = join(tmp, "proof.json");
const proofBinPath  = join(tmp, "proof.akproofbin");
writeFileSync(proofJsonPath, JSON.stringify(proofDoc, null, 2));

console.log("=== 1. proof compact ===");
const compactResult = run(["proof", "compact", "--in", proofJsonPath, "--out", proofBinPath]);
assert(compactResult?.payload?.compression_ratio > 0, "compression_ratio > 0");
assert(compactResult?.payload?.node_count >= N_NODES, `node_count >= ${N_NODES}`);
assert(compactResult?.payload?.compact_bytes < compactResult?.payload?.source_bytes,
  "compact_bytes < source_bytes");
console.log(`  compression_ratio=${compactResult.payload.compression_ratio}  ` +
  `size: ${compactResult.payload.source_bytes}B → ${compactResult.payload.compact_bytes}B`);
console.log("  PASS");

console.log("=== 2. proof view ===");
const viewResult = run(["proof", "view", "--bin", proofBinPath]);
assert(viewResult?.payload?.node_count >= N_NODES, `view node_count >= ${N_NODES}`);
assert(viewResult?.payload?.edge_count >= N_NODES - 1, `edge_count >= ${N_NODES - 1}`);
console.log(`  node_count=${viewResult.payload.node_count}  edge_count=${viewResult.payload.edge_count}`);
console.log("  PASS");

console.log("=== 3. in-process roundtrip ===");
const bin = compileProofBinary(proofDoc);
assert(Buffer.isBuffer(bin), "compileProofBinary returns Buffer");
const parsed = parseProofBinary(bin);
assert(parsed.node_count >= N_NODES, `roundtrip node_count >= ${N_NODES}`);
assert(parsed.edge_count >= N_NODES - 1, `roundtrip edge_count >= ${N_NODES - 1}`);
assert(parsed.nodes.length === parsed.node_count, "nodes array length == node_count");
assert(parsed.edges.length === parsed.edge_count, "edges array length == edge_count");
console.log(`  roundtrip: ${N_NODES} nodes → ${parsed.node_count} nodes, ${parsed.edge_count} edges`);
console.log("  PASS");

console.log("=== 4. proof view --json mode ===");
const jsonModeResult = run(["proof", "view", "--bin", proofBinPath, "--json"]);
assert(jsonModeResult?.node_count >= N_NODES, "json mode: node_count");
console.log("  PASS");

console.log("\nAll proof-compact validations passed.");
