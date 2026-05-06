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
import { benchCommand } from "../src/bench.mjs";
import { proofCommand } from "../src/proof-compact.mjs";
import { mcpCommand } from "../src/mcp-distribution.mjs";
import { blockCommand, gaugeCommand } from "../src/block.mjs";
import { fpqxCommand } from "../src/fpqx-command.mjs";
import { canonCommand } from "../src/canon.mjs";
import { netCommand } from "../src/net-seal.mjs";
import { graphCommand } from "../src/graph-ops.mjs";
import { truthCommand, buildTruthMatrix } from "../src/truth-matrix.mjs";
import { wireCommand } from "../src/wire-ops.mjs";
import { briefCommand } from "../src/brief-gen.mjs";
import { meterCommand } from "../src/meter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const NATIVE_TOP_LEVEL_COMMANDS = [
  "weights", "weightops", "memory", "cas", "pack", "fetch", "delta",
  "manifest", "bench", "proof", "mcp", "block", "gauge", "fpqx",
  "canon", "net", "graph",
  "wire", "brief", "meter",
  "runtime doctor|capabilities", "capability registry",
  "model verify", "truth",
  "run --weightless-first",
];

const NATIVE_CAPABILITY_COMMANDS = new Set([
  "proof.bundle", "proof.compact",
  "runtime.capabilities", "capability.registry",
  "model.verify",
  "canon.hash", "canon.parse", "canon.diff",
  "net.seal", "net.eval_sealed",
  "graph.lineage", "graph.merkle", "graph.validate",
  "wire.report", "wire.doctor",
  "brief.generate",
  "meter.record", "meter.list", "meter.summary",
  "block.inspect", "block.commute",
  "fpqx.align", "fpqx.eval",
  "release.gate", "manifest.verify", "doctor.deep",
  "hash.merkle", "proof.export", "index.equivalence",
  "sae.activate", "sae.gate", "kvcache.chain", "kvcache.ancestry",
  "model.pull", "model.route", "fpq.compress", "fpq.roundtrip",
  "quant.roundtrip", "sli.auto_run", "layer.compat", "hash.file",
]);

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
  console.log("  akai model verify <model>");
  console.log("  akai fpqx:align-sae ...");
  console.log("  akai runtime doctor [--deep] [--json]");
  console.log("  akai runtime capabilities [--json]");
  console.log("  akai capability registry [--json]");
  console.log("  akai truth [--json] [--print] [--out <file>]");
  console.log("  akai canon hash  --in <file> [--algorithm sha256] [--canonical-json] [--json]");
  console.log("  akai canon parse --in <file> [--out <canon.json>] [--json]");
  console.log("  akai canon diff  --a <file_a> --b <file_b> [--json]");
  console.log("  akai net seal        --netlist <file> [--out <file.aknetlist>] [--json]");
  console.log("  akai net eval-sealed --netlist <file.aknetlist> [--json]");
  console.log("  akai graph lineage   --model <model> [--depth <N>] [--json]");
  console.log("  akai graph merkle    --inputs <f1,f2,...> [--json]");
  console.log("  akai graph validate  --merkle <file.akgraph> [--json]");
  console.log("  akai wire report     [--model <name>] [--since <iso>] [--out <file>] [--json]");
  console.log("  akai wire doctor     [--json]");
  console.log("  akai brief generate  --input <file> [--title <text>] [--format json|md] [--out <file>] [--json]");
  console.log("  akai meter record    --event <name> [--model <name>] [--quantity <n>] [--unit <unit>] [--json]");
  console.log("  akai meter list      [--model <name>] [--since <iso>] [--json]");
  console.log("  akai meter summary   [--model <name>] [--since <iso>] [--json]");
  console.log("  akai cas import|verify|materialize|stats|gc ...");
  console.log("  akai pack build|inspect|materialize|optimize|mount ...");
  console.log("  akai fetch range|multipart|resume|verify ...");
  console.log("  akai delta plan|bench ...");
  console.log("  akai manifest bin-compile|bin-verify|keygen|sign|verify-signature ...");
  console.log("  akai bench distribution|hydrate|pack-layout|proof|all [--size-mb N] [--runs N]");
  console.log("  akai proof bundle --in <proof.json> [--out <aurekai-proof.akproof.json>] [--json]");
  console.log("  akai proof compact --in <proof.json> [--out <proof.akproofbin>]");
  console.log("  akai proof view --bin <proof.akproofbin> [--json]");
  console.log("  akai mcp start|stop|status [--host <host>] [--port <port>]");
  console.log("  akai block inspect <model|layer|tensor> [--layer N] [--tensor name] [--json]");
  console.log("  akai block commute --a <delta_a> --b <delta_b> [--tensor name] [--json]");
  console.log("  akai gauge fix <model.fpqx> --preserve energy,subspace,cosine [--json]");
  console.log("  akai fpqx plan <model.safetensors> --target edge|metal|cuda|neon [--context 8k|128k]");
  console.log("  akai weights compile <model.safetensors> --objective latency=N,bw=N,cosine=N --target metal|cuda|cpu");
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

