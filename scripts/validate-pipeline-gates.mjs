#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-pipeline-gates-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const model = "llama-8b.q4.akmodel";

function run(args, expectExit = 0) {
  const proc = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (proc.status !== expectExit) {
    throw new Error(`exit code mismatch (${proc.status} != ${expectExit}) for akai ${args.join(" ")}\n${proc.stderr || proc.stdout}`);
  }

  const out = (proc.stdout || "").trim();
  if (!out) throw new Error(`missing JSON output for akai ${args.join(" ")}`);
  return JSON.parse(out);
}

const source = join(tmp, "source.bin");
writeFileSync(source, Buffer.alloc(1024 * 1024 * 2, 23));

const tracePath = join(tmp, "trace.json");
writeFileSync(tracePath, JSON.stringify({
  schema_version: "aurekai.weightops.weighttrace.v1",
  model,
  hot_tensors: ["embed", "layers.0.attn.q"],
  lazy_regions: ["layers.10-12"],
}, null, 2));

const pullPlanPath = join(tmp, "pull-plan.akhydrate");
run(["weights", "pull-region", "--trace", tracePath, "--out", pullPlanPath], 0);

const hydrate = run([
  "weights", "hydrate", model,
  "--plan", pullPlanPath,
  "--source", source,
  "--out-dir", join(tmp, "hydrated"),
], 0);
const hydrateState = hydrate.payload?.state_file;
if (!hydrateState || !existsSync(hydrateState)) throw new Error("hydrate state missing");

const gate = run(["weights", "integrity-gate", "--model", model], 0);
const integrityInline = JSON.stringify(gate);

const gatedPlanPath = join(tmp, "gated-plan.json");
writeFileSync(gatedPlanPath, JSON.stringify({
  name: "gated-serving-pipeline",
  version: "1.0",
  steps: [
    { id: "pull", command: "weights.pull-region", depends_on: [], inputs: ["trace.json"] },
    { id: "serve", command: "weights.serve-cdn", depends_on: ["pull"], inputs: ["$pull.output"] },
    { id: "route", command: "weights.arb-route", depends_on: ["serve"], inputs: ["$serve.output"] },
  ],
}, null, 2));

const blocked = run([
  "weights", "pipeline-dag",
  "--plan", gatedPlanPath,
  "--validate-only",
  "--model", model,
], 1);
if (blocked.status !== "FAIL") throw new Error("pipeline should fail without gate evidence");
if (blocked.payload?.gate_evidence?.required !== true) throw new Error("gate evidence should be required");

const pass = run([
  "weights", "pipeline-dag",
  "--plan", gatedPlanPath,
  "--validate-only",
  "--model", model,
  "--hydrate-state", hydrateState,
  "--integrity-proof", integrityInline,
], 0);
if (pass.status !== "PASS") throw new Error("pipeline should pass with gate evidence");
if (pass.payload?.gate_evidence?.passed !== true) throw new Error("gate evidence should pass");

const nonGatedPlanPath = join(tmp, "non-gated-plan.json");
writeFileSync(nonGatedPlanPath, JSON.stringify({
  name: "non-gated-pipeline",
  version: "1.0",
  steps: [
    { id: "pull", command: "weights.pull-region", depends_on: [], inputs: ["trace.json"] },
    { id: "quant", command: "weights.synth-quant", depends_on: ["pull"], inputs: ["$pull.output"] },
  ],
}, null, 2));

const nonGated = run([
  "weights", "pipeline-dag",
  "--plan", nonGatedPlanPath,
  "--validate-only",
], 0);
if (nonGated.status !== "PASS") throw new Error("non-gated pipeline should pass without evidence");
if (nonGated.payload?.gate_evidence?.required !== false) throw new Error("non-gated pipeline should not require evidence");

console.log("pipeline gates validate: PASS");
