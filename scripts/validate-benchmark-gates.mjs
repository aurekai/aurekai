#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-benchmark-gates-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas-home");
const source = join(tmp, "source.bin");
const oldFile = join(tmp, "old.bin");
const newFile = join(tmp, "new.bin");
const pack = join(tmp, "bundle.akpack");
const tracePath = join(tmp, "trace.json");
const pullPlanPath = join(tmp, "pull-plan.akhydrate");

writeFileSync(source, Buffer.concat([
  Buffer.alloc(1024 * 1024, 65),
  Buffer.alloc(1024 * 1024, 66),
  Buffer.alloc(1024 * 1024, 67),
]));
writeFileSync(oldFile, Buffer.concat([
  Buffer.alloc(1024 * 1024, 65),
  Buffer.alloc(1024 * 1024, 66),
  Buffer.alloc(1024 * 1024, 67),
]));
writeFileSync(newFile, Buffer.concat([
  Buffer.alloc(1024 * 1024, 65),
  Buffer.from("AUREKAI-BENCH-INSERT"),
  Buffer.alloc(1024 * 1024, 66),
  Buffer.alloc(1024 * 1024, 67),
]));

writeFileSync(tracePath, JSON.stringify({
  schema_version: "aurekai.weightops.weighttrace.v1",
  model: "llama-8b.q4.akmodel",
  hot_tensors: ["embed", "layers.0.attn.q"],
  lazy_regions: ["layers.10-12", "output_head"],
}, null, 2));

function run(args, opts = {}) {
  const started = Date.now();
  const proc = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      AKAI_CAS_HOME: casHome,
      ...(opts.env || {}),
    },
  });
  const elapsed = Date.now() - started;
  if (proc.status !== (opts.expectExitCode ?? 0)) {
    throw new Error(`command failed: akai ${args.join(" ")}\n${proc.stderr || proc.stdout}`);
  }
  return {
    elapsed,
    json: JSON.parse((proc.stdout || "").trim()),
  };
}

run(["cas", "import", oldFile, "--ref", "old"]);
run(["cas", "import", newFile, "--ref", "new"]);
const casStats = run(["cas", "stats"]).json;

const deltaPlan = run(["delta", "plan", "--old", oldFile, "--new", newFile]).json;
const proofBench = run(["weights", "integrity-gate", "--model", "llama-8b.q4.akmodel"]);

run(["weights", "pull-region", "--trace", tracePath, "--out", pullPlanPath]);
const hydrateBench = run([
  "weights", "hydrate", "llama-8b.q4.akmodel",
  "--plan", pullPlanPath,
  "--source", source,
  "--out-dir", join(tmp, "hydrated"),
]);

run(["pack", "build", oldFile, newFile, "--out", pack]);
const inspectBench = run(["pack", "inspect", pack]);

const transitions = hydrateBench.json.payload?.transitions || [];
const firstHydrated = transitions.find(t => t.to === "hydrated");
if (!firstHydrated) throw new Error("missing hydrated transition");

const firstHydratedMs = new Date(firstHydrated.at).getTime() - new Date(hydrateBench.json.created_at || firstHydrated.at).getTime();
const bytesToFirstRun = firstHydrated.bytes || 0;
const dedupeRatio = casStats.payload?.dedupe_ratio || 0;
const deltaSavingsRatio = deltaPlan.payload?.savings_ratio || 0;
const manifestParseMs = inspectBench.elapsed;
const proofVerifyMs = proofBench.elapsed;

if (bytesToFirstRun <= 0) throw new Error("bytes_to_first_run must be > 0");
if (dedupeRatio <= 1) throw new Error("dedupe_ratio must be > 1");
if (deltaSavingsRatio <= 0) throw new Error("delta_savings_ratio must be > 0");
if (manifestParseMs <= 0) throw new Error("manifest_parse_ms must be > 0");
if (proofVerifyMs <= 0) throw new Error("proof_verify_ms must be > 0");

console.log(JSON.stringify({
  schema_version: "aurekai.bench.gates.v1",
  status: "PASS",
  metrics: {
    ttfvur_ms: Math.max(0, firstHydratedMs),
    bytes_to_first_run: bytesToFirstRun,
    dedupe_ratio: dedupeRatio,
    delta_savings_ratio: deltaSavingsRatio,
    manifest_parse_ms: manifestParseMs,
    proof_verify_ms: proofVerifyMs,
  },
}, null, 2));
