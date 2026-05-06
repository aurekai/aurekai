#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.mjs";
import { weightsCommand, memoryCommand } from "../src/weightops.mjs";
import { casCommand } from "../src/cas.mjs";
import { packCommand } from "../src/pack.mjs";
import { fetchCommand } from "../src/fetch.mjs";
import { deltaCommand } from "../src/delta.mjs";
import { manifestCommand } from "../src/manifest-command.mjs";

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
  console.log("  akai cas import|verify|materialize|stats|gc ...");
  console.log("  akai pack build|inspect|materialize ...");
  console.log("  akai fetch range|multipart|resume|verify ...");
  console.log("  akai delta plan|bench ...");
  console.log("  akai manifest bin-compile|bin-verify|keygen|sign|verify-signature ...");
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
  console.log("  akai weights marketplace [--tasks <t,...>] [--budget-gb <N>] [--top <N>] [--model <model.akmodel>] [--hydrate-state <file>] [--integrity-proof <file|json>] [--list]");
  console.log("  akai weights marketplace inspect <model-id>");
  console.log("  akai weights serve-cdn --model <model.akmodel> [--region <id|all>] [--ttl <Nh>] [--prefetch] [--dry-run]");
  console.log("  akai weights cdn status [<model>]");
  console.log("  akai weights moq-stream --model <model.akmodel> [--relay <uri>] [--track <name>] [--chunk-ms <N>] [--dry-run]");
  console.log("  akai weights arb-route --recipe <recipe> [--model <model.akmodel>] [--sla-latency-ms <N>] [--sla-quality <0-1>] [--budget-credits <N>] [--hydrate-state <file>] [--integrity-proof <file|json>] [--dry-run]");
  console.log("  akai weights sbom --model <model.akmodel> [--out <file.aksbom>] [--format <fmt>] [--dry-run]");
  console.log("  akai weights tamper-detect --model <model.akmodel> [--baseline <hash>] [--sbom <file.aksbom>] [--inject-drift] [--dry-run]");
  console.log("  akai weights proof-chain --model <model.akmodel> [--sbom <file.aksbom>] [--out <file.akproof>] [--dry-run]");
  console.log("  akai weights integrity-gate --model <model.akmodel> [--proof <file.akproof>] [--sbom <file.aksbom>] [--signature <sig.json>] [--public-key <pem>] [--cas-ref <ref>] [--signature-policy <none|strict>] [--oracle <none|basic>] [--dry-run]");
  console.log("  akai weights audit-trail --model <model.akmodel> [--since <iso8601>] [--limit <N>] [--out <file.akaudit>] [--format <json>]");
  console.log("  akai weights federated-merge --nodes <node1.akmodel,node2.akmodel,...> [--algorithm <fedavg|fedprox|scaffold>] [--rounds <N>] [--dp-epsilon <eps>] [--out <file.akmodel>] [--dry-run]");
  console.log("  akai weights dp-noise --model <model.akmodel> --epsilon <eps> --delta <delta> [--mechanism <gaussian|laplace>] [--sensitivity <S>] [--out <file.akmodel>] [--dry-run]");
  console.log("  akai weights drift-monitor --model <model.akmodel> [--baseline <model@tag>] [--window <Nh>] [--threshold <0-1>] [--emit-alert] [--dry-run]");
  console.log("  akai weights perf-profile --model <model.akmodel> [--tasks <t,...>] [--hardware <hw>] [--warmup <N>] [--runs <N>] [--out <file.akprofile>]");
  console.log("  akai weights ensemble-merge --models <m1,m2,...> [--method <linear|slerp|task-vector>] [--weights <w1,w2,...>] [--out <file.akmodel>] [--dry-run]");
  console.log("  akai weights pipeline-dag --plan <steps.json> [--validate-only] [--out <file.akdag>] [--model <model.akmodel>] [--hydrate-state <file>] [--integrity-proof <file|json>] [--dry-run]");
  console.log("  akai weights edge-compile --model <model.akmodel> --target <rpi4|jetson|coral|wasm> [--optimize <speed|size|balanced>] [--out <file.akedge>] [--dry-run]");
  console.log("  akai weights quantize-target --model <model.akmodel> --target <rpi4|jetson|coral|wasm|x86-avx2|arm-neon> [--bits <4|8|16>] [--calibrate <calib.json>] [--out <file.akquant>] [--dry-run]");
  console.log("  akai weights adapter-list --model <model.akmodel> [--task <task>]");
  console.log("  akai weights adapter-hot-swap --model <model.akmodel> --adapter <adapter-id> [--session <id>] [--dry-run]");
  console.log("  akai weights merge --base <model.akmodel> --adapters <a1,a2,...> [--method <linear|slerp|task-vector>] [--weights <w1,w2,...>] [--out <file.akmodel>] [--dry-run]");
  console.log("  akai weights split --model <model.akmodel> [--by <layer-range>] [--chunks <N>] [--out-dir <dir>] [--dry-run]");
  console.log("  akai weights freeze --model <model.akmodel> [--reason <text>] [--out <file.akfreeze>] [--dry-run]");
  console.log("  akai weights sae-probe --model <model.akmodel> [--features <f1,f2,...>] [--layer <all|layer>] [--top-k <N>] [--dry-run]");
  console.log("  akai weights sae-steer --model <model.akmodel> [--feature <name>] [--direction <toward|away>] [--magnitude <N>] [--out <file.akmodel>] [--dry-run]");
  console.log("  akai weights feature-drift --model-a <model@v1> --model-b <model@v2> [--features <all|f1,f2,...>] [--top-k <N>]");
  console.log("  akai weights kv-compress --model <model.akmodel> [--context <id>] [--tokens <N>] [--out <file.akkvcache>] [--dry-run]");
  console.log("  akai weights kv-restore --cache <file.akkvcache> [--model <model.akmodel>] [--session <id>] [--dry-run]");
  console.log("  akai weights sla-monitor --model <model.akmodel> [--window-min <N>] [--latency-sla-ms <N>] [--avail-sla <0-1>] [--emit-alert]");
  console.log("  akai weights budget-alert --model <model.akmodel> [--ceiling <usd>] [--window-hours <N>] [--fallback <policy>] [--dry-run]");
  console.log("  akai weights cost-forecast --model <model.akmodel> [--recipe <file.akrecipe>] [--horizon-hours <N>] [--rps <N>]");
  console.log("  akai weights hot-patch --model <model.akmodel> --patch <file.akdelta> [--session <id>] [--dry-run]");
  console.log("  akai weights credit-settle --model <model.akmodel> [--period <YYYY-MM>] [--out <file.akledger>] [--dry-run]");
  console.log("  akai weights p2p-seed --model <model.akmodel> [--chunks <N>] [--relay <uri>] [--dry-run]");
  console.log("  akai weights relay-handoff --session <id> [--peer <peer-id>] [--model <model.akmodel>] [--dry-run]");
  console.log("  akai weights geo-pin --model <model.akmodel> [--region <id>] [--replicas <N>] [--out <file.akattest>] [--dry-run]");
  console.log("  akai weights mirror-sync --model <model.akmodel> [--mirrors <m1,m2,...>] [--dry-run]");
  console.log("  akai weights escrow --model <model.akmodel> [--condition <rule>] [--recipient <id>] [--ttl-hours <N>] [--release] [--out <file.akescrow>] [--dry-run]");
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
  await weightsCommand(["weightless-run", ...rest]);
  process.exit(process.exitCode || 0);
}

// WeightOps — handled natively without legacy binary
if (command === "weights" || command === "weightops") {
  await weightsCommand(rest);
  process.exit(process.exitCode || 0);
}

// Memory Packs — handled natively
if (command === "memory") {
  memoryCommand(rest);
  process.exit(0);
}

// CAS — handled natively
if (command === "cas") {
  await casCommand(rest);
  process.exit(0);
}

// Packs — handled natively
if (command === "pack") {
  await packCommand(rest);
  process.exit(0);
}

// Fetch — handled natively
if (command === "fetch") {
  await fetchCommand(rest);
  process.exit(0);
}

// Delta planner — handled natively
if (command === "delta") {
  await deltaCommand(rest);
  process.exit(0);
}

// Manifest tooling — handled natively
if (command === "manifest") {
  await manifestCommand(rest);
  process.exit(process.exitCode || 0);
}

const target = resolveLegacyBinary(command);
const proc = spawnSync(target.bin, [...target.args, ...rest], {
  stdio: "inherit",
  env: detectLegacyEnv(),
});
process.exit(proc.status ?? 1);
