#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-serving-readiness-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const source = join(tmp, "source.bin");
const sourceBytes = Buffer.alloc(1024 * 1024 * 2);
for (let i = 0; i < sourceBytes.length; i++) sourceBytes[i] = (i * 31) % 251;
writeFileSync(source, sourceBytes);

const trace = {
  schema_version: "aurekai.weightops.weighttrace.v1",
  model: "llama-8b.q4.akmodel",
  hot_tensors: ["embed", "layers.0.attn.q"],
  lazy_regions: ["layers.8-10", "output_head"],
};
const tracePath = join(tmp, "trace.json");
writeFileSync(tracePath, JSON.stringify(trace, null, 2));

function run(args, expectExitCode = 0) {
  const p = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (p.status !== expectExitCode) {
    throw new Error(`command exit mismatch (${p.status} != ${expectExitCode}): akai ${args.join(" ")}\n${p.stderr || p.stdout}`);
  }

  const out = (p.stdout || "").trim();
  if (!out) throw new Error(`missing JSON output: akai ${args.join(" ")}`);
  return JSON.parse(out);
}

const pullPlan = join(tmp, "pull-plan.akhydrate");
run(["weights", "pull-region", "--trace", tracePath, "--out", pullPlan], 0);

const outDir = join(tmp, "hydrated");
const hydrate = run([
  "weights",
  "hydrate",
  "llama-8b.q4.akmodel",
  "--plan",
  pullPlan,
  "--source",
  source,
  "--out-dir",
  outDir,
], 0);
if (hydrate.status !== "PASS") throw new Error("hydrate did not pass");
if (!existsSync(hydrate.payload.state_file)) throw new Error("state file missing");

const servePass = run([
  "weights",
  "serve-cdn",
  "--model",
  "llama-8b.q4.akmodel",
  "--hydrate-state",
  hydrate.payload.state_file,
], 0);
if (servePass.status !== "PASS") throw new Error("serve-cdn should pass with hydrate state");

const streamPass = run([
  "weights",
  "moq-stream",
  "--model",
  "llama-8b.q4.akmodel",
  "--hydrate-state",
  hydrate.payload.state_file,
], 0);
if (streamPass.status !== "PASS") throw new Error("moq-stream should pass with hydrate state");

const serveFail = run([
  "weights",
  "serve-cdn",
  "--model",
  "other-model.akmodel",
  "--hydrate-state",
  hydrate.payload.state_file,
], 1);
if (serveFail.status !== "FAIL") throw new Error("serve-cdn should fail on hydrate-state model mismatch");

const status = run(["weights", "cdn", "status", "llama-8b.q4.akmodel"], 0);
if (!status.payload || !status.payload.hydration) throw new Error("cdn status missing hydration payload");

const regionFile = hydrate.payload.region_states?.[0]?.output_file;
if (!regionFile || !existsSync(regionFile)) throw new Error("hydrated region output missing");
if (readFileSync(regionFile).length <= 0) throw new Error("hydrated region output empty");

console.log("serving readiness validate: PASS");
