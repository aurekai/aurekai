#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-hydrate-engine-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const source = join(tmp, "source.bin");
const sourceBytes = Buffer.alloc(1024 * 1024 * 3);
for (let i = 0; i < sourceBytes.length; i++) sourceBytes[i] = (i * 17) % 251;
writeFileSync(source, sourceBytes);

const traceJson = {
  schema_version: "aurekai.weightops.weighttrace.v1",
  model: "llama-8b.q4.akmodel",
  hot_tensors: ["embed", "layers.0.attn.q", "layers.1.attn.k"],
  cold_tensors: ["layers.28.mlp.up"],
  lazy_regions: ["layers.10-14", "output_head"],
};

const tracePath = join(tmp, "trace.json");
writeFileSync(tracePath, JSON.stringify(traceJson, null, 2));

function run(args) {
  const p = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (p.status !== 0) {
    throw new Error(`command failed: akai ${args.join(" ")}\n${p.stderr || p.stdout}`);
  }

  return JSON.parse(p.stdout);
}

const pullPlanPath = join(tmp, "pull-plan.akhydrate");
const pull = run(["weights", "pull-region", "--trace", tracePath, "--budget-gb", "1.8", "--out", pullPlanPath]);
if (pull.command !== "weights.pull-region") throw new Error("pull-region command mismatch");
if (!existsSync(pullPlanPath)) throw new Error("pull plan missing");

const outDir = join(tmp, "hydrated-out");
const hydrate = run([
  "weights",
  "hydrate",
  "llama-8b.q4.akmodel",
  "--plan",
  pullPlanPath,
  "--source",
  source,
  "--out-dir",
  outDir,
  "--chunk-bytes",
  "131072",
]);

if (hydrate.command !== "weights.hydrate") throw new Error("hydrate command mismatch");
if (hydrate.status !== "PASS") throw new Error("hydrate status not PASS");

const payload = hydrate.payload;
if (!payload || !Array.isArray(payload.region_states) || payload.region_states.length === 0) {
  throw new Error("hydrate region_states missing");
}

for (const state of payload.region_states) {
  if (state.state !== "hydrated") throw new Error(`region not hydrated: ${state.region}`);
  if (!existsSync(state.output_file)) throw new Error(`missing output region file: ${state.output_file}`);

  const [start, endExclusive] = state.byte_range;
  const expected = readFileSync(source).subarray(start, endExclusive);
  const actual = readFileSync(state.output_file);
  if (!actual.equals(expected)) {
    throw new Error(`range mismatch for region ${state.region}`);
  }
}

if (!existsSync(payload.state_file)) throw new Error("state file missing");
if (!Array.isArray(payload.transitions) || payload.transitions.length < payload.region_states.length * 3) {
  throw new Error("transition log incomplete");
}

console.log("hydrate engine validate: PASS");
