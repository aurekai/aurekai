#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.mjs";
import { weightsCommand, memoryCommand } from "../src/weightops.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function printHelp() {
  console.log(`${VERSION.product} CLI v${VERSION.release}`);
  console.log(`legacy codename: ${VERSION.legacyCodename}`);
  console.log("");
  console.log("Usage:");
  console.log("  akai doctor --deep");
  console.log("  akai dashboard");
  console.log("  akai run <recipe> [--input FILE] [--sae-audit] [--semantic-cache] [--weightless-first]");
  console.log("  akai install --user|--system [--service]");
  console.log("  akai uninstall --user|--system [--service]");
  console.log("  akai sae:activate ...");
  console.log("  akai model:inspect ...");
  console.log("  akai fpqx:align-sae ...");
  console.log("");
  console.log("WeightOps (Phase 6):");
  console.log("  akai weights negotiate --for <recipe>  [--disk <GB>] [--hardware <hw>] [--quality <0-1>]");
  console.log("  akai weights hydrate <model>            [--progressive] [--emit-readiness]");
  console.log("  akai weights compile  <recipe>          [--out <file.akweights>]");
  console.log("  akai weights status   [<model>]");
  console.log("  akai weights skeleton <model>           [--out <file.akskel>]");
  console.log("  akai weights trace    --recipe <recipe> --model <model>");
  console.log("  akai weights pull-region --trace <trace.akweighttrace> [--budget-gb <N>] [--out <file.akhydrate>]");
  console.log("  akai weights diff     <model@old> <model@new> [--out <file.akdelta>]");
  console.log("  akai weights patch    <model@old> <file.akdelta> [--out <model@new>]");
  console.log("  akai weights prove    <model>           [--tasks <recipe>]");
  console.log("  akai weights lease    <model>           --duration <Nh> [--task <recipe>]");
  console.log("  akai weights teleport <akweight-uri>");
  console.log("  akai weights synth-quant --from <model.akmodel> --to <q3|q4|q5|q8> [--verify-fidelity]");
  console.log("  akai weights verify-fidelity <model.akmodel> [--baseline <ref>]");
  console.log("  akai weights distill-feature-micro --from <model.akmodel> --feature <feature-id> [--out <file.akdistill>]");
  console.log("  akai weights ghost-infer --recipe <recipe> [--memory <file.akmemory>] [--distill <file.akdistill>] [--no-weights]");
  console.log("  akai weights marketplace [--tasks <t,...>] [--budget-gb <N>] [--top <N>] [--list]");
  console.log("  akai weights marketplace inspect <model-id>");
  console.log("  akai weights serve-cdn --model <model.akmodel> [--region <id|all>] [--ttl <Nh>] [--prefetch] [--dry-run]");
  console.log("  akai weights cdn status [<model>]");
  console.log("  akai weights moq-stream --model <model.akmodel> [--relay <uri>] [--track <name>] [--chunk-ms <N>] [--dry-run]");
  console.log("  akai weights arb-route --recipe <recipe> [--sla-latency-ms <N>] [--sla-quality <0-1>] [--budget-credits <N>] [--dry-run]");
  console.log("");
  console.log("Memory Packs (Phase 6):");
  console.log("  akai memory pack    --from <model.akmodel> --tasks <t1,t2,...> [--out <file.akmemory>]");
  console.log("  akai memory inspect <file.akmemory>");
  console.log("  akai memory status");
  console.log("");
  console.log("Grouped compatibility commands:");
  console.log("  akai sae activate ...   -> akai sae:activate ...");
  console.log("  akai model inspect ...  -> akai model:inspect ...");
  console.log("  akai fpqx align-sae ... -> akai fpqx:align-sae ...");
  console.log("");
  console.log("Compatibility:");
  console.log("  bonfyre       -> akai");
  console.log("  bonfyre-hyper -> akai");
  console.log("  .akmodel/.aksae/.akfpqx are first-class; .bfmodel/.bfsae/.bffpqx remain supported during migration");
}

function resolveDefaultDict(modelMemoryRoot) {
  const candidates = ["default.aksae", "default.bfsae"];
  for (const candidate of candidates) {
    const dict = join(modelMemoryRoot, candidate);
    if (existsSync(dict)) return dict;
  }
  return null;
}

