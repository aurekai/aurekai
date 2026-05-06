#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-promotion-gates-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const model = "llama-8b.q4.akmodel";
const source = join(tmp, "source.bin");
writeFileSync(source, Buffer.alloc(1024 * 1024 * 2, 7));

const tracePath = join(tmp, "trace.json");
writeFileSync(tracePath, JSON.stringify({
  schema_version: "aurekai.weightops.weighttrace.v1",
  model,
  hot_tensors: ["embed", "layers.0.attn.q"],
  lazy_regions: ["layers.4-6", "output_head"],
}, null, 2));

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

const pullPlanPath = join(tmp, "pull-plan.akhydrate");
run(["weights", "pull-region", "--trace", tracePath, "--out", pullPlanPath], 0);
if (!existsSync(pullPlanPath)) throw new Error("pull plan missing");

const hydrate = run([
  "weights", "hydrate", model,
  "--plan", pullPlanPath,
  "--source", source,
  "--out-dir", join(tmp, "hydrated"),
], 0);
const hydrateState = hydrate.payload?.state_file;
if (!hydrateState || !existsSync(hydrateState)) throw new Error("hydrate state missing");

const gate = run(["weights", "integrity-gate", "--model", model], 0);
if (gate.status !== "PASS") throw new Error("integrity gate should pass");
const integrityInline = JSON.stringify(gate);

const marketBlocked = run([
  "weights", "marketplace",
  "--tasks", "support-intent",
  "--model", model,
], 2);
if (marketBlocked.status !== "FAIL") throw new Error("marketplace should fail without gates");

const marketPass = run([
  "weights", "marketplace",
  "--tasks", "support-intent",
  "--model", model,
  "--hydrate-state", hydrateState,
  "--integrity-proof", integrityInline,
], 0);
if (marketPass.status !== "PASS") throw new Error("marketplace should pass with gates");
if (!marketPass.payload.gates_passed) throw new Error("marketplace gate flag should be true");
if (!Array.isArray(marketPass.payload.recommendations) || marketPass.payload.recommendations.length === 0) {
  throw new Error("marketplace recommendations missing");
}

const arbBlocked = run([
  "weights", "arb-route",
  "--recipe", "examples/call-to-brief-to-invoice.akrecipe",
  "--model", model,
], 2);
if (arbBlocked.status !== "FAIL") throw new Error("arb-route should fail without gates");

const arbPass = run([
  "weights", "arb-route",
  "--recipe", "examples/call-to-brief-to-invoice.akrecipe",
  "--model", model,
  "--hydrate-state", hydrateState,
  "--integrity-proof", integrityInline,
], 0);
if (arbPass.status !== "PASS") throw new Error("arb-route should pass with gates");
if (!arbPass.payload.gates_passed) throw new Error("arb-route gate flag should be true");
if (!arbPass.payload.selected_provider) throw new Error("arb-route should select provider");

console.log("promotion gates validate: PASS");
