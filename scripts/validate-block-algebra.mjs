#!/usr/bin/env node
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
  const proc = spawnSync(process.execPath, [AKAI, ...args], { encoding: "utf8", cwd: ROOT });
  return { stdout: proc.stdout || "", stderr: proc.stderr || "", status: proc.status };
}

function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }

function assert(label, condition, detail = "") {
  if (condition) { console.log(`  PASS  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ": " + detail : ""}`); failed++; }
}

function writeFloatFile(path, n = 4096, phase = 0) {
  const buf = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) buf.writeFloatLE(Math.sin(i * 0.07 + phase) * 0.5 + Math.cos(i * 0.013), i * 4);
  writeFileSync(path, buf);
}

function writeSafeTensorsF32(path, tensors) {
  // tensors: [{name, shape:[...], values:Float32Array|number[]}]
  let offset = 0;
  const header = {};
  const payloadChunks = [];
  for (const t of tensors) {
    const vals = Array.isArray(t.values) ? t.values : Array.from(t.values);
    const data = Buffer.alloc(vals.length * 4);
    for (let i = 0; i < vals.length; i++) data.writeFloatLE(vals[i], i * 4);
    header[t.name] = { dtype: "F32", shape: t.shape, data_offsets: [offset, offset + data.length] };
    offset += data.length;
    payloadChunks.push(data);
  }

  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(headerBuf.length), 0);
  const payload = Buffer.concat(payloadChunks);
  writeFileSync(path, Buffer.concat([lenBuf, headerBuf, payload]));
}

const TMP_DIR = join(ROOT, "tmp");
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

const MODEL_FILE = join(TMP_DIR, "test-block.safetensors");
const RAW_MODEL  = join(TMP_DIR, "test-block-raw.bin");
const DELTA_A    = join(TMP_DIR, "test-delta-a.f32");
const DELTA_B    = join(TMP_DIR, "test-delta-b.f32");

// Real numeric fixtures
writeFloatFile(RAW_MODEL, 4096, 0.0);
writeFloatFile(DELTA_A, 2048, 0.3);
writeFloatFile(DELTA_B, 2048, 0.8);

const qProj = new Array(1024).fill(0).map((_, i) => Math.sin(i * 0.03));
const tokEmb = new Array(1024).fill(0).map((_, i) => Math.cos(i * 0.02));
const norm = new Array(256).fill(0).map((_, i) => 0.1 + Math.sin(i * 0.07) * 0.01);
writeSafeTensorsF32(MODEL_FILE, [
  { name: "layer0.q_proj", shape: [32, 32], values: qProj },
  { name: "tok_emb", shape: [32, 32], values: tokEmb },
  { name: "layer0.rmsnorm", shape: [256], values: norm },
]);

console.log("\n=== Block Inspect ===");
{
  const r = run(["block", "inspect", MODEL_FILE, "--tensor", "layer0.q_proj", "--layer", "3"]);
  const j = parseJson(r.stdout);
  assert("schema_version = aurekai.block.inspect.v1", j?.schema_version === "aurekai.block.inspect.v1", r.stderr);
  assert("kind = self_attention", j?.kind === "self_attention", `got: ${j?.kind}`);
  assert("provenance = measured", j?.provenance === "measured");
  assert("eta_L in [0,1]", typeof j?.eta_L === "number" && j.eta_L >= 0 && j.eta_L <= 1);
  assert("energy_closure = pass", j?.energy_closure === "pass", `got: ${j?.energy_closure}`);
}

{
  const r = run(["block", "inspect", MODEL_FILE, "--tensor", "tok_emb", "--layer", "0"]);
  const j = parseJson(r.stdout);
  assert("embedding kind recognized", j?.kind === "embedding", `got: ${j?.kind}`);
}

console.log("\n=== Block Commute ===");
{
  const r = run(["block", "commute", "--a", DELTA_A, "--b", DELTA_B, "--tensor", "q_proj", "--json"]);
  const j = parseJson(r.stdout);
  assert("schema_version = aurekai.block.result.v1", j?.schema_version === "aurekai.block.result.v1", r.stderr);
  assert("commutator_norm numeric", typeof j?.commutator_norm === "number");
  assert("provenance = measured", j?.provenance === "measured");
}

{
  const r = run(["block", "commute", "--a", DELTA_A, "--b", DELTA_A, "--tensor", "ffn", "--json"]);
  const j = parseJson(r.stdout);
  assert("identical operands commutator ~ 0", typeof j?.commutator_norm === "number" && j.commutator_norm <= 1e-9, `got: ${j?.commutator_norm}`);
}

console.log("\n=== Gauge Fix ===");
{
  const r = run(["gauge", "fix", RAW_MODEL, "--preserve", "energy,subspace,cosine", "--json"]);
  const j = parseJson(r.stdout);
  assert("command = block.gauge_fix", j?.command === "block.gauge_fix", r.stderr);
  assert("status = PASS", j?.status === "PASS");
  assert("provenance = measured", j?.provenance === "measured");
  assert("energy_before > 0", typeof j?.energy_before === "number" && j.energy_before > 0);
}

console.log("\n=== FPQ-X Plan ===");
{
  const r = run(["fpqx", "plan", MODEL_FILE, "--target", "edge", "--context", "8k", "--json"]);
  const j = parseJson(r.stdout);
  assert("schema_version = aurekai.fpqx.plan.v1", j?.schema_version === "aurekai.fpqx.plan.v1", r.stderr);
  assert("layer_plan non-empty", Array.isArray(j?.layer_plan) && j.layer_plan.length > 0);
  assert("provenance = measured", j?.provenance === "measured");
}

console.log("\n=== Weights Compile Operator-Algebra ===");
{
  const r = run(["weights", "compile", MODEL_FILE, "--objective", "latency=0.2,bw=0.5,cosine=0.999", "--target", "metal"]);
  const j = parseJson(r.stdout);
  assert("command = weights.compile.algebra", j?.command === "weights.compile.algebra", r.stderr);
  assert("payload.model_format = safetensors", j?.payload?.model_format === "safetensors");
  assert("payload.provenance = measured", j?.payload?.provenance === "measured");
  assert("payload.layer_plan non-empty", Array.isArray(j?.payload?.layer_plan) && j.payload.layer_plan.length > 0);
}

const total = passed + failed;
console.log(`\n${"-".repeat(60)}`);
console.log(`Block Algebra validation: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`${failed} assertions failed.`);
  process.exit(1);
}
console.log("All block algebra assertions passed.");
