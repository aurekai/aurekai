/**
 * Aurekai command truth matrix.
 *
 * Reads registry/aurekai.capabilities.json and registry/integrations.json,
 * cross-references against the known native command set, and produces a
 * machine-readable map of execution_state for every declared command.
 *
 * Execution states:
 *   native          — implemented natively in akai CLI, no Hyper needed
 *   hyper-delegated — routes to HyperRuntime if installed
 *   declared-only   — exists in registry, no runnable path known
 *   integration-only — claimed in integrations but not in registry
 *
 * Output: registry/command-truth-matrix.json  (machine-readable)
 *         text table via --print (human-readable)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

/**
 * Canonical map: registry command → { execution_state, cli_surface }
 *
 * Keep this in sync with bin/akai.mjs dispatch and the src/ modules.
 * When a new command is implemented, add it here.
 */
const NATIVE_COMMANDS = new Map([
  // proof
  ["proof.bundle",              "akai proof bundle"],
  ["proof.compact",             "akai proof compact"],
  // runtime / substrate introspection
  ["runtime.capabilities",      "akai runtime capabilities"],
  ["capability.registry",       "akai capability registry"],
  // model
  ["model.verify",              "akai model verify"],
  // canon
  ["canon.hash",                "akai canon hash"],
  ["canon.parse",               "akai canon parse"],
  ["canon.diff",                "akai canon diff"],
  // net / wire
  ["net.seal",                  "akai net seal"],
  ["net.eval_sealed",           "akai net eval-sealed"],
  // graph
  ["graph.lineage",             "akai graph lineage"],
  ["graph.merkle",              "akai graph merkle"],
  ["graph.validate",            "akai graph validate"],
  // block algebra
  ["block.inspect",             "akai block inspect"],
  ["block.commute",             "akai block commute"],
  // fpqx
  ["fpqx.align",                "akai fpqx plan"],
  ["fpqx.eval",                 "akai fpqx plan"],
  // sae / memory
  ["sae.activate",              "akai weights sae-probe"],
  ["sae.gate",                  "akai weights sae-probe"],
  ["kvcache.chain",             "akai weights kv-compress"],
  ["kvcache.ancestry",          "akai weights kv-restore"],
  // model memory
  ["model.pull",                "akai weights hydrate"],
  ["model.route",               "akai weights arb-route"],
  ["fpq.compress",              "akai weights compile"],
  ["fpq.roundtrip",             "akai weights verify-fidelity"],
  ["quant.roundtrip",           "akai weights synth-quant"],
  ["sli.auto_run",              "akai weights ghost-infer"],
  ["layer.compat",              "akai block inspect"],
  // proof chain / integrity
  ["hash.file",                 "akai weights prove"],
  ["hash.merkle",               "akai graph merkle"],
  ["graph.lineage",             "akai graph lineage"],
  ["index.equivalence",         "akai weights proof-chain"],
  ["proof.export",              "akai proof bundle --out"],
  // release / runtime gate
  ["release.gate",              "akai weights integrity-gate"],
  ["manifest.verify",           "akai manifest verify"],
  ["doctor.deep",               "akai runtime doctor"],
]);

/**
 * Commands that are routed to HyperRuntime when available.
 * Everything in the registry that is NOT in NATIVE_COMMANDS falls here,
 * unless explicitly marked declared-only.
 */
const DECLARED_ONLY_COMMANDS = new Set([
  // No known path in either native or Hyper at this time
  // (These are real registry entries with no current implementation)
  "embed.text",
  "vec.search",
  "query.sql",
  "entity.resolve",
  "family.group",
  "compress.family",
  "stitch.plan",
  "watch.path",
  "control.route",
  "tier.route",
  "workflow.run",
  "api.status",
  "runtime.dispatch",
  "queue.enqueue",
  "queue.stats",
  "queue.work",
  "auth.verify",
  "gate.issue",
  "gate.guard",
  "meter.record",
  "usage.report",
  "ledger.export",
  "finance.margin",
  "pay.invoice",
  "invoice.generate",
  "outreach.followup",
  "cms.entry.create",
  "project.create",
  "ingest.file",
  "media_prep.normalize",
  "transcribe.audio",
  "transcript.clean",
  "segment.speakers",
  "paragraph.reflow",
  "frame_extract.video",
  "video_demux.split",
  "scene_detect.video",
  "speech_loop.transform",
  "reason.start",
  "reason.branch",
  "reason.run",
  "reason.diff",
  "reason.rebase",
  "physics.init",
  "physics.kick",
  "physics.run",
  "physics.diff",
  "flow.branch",
  "learn.feedback",
  "learn.tune",
  "tel.listen",
  "tel.mock",
  "tel.sim_call",
  "tel.sim_sms",
  "tel.send_sms",
  "wire.doctor",
  "wire.ingest_pcap",
  "wire.probe",
  "wire.report",
  "wire.recipe",
  "wire.space_export",
  "moq.video_relay",
  "brief.generate",
  "narrate.brief",
  "render.document",
  "pack.deliverable",
  "emit.artifact",
  "distribute.bundle",
  "clips.extract",
  "repurpose.content",
  "surface.publish",
  "space.open",
  "space.put",
  "space.attach",
  "time.schedule",
  "time.rerun",
  "netlist.seal",
  "netlist.eval_sealed",
  "violence.coupling_test",
]);