function runtimeTargetFor(command) {
  const target = resolveLegacyBinary(command);
  let reachable = false;
  if (target.bin === "bonfyre-hyper") {
    const which = spawnSync("which", [target.bin], { encoding: "utf8" });
    reachable = which.status === 0;
  } else {
    reachable = existsSync(target.bin);
  }
  return { target, reachable };
}

function flattenCapabilities(capDoc) {
  const out = [];
  const families = Array.isArray(capDoc?.families) ? capDoc.families : [];
  for (const family of families) {
    const cmds = Array.isArray(family?.commands) ? family.commands : [];
    for (const cmd of cmds) {
      out.push({ family: family.id || "unknown", command: String(cmd) });
    }
  }
  return out;
}

function classifyCapabilityCommand(command, hyperReachable) {
  if (NATIVE_CAPABILITY_COMMANDS.has(command)) return "native";
  return hyperReachable ? "delegated" : "unavailable";
}

function cmdRuntimeDoctor(args) {
  const asJson = args.includes("--json");
  const deep = args.includes("--deep");
  const envHyper = process.env.AKAI_HYPER || process.env.AUREKAI_HYPER || process.env.BONFYRE_HYPER || null;
  const check = runtimeTargetFor("doctor");
  const targetType = check.target.bin === "bonfyre-hyper" ? "path-fallback" : "resolved-artifact";

  const payload = {
    schema_version: "aurekai.runtime.doctor.v1",
    status: check.reachable ? "PASS" : "FAIL",
    checked_at: new Date().toISOString(),
    deep,
    hyper_runtime: {
      reachable: check.reachable,
      target_bin: check.target.bin,
      target_args: check.target.args,
      resolution_type: targetType,
      env_override: envHyper,
    },
    remediation: check.reachable
      ? []
      : [
          "Set AKAI_HYPER=/path/to/bonfyre-hyper",
          "Install bonfyre-hyper on PATH",
          "Clone ../bonfyre-hyper/src/hyper.ts and install bun",
        ],
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    process.exit(check.reachable ? 0 : 1);
  }

  if (check.reachable) {
    console.log("HyperRuntime contract: PASS");
    console.log(`Resolved target: ${check.target.bin}`);
    process.exit(0);
  }

  console.error("HyperRuntime contract: FAIL");
  console.error(`Resolved target: ${check.target.bin}`);
  console.error("Resolution options:");
  console.error("  1. Set AKAI_HYPER=/path/to/bonfyre-hyper");
  console.error("  2. Place bonfyre-hyper on your PATH");
  console.error("  3. Clone ../bonfyre-hyper/src/hyper.ts and install bun");
  process.exit(1);
}

