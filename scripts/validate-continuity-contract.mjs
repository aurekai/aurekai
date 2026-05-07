#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildCommittedState, buildTransitionRecord, verifyCommittedState, verifyTransitionRecord } from "../src/state-continuity.mjs";

const AKAI = join(process.cwd(), "bin", "akai.mjs");
const TMP = "/tmp/akai-continuity-contract";

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

function runJson(args, expectCode = 0) {
  const proc = spawnSync("node", [AKAI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (proc.status !== expectCode) {
    console.error(`FAIL: akai ${args.join(" ")} exited ${proc.status} (expected ${expectCode})`);
    console.error(proc.stdout?.slice(0, 1000));
    console.error(proc.stderr?.slice(0, 1000));
    process.exit(1);
  }
  try {
    return JSON.parse(proc.stdout);
  } catch (err) {
    console.error(`FAIL: non-JSON stdout for akai ${args.join(" ")} (${err.message})`);
    console.error(proc.stdout?.slice(0, 500));
    process.exit(1);
  }
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`ASSERT FAIL: ${msg}`);
    process.exit(1);
  }
}

function assertContinuityShape(doc, label) {
  const required = [
    "state_commitment",
    "prior_commitment",
    "chart_id",
    "cell_key",
    "residual_norm",
    "residual_delta",
    "continuity_class",
    "continuity_relation",
    "invariants_checked",
    "transition_type",
    "transition_witness",
    "witnesses",
    "opening_policy",
    "continuity_policy",
    "continuity_verdict",
    "continuity_violations",
  ];

  for (const key of required) {
    assert(Object.prototype.hasOwnProperty.call(doc, key), `${label}: missing '${key}'`);
  }
  assert(Array.isArray(doc.invariants_checked), `${label}: invariants_checked must be an array`);
  assert(Array.isArray(doc.witnesses), `${label}: witnesses must be an array`);
  assert(Array.isArray(doc.continuity_violations), `${label}: continuity_violations must be an array`);
}

console.log("=== continuity contract: core verifier helpers ===");
const verifierPayload = { a: 1, b: "x", nested: { y: true } };
const verifierState = buildCommittedState({
  stateType: "test.state",
  payload: verifierPayload,
  chartType: "generic",
  openingPolicy: "commit-only",
  commitmentSalt: "test-salt",
  publicFields: { scope: "test" },
});
const stateVerification = verifyCommittedState({
  committedState: verifierState,
  payload: verifierPayload,
  chartType: "generic",
  openingPolicy: "commit-only",
  commitmentSalt: "test-salt",
  publicFields: { scope: "test" },
});
assert(stateVerification.ok, "verifyCommittedState should pass for matching state");
const transition = buildTransitionRecord({
  transitionType: "test.transition",
  previousState: null,
  nextState: verifierState,
  openingPolicy: "commit-only",
  metadata: { scope: "test" },
});
const transitionVerification = verifyTransitionRecord({
  transition,
  previousState: null,
  nextState: verifierState,
  openingPolicy: "commit-only",
  metadata: { scope: "test" },
});
assert(transitionVerification.ok, "verifyTransitionRecord should pass for matching transition");
console.log("  PASS");

const stamp = Date.now();
const spaceName = `continuity-contract-${stamp}`;
const memOut = join(TMP, `memory-${stamp}.akmemory`);
const proofIn = join(TMP, `proof-${stamp}.json`);

writeFileSync(proofIn, JSON.stringify({
  proof_chain: [
    { proof_hash: "sha256:1111", command: "ingest" },
    { proof_hash: "sha256:2222", command: "bundle" },
    { proof_hash: "sha256:3333", command: "publish" },
  ],
  proof_hash: "sha256:root",
}, null, 2));

