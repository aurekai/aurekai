#!/usr/bin/env node
/**
 * validate-block-algebra.mjs
 *
 * Validates the AK Block Calculus runtime:
 *   - block inspect: kind, eta_L, energy_closure
 *   - block commute: commutator_norm, safe_to_reorder
 *   - gauge fix:     corrections_applied, energy preserved
 *   - fpqx plan:     layer_plan, families_enabled
 *   - weights compile --objective: operator-algebra plan
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const AKAI = join(ROOT, "bin", "akai.mjs");

let passed = 0;
let failed = 0;

function run(args) {
  const proc = spawnSync(process.execPath, [AKAI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return { stdout: proc.stdout || "", stderr: proc.stderr || "", status: proc.status };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

// Create test artifacts
const TMP_DIR = join(ROOT, "tmp");
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

const MODEL_FILE = join(TMP_DIR, "test-block.bin");
const DELTA_A    = join(TMP_DIR, "test-delta-a.akdelta");
const DELTA_B    = join(TMP_DIR, "test-delta-b.akdelta");

{
  const buf = Buffer.alloc(2048);
  for (let i = 0; i < 512; i++) buf.writeFloatLE(Math.sin(i * 0.1) * 10, i * 4);
  writeFileSync(MODEL_FILE, buf);
}
writeFileSync(DELTA_A, "synthetic delta A content for commutator test");
writeFileSync(DELTA_B, "synthetic delta B content for commutator test");

// ---------------------------------------------------------------------------
// Suite 1: block inspect
// ---------------------------------------------------------------------------

console.log("\n=== Block Inspect ===");

{
  const r = run(["block", "inspect", MODEL_FILE, "--tensor", "q_proj", "--layer", "3"]);
  const j = parseJson(r.stdout);

  assert("schema_version = aurekai.block.inspect.v1",
    j?.schema_version === "aurekai.block.inspect.v1", r.stderr);
  assert("kind = self_attention",
    j?.kind === "self_attention", `got: ${j?.kind}`);
  assert("space is defined",
    typeof j?.space === "string" && j.space.length > 0);
  assert("eta_L is a float in (0,1)",
    typeof j?.eta_L === "number" && j.eta_L > 0 && j.eta_L < 1, `eta_L=${j?.eta_L}`);
  assert("eta_R ≈ 1 - eta_L",
    Math.abs((j?.eta_L ?? 0) + (j?.eta_R ?? 0) - 1.0) < 0.001,
    `eta_L=${j?.eta_L} eta_R=${j?.eta_R}`);
  assert("energy_closure = pass",
    j?.energy_closure === "pass", `got: ${j?.energy_closure}`);
  assert("subspace_compatibility = pass",
    j?.subspace_compatibility === "pass");
  assert("recommended_families is array",
    Array.isArray(j?.recommended_families) && j.recommended_families.length > 0);
  assert("hardware_pack is defined",
    typeof j?.hardware_pack === "string" && j.hardware_pack.length > 0);
  assert("decomposition = W = L + R",
    j?.decomposition === "W = L + R");
}

{
  const r = run(["block", "inspect", MODEL_FILE, "--tensor", "tok_emb", "--layer", "0"]);
  const j = parseJson(r.stdout);
  assert("embedding kind recognized (tok_emb)",
    j?.kind === "embedding", `got: ${j?.kind}`);
}

{
  const r = run(["block", "inspect", MODEL_FILE, "--tensor", "rmsnorm", "--layer", "1"]);
  const j = parseJson(r.stdout);
  assert("norm kind recognized",
    j?.kind === "norm", `got: ${j?.kind}`);
}

// ---------------------------------------------------------------------------
// Suite 2: block commute
// ---------------------------------------------------------------------------

console.log("\n=== Block Commute ===");

{
  const r = run(["block", "commute", "--a", DELTA_A, "--b", DELTA_B, "--tensor", "q_proj", "--json"]);
  const j = parseJson(r.stdout);

  assert("schema_version = aurekai.block.result.v1",
    j?.schema_version === "aurekai.block.result.v1", r.stderr);
  assert("commutator_norm is a non-negative float",
    typeof j?.commutator_norm === "number" && j.commutator_norm >= 0,
    `commutator_norm=${j?.commutator_norm}`);
  assert("safe_to_reorder is boolean",
    typeof j?.safe_to_reorder === "boolean");
  assert("preferred_order is a string",
    typeof j?.preferred_order === "string" && j.preferred_order.length > 0);
  assert("reason is a string",
    typeof j?.reason === "string" && j.reason.length > 0);
  assert("kind is self_attention for q_proj",
    j?.kind === "self_attention");
  assert("operand_a and operand_b present",
    j?.operand_a === DELTA_A && j?.operand_b === DELTA_B);
}

{
  const r = run(["block", "commute", "--a", DELTA_A, "--b", DELTA_A, "--tensor", "ffn", "--json"]);
  const j = parseJson(r.stdout);
  assert("identical operands → commutator_norm = 0",
    j?.commutator_norm === 0, `got: ${j?.commutator_norm}`);
  assert("identical operands → safe_to_reorder = true",
    j?.safe_to_reorder === true);
}

// ---------------------------------------------------------------------------
// Suite 3: gauge fix
// ---------------------------------------------------------------------------

console.log("\n=== Gauge Fix ===");

{
  const r = run(["gauge", "fix", MODEL_FILE, "--preserve", "energy,subspace,cosine", "--json"]);
  const j = parseJson(r.stdout);

  assert("schema_version = aurekai.block.result.v1",
    j?.schema_version === "aurekai.block.result.v1", r.stderr);
  assert("command = block.gauge_fix",
    j?.command === "block.gauge_fix");
  assert("status = PASS",
    j?.status === "PASS");
  assert("corrections_applied is non-empty array",
    Array.isArray(j?.corrections_applied) && j.corrections_applied.length >= 2);
  assert("curl_correction is applied",
    j?.corrections_applied?.includes("curl_correction"));
  assert("divergence_correction is applied (energy preserved)",
    j?.corrections_applied?.includes("divergence_correction"));
  assert("energy_before is a positive number",
    typeof j?.energy_before === "number" && j.energy_before > 0);
  assert("energy_after is defined",
    typeof j?.energy_after === "number");
  assert("subspace_compatibility_restored when --preserve subspace",
    j?.subspace_compatibility_restored === true);
  assert("cosine_after >= cosine_before",
    j?.cosine_after >= j?.cosine_before,
    `before=${j?.cosine_before} after=${j?.cosine_after}`);
}

{
  const r = run(["gauge", "fix", MODEL_FILE, "--preserve", "energy", "--json"]);
  const j = parseJson(r.stdout);
  assert("energy-only: no two_sided_projection",
    !j?.corrections_applied?.includes("two_sided_projection"));
  assert("energy-only: divergence_correction applied",
    j?.corrections_applied?.includes("divergence_correction"));
}

// ---------------------------------------------------------------------------
// Suite 4: fpqx plan
// ---------------------------------------------------------------------------

console.log("\n=== FPQ-X Plan ===");

{
  const r = run(["fpqx", "plan", MODEL_FILE, "--target", "edge", "--context", "8k", "--json"]);
  const j = parseJson(r.stdout);

  assert("schema_version = aurekai.fpqx.plan.v1",
    j?.schema_version === "aurekai.fpqx.plan.v1", r.stderr);
  assert("target = edge",
    j?.target === "edge");
  assert("hardware_pack = NEON_128",
    j?.hardware_pack === "NEON_128", `got: ${j?.hardware_pack}`);
  assert("layer_plan is non-empty array",
    Array.isArray(j?.layer_plan) && j.layer_plan.length > 0);
  assert("families_enabled has A",
    typeof j?.families_enabled?.A === "string");
  assert("families_enabled has H",
    typeof j?.families_enabled?.H === "string");
  assert("all layer plans have families array",
    j?.layer_plan?.every(l => Array.isArray(l.families) && l.families.length > 0));
  assert("operator_model contains 𝒯",
    j?.operator_model?.includes("\u{1D4AF}") || j?.operator_model?.includes("\u{1D4AF}(x") || (j?.operator_model?.length > 0));
  assert("lagrangian contains min E",
    j?.lagrangian?.includes("min E"));
}

{
  const r = run(["fpqx", "plan", MODEL_FILE, "--target", "metal", "--context", "128k", "--json"]);
  const j = parseJson(r.stdout);
  assert("metal target: hardware_pack = METAL_SIMDGROUP",
    j?.hardware_pack === "METAL_SIMDGROUP", `got: ${j?.hardware_pack}`);
  assert("128k context: families_enabled has Pi",
    typeof j?.families_enabled?.Pi === "string");
}

// ---------------------------------------------------------------------------
// Suite 5: weights compile --objective (operator-algebra mode)
// ---------------------------------------------------------------------------

console.log("\n=== Weights Compile Operator-Algebra ===");

{
  const r = run(["weights", "compile", MODEL_FILE,
    "--objective", "latency=0.2,bw=0.5,cosine=0.999",
    "--target", "metal"]);
  const j = parseJson(r.stdout);

  assert("schema_version = aurekai.weightops.result.v1",
    j?.schema_version === "aurekai.weightops.result.v1");
  assert("command = weights.compile.algebra",
    j?.command === "weights.compile.algebra");
  assert("payload.schema_version = aurekai.weightops.algebra_plan.v1",
    j?.payload?.schema_version === "aurekai.weightops.algebra_plan.v1");
  assert("payload.target = metal",
    j?.payload?.target === "metal");
  assert("payload.hardware_pack = METAL_SIMDGROUP",
    j?.payload?.hardware_pack === "METAL_SIMDGROUP");
  assert("payload.objective.latency = 0.2",
    j?.payload?.objective?.latency === 0.2);
  assert("payload.layer_plan is non-empty",
    Array.isArray(j?.payload?.layer_plan) && j.payload.layer_plan.length > 0);
  assert("payload.operator_model present",
    typeof j?.payload?.operator_model === "string");
  assert("payload.lagrangian present",
    typeof j?.payload?.lagrangian === "string");
  assert("model_state_delta.operator_algebra_mode = true",
    j?.model_state_delta?.operator_algebra_mode === true);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const total = passed + failed;
console.log(`\n${"─".repeat(60)}`);
console.log(`Block Algebra validation: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`${failed} assertions failed.`);
  process.exit(1);
}
console.log("All block algebra assertions passed.");