function cmdRuntimeCapabilities(args) {
  const asJson = args.includes("--json");
  const capPath = join(repoRoot, "registry", "aurekai.capabilities.json");
  const capDoc = JSON.parse(readFileSync(capPath, "utf8"));
  const flat = flattenCapabilities(capDoc);
  const check = runtimeTargetFor("runtime");

  const entries = flat.map(item => ({
    family: item.family,
    command: item.command,
    execution_state: classifyCapabilityCommand(item.command, check.reachable),
  }));

  const stateCounts = entries.reduce((acc, entry) => {
    acc[entry.execution_state] = (acc[entry.execution_state] || 0) + 1;
    return acc;
  }, { native: 0, delegated: 0, unavailable: 0 });

  const payload = {
    schema_version: "aurekai.runtime.capabilities.v1",
    generated_at: new Date().toISOString(),
    source: capPath,
    hyper_runtime_reachable: check.reachable,
    totals: {
      commands: entries.length,
      ...stateCounts,
    },
    capabilities: entries,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  console.log(`Runtime capabilities: ${entries.length} commands`);
  console.log(`native=${stateCounts.native} delegated=${stateCounts.delegated} unavailable=${stateCounts.unavailable}`);
}

function cmdCapabilityRegistry(args) {
  const asJson = args.includes("--json");
  const capPath = join(repoRoot, "registry", "aurekai.capabilities.json");
  const capDoc = JSON.parse(readFileSync(capPath, "utf8"));
  const check = runtimeTargetFor("capability");
  const flat = flattenCapabilities(capDoc);

  const families = (capDoc.families || []).map(family => ({
    id: family.id,
    label: family.label,
    command_count: Array.isArray(family.commands) ? family.commands.length : 0,
  }));

  const payload = {
    schema_version: "aurekai.capability.registry.v1",
    generated_at: new Date().toISOString(),
    source: capPath,
    family_count: families.length,
    command_count: flat.length,
    hyper_runtime_reachable: check.reachable,
    families,
    experimental_tracks: capDoc.experimental_tracks || [],
    packs: capDoc.packs || {},
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  console.log(`Capability registry: families=${families.length} commands=${flat.length}`);
  console.log(`hyper-runtime reachable=${check.reachable ? "yes" : "no"}`);
}

async function cmdModelVerify(args) {
  const model = args.find(arg => !arg.startsWith("-"));
  if (!model) {
    throw new Error("model verify requires <model>");
  }
  const passThrough = args.filter(arg => arg !== model);
  await weightsCommand(["prove", model, ...passThrough]);
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

if (command === "runtime" && (rest[0] === "doctor" || rest[0] === "capabilities")) {
  if (rest[0] === "doctor") cmdRuntimeDoctor(rest.slice(1));
  if (rest[0] === "capabilities") cmdRuntimeCapabilities(rest.slice(1));
  process.exit(0);
}

if (command === "capability" && rest[0] === "registry") {
  cmdCapabilityRegistry(rest.slice(1));
  process.exit(0);
}

if ((command === "model" && rest[0] === "verify") || command === "model:verify") {
  const modelArgs = command === "model:verify" ? rest : rest.slice(1);
  await cmdModelVerify(modelArgs);
  process.exit(process.exitCode || 0);
}

// Truth matrix — handled natively
if (command === "truth") {
  await truthCommand(rest);
  process.exit(process.exitCode || 0);
}

// Canon operations — handled natively
if (command === "canon") {
  await canonCommand(rest);
  process.exit(process.exitCode || 0);
}

// Net seal/eval — handled natively
if (command === "net" || command === "netlist") {
  await netCommand(rest);
  process.exit(process.exitCode || 0);
}

// Graph operations — handled natively
if (command === "graph") {
  await graphCommand(rest);
  process.exit(process.exitCode || 0);
}

// Wire diagnostics / reporting — handled natively
if (command === "wire") {
  await wireCommand(rest);
  process.exit(process.exitCode || 0);
}

// Brief generation — handled natively
if (command === "brief") {
  await briefCommand(rest);
  process.exit(process.exitCode || 0);
}

// Meter (usage event recording) — handled natively
if (command === "meter") {
  await meterCommand(rest);
  process.exit(process.exitCode || 0);
}

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

// Benchmark suite — handled natively
if (command === "bench") {
  await benchCommand(rest);
  process.exit(process.exitCode || 0);
}

// Proof compression — handled natively
if (command === "proof") {
  await proofCommand(rest);
  process.exit(process.exitCode || 0);
}

// MCP distribution server — handled natively
if (command === "mcp") {
  await mcpCommand(rest);
  process.exit(process.exitCode || 0);
}

// Block Algebra — handled natively
if (command === "block") {
  await blockCommand(rest);
  process.exit(process.exitCode || 0);
}

// Gauge operations — handled natively
if (command === "gauge") {
  await gaugeCommand(rest);
  process.exit(process.exitCode || 0);
}

// FPQ-X planning — handled natively
if (command === "fpqx" || command === "fpqx:plan" || command === "fpqx:align-sae") {
  await fpqxCommand(command === "fpqx:plan" ? ["plan", ...rest] : rest);
  process.exit(process.exitCode || 0);
}

const target = resolveLegacyBinary(command);

// Before spawning, verify the binary is reachable — spawnSync gives no output on ENOENT
let binaryReachable = false;
if (target.bin === "bonfyre-hyper") {
  const which = spawnSync("which", [target.bin], { encoding: "utf8" });
  binaryReachable = which.status === 0;
} else {
  binaryReachable = existsSync(target.bin);
}

if (!binaryReachable) {
  // Check if the command root is in the capability registry (declared-only)
  // so we can give a more precise message than just "Hyper not installed".
  let matrix = null;
  try { matrix = buildTruthMatrix(); } catch { /* registry may not be present */ }

  const commandRoot = command.replace(/:.*$/, "");
  const matchedEntry = matrix?.commands?.find(
    e => e.command.startsWith(commandRoot + ".") || e.command === commandRoot
  );

  if (matchedEntry) {
    if (matchedEntry.execution_state === "declared-only") {
      console.error(`  error: '${command}' is declared in the Aurekai capability registry but has no runnable implementation yet.`);
      console.error(`  execution_state: declared-only  (family: ${matchedEntry.family})`);
      console.error(`  This command requires the HyperRuntime execution layer, which is not yet shipped.`);
      console.error(`  Run 'akai truth --print' to see the full execution state map.`);
      process.exit(2);
    } else if (matchedEntry.execution_state === "hyper-delegated") {
      console.error(`  error: '${command}' requires HyperRuntime (family: ${matchedEntry.family}).`);
      console.error(`  execution_state: hyper-delegated — HyperRuntime is not installed.`);
    } else {
      console.error(`  error: command '${command}' requires the bonfyre-hyper runtime, which is not installed.`);
    }
  } else {
    console.error(`  error: unknown command '${command}'.`);
    console.error(`  Run 'akai truth --print' to see all declared commands and their execution states.`);
  }

  console.error("");
  console.error("  Resolution options:");
  console.error("    1. Set AKAI_HYPER=/path/to/bonfyre-hyper in your environment");
  console.error("    2. Place a bonfyre-hyper binary on your PATH");
  console.error("    3. Clone bonfyre-hyper to ../bonfyre-hyper/src/hyper.ts and install bun");
  console.error("");
  console.error("  Natively available without bonfyre-hyper:");
  console.error("    " + NATIVE_TOP_LEVEL_COMMANDS.join("  "));
  console.error("");
  console.error("  Contract check:");
  console.error("    akai runtime doctor --json");
  process.exit(matchedEntry?.execution_state === "declared-only" ? 2 : 127);
}

const proc = spawnSync(target.bin, [...target.args, ...rest], {
  stdio: "inherit",
  env: detectLegacyEnv(),
});
process.exit(proc.status ?? 1);