function normalizeArgs(argv) {
  if (argv.length >= 2 && ["sae", "model", "fpqx", "query", "family", "cache"].includes(argv[0])) {
    return [`${argv[0]}:${argv[1]}`, ...argv.slice(2)];
  }
  return argv;
}

function resolveLegacyBinary(command) {
  const envHyper = process.env.AKAI_HYPER || process.env.AUREKAI_HYPER || process.env.BONFYRE_HYPER;
  if (envHyper) return { bin: envHyper, args: [command] };

  const localCompiled = join(repoRoot, "..", "dist", `bonfyre-hyper-v0.7.0-bun-${process.platform}-${process.arch}`);
  if (existsSync(localCompiled)) return { bin: localCompiled, args: [command] };

  const localHyperTs = join(repoRoot, "..", "bonfyre-hyper", "src", "hyper.ts");
  const bunBin = process.env.BUN_BIN || join(process.env.HOME || "/tmp", ".bun", "bin", "bun");
  if (existsSync(localHyperTs) && existsSync(bunBin)) {
    return { bin: bunBin, args: ["run", localHyperTs, command] };
  }

  return { bin: "bonfyre-hyper", args: [command] };
}

function detectLegacyEnv() {
  const bonfyreRoot = join(repoRoot, "..");
  const packagedRuntime = process.env.AUREKAI_RUNTIME || process.env.BONFYRE_RUNTIME || join(bonfyreRoot, "dist", "bonfyre-appliance");
  const packagedManifest = join(packagedRuntime, "runtime", "bonfyre.manifest.json");
  const packagedModelMemory = process.env.AUREKAI_MODEL_MEMORY || process.env.BONFYRE_MODEL_MEMORY || join(packagedRuntime, "model-memory");
  const env = { ...process.env };

  if (!env.BONFYRE_RUNTIME && existsSync(packagedManifest)) {
    env.BONFYRE_RUNTIME = packagedRuntime;
  }
  if (!env.AUREKAI_RUNTIME && existsSync(packagedManifest)) {
    env.AUREKAI_RUNTIME = packagedRuntime;
  }
  if (!env.BONFYRE_MODEL_MEMORY && existsSync(packagedModelMemory)) {
    env.BONFYRE_MODEL_MEMORY = packagedModelMemory;
  }
  if (!env.AUREKAI_MODEL_MEMORY && existsSync(packagedModelMemory)) {
    env.AUREKAI_MODEL_MEMORY = packagedModelMemory;
  }
  const defaultDict = resolveDefaultDict(packagedModelMemory);
  if (!env.BONFYRE_SAE_DICT) {
    if (defaultDict) env.BONFYRE_SAE_DICT = defaultDict;
  }
  if (!env.AUREKAI_SAE_DICT) {
    if (defaultDict) env.AUREKAI_SAE_DICT = defaultDict;
  }
  return env;
}

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0 || rawArgs[0] === "--help" || rawArgs[0] === "-h" || rawArgs[0] === "help") {
  printHelp();
  process.exit(0);
}

if (rawArgs[0] === "manifest:print") {
  const manifestPath = join(repoRoot, "aurekai.manifest.json");
  process.stdout.write(readFileSync(manifestPath, "utf8"));
  process.exit(0);
}

const args = normalizeArgs(rawArgs);
const command = args[0];
const rest = args.slice(1);

// Weightless-first run path — handled natively without legacy binary
if (command === "run" && rest.includes("--weightless-first")) {
  weightsCommand(["weightless-run", ...rest]);
  process.exit(0);
}

// WeightOps — handled natively without legacy binary
if (command === "weights" || command === "weightops") {
  weightsCommand(rest);
  process.exit(0);
}

// Memory Packs — handled natively
if (command === "memory") {
  memoryCommand(rest);
  process.exit(0);
}

const target = resolveLegacyBinary(command);
const proc = spawnSync(target.bin, [...target.args, ...rest], {
  stdio: "inherit",
  env: detectLegacyEnv(),
});
process.exit(proc.status ?? 1);