console.log("=== continuity contract: space.put ===");
const putResult = runJson([
  "space", "put",
  "--space", spaceName,
  "--key", "sample",
  "--value", '{"task_count":2,"feature_count":7,"slot_count":3}',
  "--json",
]);
assertContinuityShape(putResult, "space.put");
console.log("  PASS");

console.log("=== continuity contract: space.attach ===");
const attachResult = runJson([
  "space", "attach",
  "--space", spaceName,
  "--resource", "README.md",
  "--label", "readme",
  "--json",
]);
assertContinuityShape(attachResult, "space.attach");
console.log("  PASS");

console.log("=== continuity contract: memory.pack ===");
const memoryResult = runJson([
  "memory", "pack",
  "--from", "llama-8b.q4.akmodel",
  "--tasks", "summarize",
  "--out", memOut,
  "--json",
]);
assertContinuityShape(memoryResult, "memory.pack");
console.log("  PASS");

console.log("=== continuity contract: weights.kv-compress ===");
const kvResult = runJson([
  "weights", "kv-compress",
  "--model", "llama-8b.q4.akmodel",
  "--context", `ctx-${stamp}`,
  "--tokens", "512",
  "--dry-run",
  "--json",
]);
assertContinuityShape(kvResult, "weights.kv-compress");
console.log("  PASS");

console.log("=== continuity contract: weights.relay-handoff ===");
const relayResult = runJson([
  "weights", "relay-handoff",
  "--session", `sess-${stamp}`,
  "--peer", "relay-peer-b",
  "--model", "llama-8b.q4.akmodel",
  "--dry-run",
  "--json",
]);
assertContinuityShape(relayResult, "weights.relay-handoff");
console.log("  PASS");

console.log("=== continuity contract: weights.geo-pin ===");
const geoPinResult = runJson([
  "weights", "geo-pin",
  "--model", "llama-8b.q4.akmodel",
  "--region", "us-east-1",
  "--replicas", "2",
  "--dry-run",
  "--json",
]);
assertContinuityShape(geoPinResult, "weights.geo-pin");
console.log("  PASS");

console.log("=== continuity contract: proof.bundle ===");
const proofResult = runJson([
  "proof", "bundle",
  "--in", proofIn,
  "--json",
]);
assertContinuityShape(proofResult, "proof.bundle");
console.log("  PASS");

console.log("=== continuity contract: wire.space-export projection ===");
const exportResult = runJson([
  "wire", "space-export",
  "--projection", "commitment",
  "--json",
]);
assert(exportResult.projection === "commitment", "wire.space-export: projection must be commitment");
const thisSpace = (exportResult.spaces || []).find(s => s.name === spaceName);
assert(Boolean(thisSpace), "wire.space-export: expected test space in export");
assert(Boolean(thisSpace.keys?.sample?._continuity?.state_commitment), "wire.space-export: commitment projection missing state commitment");
assert(!Object.prototype.hasOwnProperty.call(thisSpace.keys?.sample || {}, "value"), "wire.space-export: commitment projection leaked key value");
console.log("  PASS");

console.log("=== continuity contract: graph.lineage trajectory ===");
const lineageResult = runJson([
  "graph", "lineage",
  "--model", "llama-8b.q4.akmodel",
  "--depth", "25",
  "--json",
]);
assert(Boolean(lineageResult.trajectory_root), "graph.lineage: trajectory_root missing");
assert(Boolean(lineageResult.history_accumulator), "graph.lineage: history_accumulator missing");
assert(Boolean(lineageResult.folded_witness), "graph.lineage: folded_witness missing");
assert(lineageResult.folded_witness.fold_ready === true, "graph.lineage: folded_witness should be fold_ready");
assert(Array.isArray(lineageResult.step_inclusions), "graph.lineage: step_inclusions should be array");
if (lineageResult.step_inclusions.length > 0) {
  assert(typeof lineageResult.step_inclusions[0].status === "string", "graph.lineage: step inclusion status missing");
}
console.log("  PASS");

console.log("\nAll continuity contract validations passed.");