function loadJson(rel) {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), "utf8"));
}

function now() { return new Date().toISOString(); }

export function buildTruthMatrix() {
  const capDoc = loadJson("registry/aurekai.capabilities.json");
  const intDoc = loadJson("registry/integrations.json");

  const registryCommands = new Set();
  const familyOf = new Map();
  for (const family of capDoc.families ?? []) {
    for (const cmd of family.commands ?? []) {
      registryCommands.add(cmd);
      familyOf.set(cmd, family.id);
    }
  }
  for (const track of capDoc.experimental_tracks ?? []) {
    for (const cmd of track.commands ?? []) {
      registryCommands.add(cmd);
      familyOf.set(cmd, `experimental:${track.id}`);
    }
  }

  // Commands claimed as native by integrations
  const integrationClaimedCommands = new Set();
  for (const int of intDoc.integrations ?? []) {
    for (const cmd of int.native_commands ?? []) integrationClaimedCommands.add(cmd);
  }

  // Commands only in integrations, not in registry
  const integrationOnlyCommands = new Set(
    [...integrationClaimedCommands].filter(c => !registryCommands.has(c))
  );

  const entries = [];

  for (const cmd of registryCommands) {
    let execution_state;
    let cli_surface = null;

    if (NATIVE_COMMANDS.has(cmd)) {
      execution_state = "native";
      cli_surface = NATIVE_COMMANDS.get(cmd);
    } else if (DECLARED_ONLY_COMMANDS.has(cmd)) {
      execution_state = "declared-only";
    } else {
      // Default: hyper-delegated (requires HyperRuntime)
      execution_state = "hyper-delegated";
    }

    entries.push({
      command: cmd,
      family: familyOf.get(cmd) || "unknown",
      execution_state,
      cli_surface,
      in_registry: true,
      claimed_by_integrations: integrationClaimedCommands.has(cmd),
    });
  }

  for (const cmd of integrationOnlyCommands) {
    entries.push({
      command: cmd,
      family: "integration-only",
      execution_state: "integration-only",
      cli_surface: null,
      in_registry: false,
      claimed_by_integrations: true,
    });
  }

  entries.sort((a, b) => a.command.localeCompare(b.command));

  const stateCounts = entries.reduce((acc, e) => {
    acc[e.execution_state] = (acc[e.execution_state] || 0) + 1;
    return acc;
  }, {});

  return {
    schema_version: "aurekai.truth-matrix.v1",
    generated_at: now(),
    totals: {
      commands: entries.length,
      ...stateCounts,
    },
    commands: entries,
  };
}

// ---------------------------------------------------------------------------
// CLI command: akai truth [--json] [--out <file>] [--print]
// ---------------------------------------------------------------------------
function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] || null; }
function hasFlag(args, name) { return args.includes(name); }

export async function truthCommand(args) {
  const outFile = flag(args, "--out");
  const asJson = hasFlag(args, "--json") || !hasFlag(args, "--print");
  const print = hasFlag(args, "--print");

  const matrix = buildTruthMatrix();
  const defaultOut = resolve(repoRoot, "registry", "command-truth-matrix.json");
  const writePath = outFile ? resolve(outFile) : defaultOut;

  writeFileSync(writePath, JSON.stringify(matrix, null, 2) + "\n", "utf8");

  if (print) {
    // Human-readable table
    const stateLabel = {
      "native": "NATIVE    ",
      "hyper-delegated": "HYPER     ",
      "declared-only": "DECLARED  ",
      "integration-only": "INTEG-ONLY",
    };
    const byFamily = {};
    for (const e of matrix.commands) {
      const f = e.family;
      if (!byFamily[f]) byFamily[f] = [];
      byFamily[f].push(e);
    }
    for (const [family, cmds] of Object.entries(byFamily).sort()) {
      console.log(`\n  ${family}`);
      for (const c of cmds) {
        const state = stateLabel[c.execution_state] || c.execution_state.padEnd(10);
        const surface = c.cli_surface ? `  → ${c.cli_surface}` : "";
        console.log(`    ${state}  ${c.command}${surface}`);
      }
    }
    console.log(`\n  totals: ${JSON.stringify(matrix.totals)}`);
  }

  if (asJson && !print) {
    process.stdout.write(JSON.stringify(matrix, null, 2) + "\n");
    return;
  }

  console.log(`truth matrix written to ${writePath}`);
  console.log(`totals: ${JSON.stringify(matrix.totals)}`);
}
