#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-pipeline-contract-e2e";
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
writeFileSync(source, Buffer.alloc(1024 * 1024 * 2, 11));

const tracePath = join(tmp, "trace.json");
writeFileSync(tracePath, JSON.stringify({
  schema_version: "aurekai.weightops.weighttrace.v1",
  model,
  hot_tensors: ["embed", "layers.1.attn.q"],
  lazy_regions: ["layers.6-8", "output_head"],
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

const planPath = join(tmp, "plan.json");
writeFileSync(planPath, JSON.stringify({
  name: "contract-pipeline",
  version: "1.0",
  steps: [
    { id: "pull", command: "weights.pull-region", depends_on: [], inputs: ["trace.json"] },
    { id: "serve", command: "weights.serve-cdn", depends_on: ["pull"], inputs: ["$pull.output"] },
    { id: "route", command: "weights.arb-route", depends_on: ["serve"], inputs: ["$serve.output"] },
  ],
}, null, 2));

const result = run([
  "weights", "pipeline-dag",
  "--plan", planPath,
  "--validate-only",
  "--model", model,
  "--hydrate-state", hydrateState,
  "--integrity-proof", integrityInline,
], 0);

if (result.status !== "PASS") throw new Error("pipeline-dag should pass");

const contract = result.payload?.execution_contract;
if (!contract) throw new Error("execution_contract missing");
if (contract.schema_version !== "aurekai.weightops.pipeline_contract.v1") throw new Error("contract schema mismatch");
if (!Array.isArray(contract.steps) || contract.steps.length !== 3) throw new Error("contract steps missing");

const serveStep = contract.steps.find(s => s.id === "serve");
const routeStep = contract.steps.find(s => s.id === "route");
if (!serveStep || !routeStep) throw new Error("expected steps missing");
if (!serveStep.gate_required || !serveStep.evidence_refs?.hydrate_state_ref) throw new Error("serve step evidence missing");
if (!routeStep.gate_required || !routeStep.evidence_refs?.integrity_proof_ref) throw new Error("route step evidence missing");
if (!Array.isArray(routeStep.resolved_inputs) || !String(routeStep.resolved_inputs[0] || "").startsWith("contract://serve/output.")) {
  throw new Error("route step resolved input not propagated from serve output");
}

console.log("pipeline contract validate: PASS");
