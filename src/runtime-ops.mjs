/**
 * src/runtime-ops.mjs
 *
 * Native runtime control / orchestration commands:
 *   api.status       — local health check
 *   runtime.dispatch — look up command dispatch path
 *   control.route    — apply a control signal routing rule
 *   tier.route       — route by tier policy
 *   stitch.plan      — plan a multi-step workflow stitch
 *   watch.path       — stat-based file watch (one-shot + change detection)
 *   workflow.run     — run a local workflow definition file
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, "..");
const AUREKAI_DIR = join(homedir(), ".aurekai");
const STATE_DIR   = join(AUREKAI_DIR, "runtime");

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function sha256(buf) { return "sha256:" + createHash("sha256").update(buf).digest("hex"); }

// ── api.status ───────────────────────────────────────────────────────────────
async function cmdApiStatus(args) {
  const asJson = hasFlag(args, "--json");
  const pkgPath = join(repoRoot, "package.json");
  let version = "(unknown)";
  try { version = JSON.parse(readFileSync(pkgPath, "utf8")).version; } catch {}

  const regPath = join(repoRoot, "registry", "aurekai.capabilities.json");
  let regHash = null, commandCount = 0;
  try {
    const regBuf = readFileSync(regPath);
    regHash = sha256(regBuf);
    const reg = JSON.parse(regBuf);
    commandCount = reg.families?.reduce((s, f) => s + (f.commands?.length ?? 0), 0) ?? 0;
    for (const t of reg.experimental_tracks ?? []) commandCount += t.commands?.length ?? 0;
  } catch {}

  const dirs = {
    audit:    existsSync(join(AUREKAI_DIR, "audit")),
    netlists: existsSync(join(AUREKAI_DIR, "netlists")),
    meter:    existsSync(join(AUREKAI_DIR, "meter")),
    queue:    existsSync(join(AUREKAI_DIR, "queue")),
    space:    existsSync(join(AUREKAI_DIR, "space")),
    artifacts:existsSync(join(AUREKAI_DIR, "artifacts")),
    intake:   existsSync(join(AUREKAI_DIR, "intake")),
    reason:   existsSync(join(AUREKAI_DIR, "reason")),
  };
  const dirsOk = Object.values(dirs).filter(Boolean).length;
  const hyperReachable = spawnSync("which", ["bonfyre-hyper"], { encoding: "utf8" }).status === 0;

  const result = {
    schema_version: "aurekai.api.status.v1",
    checked_at: now(),
    version,
    registry_hash: regHash,
    declared_commands: commandCount,
    hyper_reachable: hyperReachable,
    dirs,
    dirs_initialized: `${dirsOk}/${Object.keys(dirs).length}`,
    verdict: "OK",
  };
  if (asJson) printJson(result);
  else {
    process.stdout.write(`aurekai v${version}  registry: ${commandCount} commands\n`);
    process.stdout.write(`hyper: ${hyperReachable ? "reachable" : "NOT REACHABLE"}  dirs: ${dirsOk}/${Object.keys(dirs).length} initialized\n`);
  }
  return result;
}

// ── runtime.dispatch ─────────────────────────────────────────────────────────
async function cmdRuntimeDispatch(args) {
  const cmd    = flag(args, "--command") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");
  if (!cmd) { console.error("  error: runtime dispatch requires --command <name>"); process.exitCode = 1; return; }

  const { buildTruthMatrix } = await import("./truth-matrix.mjs");
  const matrix = buildTruthMatrix();
  const entry  = matrix.commands.find(e => e.command === cmd || e.command.startsWith(cmd + "."));

  const result = {
    schema_version: "aurekai.runtime.dispatch.v1",
    resolved_at: now(),
    command: cmd,
    execution_state: entry?.execution_state ?? "unknown",
    cli_surface: entry?.cli_surface ?? null,
    family: entry?.family ?? null,
    routable: !!(entry && entry.execution_state !== "declared-only"),
    verdict: entry ? (entry.execution_state === "declared-only" ? "NOT_RUNNABLE" : "ROUTABLE") : "UNKNOWN_COMMAND",
  };
  if (asJson) printJson(result);
  else process.stdout.write(`${cmd}  →  ${result.verdict}  (${result.execution_state})  ${result.cli_surface ?? ""}\n`);
  return result;
}

// ── control.route ─────────────────────────────────────────────────────────────
function cmdControlRoute(args) {
  const signal = flag(args, "--signal") ?? args.find(a => !a.startsWith("--")) ?? "default";
  const policy = flag(args, "--policy");
  const asJson = hasFlag(args, "--json");

  const policyFile = join(AUREKAI_DIR, "policies", "control-route.json");
  let rules = {};
  if (existsSync(policyFile)) { try { rules = JSON.parse(readFileSync(policyFile, "utf8")); } catch {} }
  if (policy) { try { rules = { ...rules, ...JSON.parse(policy) }; } catch {} }

  const route = rules[signal] ?? rules["*"] ?? "default-handler";
  const result = { schema_version: "aurekai.control.route.v1", routed_at: now(), signal, route, policy_source: existsSync(policyFile) ? policyFile : "builtin-defaults" };
  if (asJson) printJson(result);
  else process.stdout.write(`signal: ${signal}  →  route: ${route}\n`);
  return result;
}

// ── tier.route ────────────────────────────────────────────────────────────────
function cmdTierRoute(args) {
  const input  = flag(args, "--input") ?? args.find(a => !a.startsWith("--")) ?? "unknown";
  const asJson = hasFlag(args, "--json");

  const tierFile = join(AUREKAI_DIR, "policies", "tier-policy.json");
  let policy = { tiers: ["t1", "t2", "t3"], default: "t1", rules: {} };
  if (existsSync(tierFile)) { try { policy = JSON.parse(readFileSync(tierFile, "utf8")); } catch {} }

  const tier = policy.rules[input] ?? policy.default ?? "t1";
  const result = { schema_version: "aurekai.tier.route.v1", routed_at: now(), input, tier, policy_source: existsSync(tierFile) ? tierFile : "builtin-defaults" };
  if (asJson) printJson(result);
  else process.stdout.write(`input: ${input}  →  tier: ${tier}\n`);
  return result;
}

// ── stitch.plan ───────────────────────────────────────────────────────────────
async function cmdStitchPlan(args) {
  const steps  = (flag(args, "--steps") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");

  if (!steps.length) { console.error("  error: stitch plan requires --steps a,b,c"); process.exitCode = 1; return; }

  const { buildTruthMatrix } = await import("./truth-matrix.mjs");
  const matrix = buildTruthMatrix();
  const cmdMap = new Map(matrix.commands.map(e => [e.command, e]));

  const plan = steps.map((step, i) => {
    const entry = cmdMap.get(step);
    return {
      step: i + 1, command: step,
      executable: !!(entry && entry.execution_state !== "declared-only"),
      cli_surface: entry?.cli_surface ?? null,
      execution_state: entry?.execution_state ?? "unknown",
    };
  });

  const allExecutable = plan.every(p => p.executable);
  const result = {
    schema_version: "aurekai.stitch.plan.v1",
    planned_at: now(),
    step_count: plan.length,
    all_executable: allExecutable,
    steps: plan,
    verdict: allExecutable ? "READY" : "HAS_GAPS",
  };

  if (outArg) { ensureDir(dirname(resolve(outArg))); writeFileSync(resolve(outArg), JSON.stringify(result, null, 2) + "\n", "utf8"); }
  if (asJson) printJson(result);
  else {
    process.stdout.write(`stitch plan: ${plan.length} steps  verdict: ${result.verdict}\n`);
    for (const s of plan) process.stdout.write(`  ${s.step}. ${s.command.padEnd(30)} ${s.executable ? "READY" : "GAP    "} ${s.cli_surface ?? ""}\n`);
  }
  return result;
}

// ── watch.path ────────────────────────────────────────────────────────────────
function cmdWatchPath(args) {
  const path   = flag(args, "--path") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");
  if (!path) { console.error("  error: watch path requires --path <file>"); process.exitCode = 1; return; }

  const absPath = resolve(process.cwd(), path);
  const stateFile = join(AUREKAI_DIR, "watch", sha256(Buffer.from(absPath)).replace("sha256:", "").slice(0, 16) + ".json");

  let prev = null;
  if (existsSync(stateFile)) { try { prev = JSON.parse(readFileSync(stateFile, "utf8")); } catch {} }

  let current = null;
  if (existsSync(absPath)) {
    const st = statSync(absPath);
    const hash = sha256(readFileSync(absPath));
    current = { mtime: st.mtime.toISOString(), size: st.size, hash };
  }

  const changed = prev && current ? prev.hash !== current.hash : false;
  const result = {
    schema_version: "aurekai.watch.path.v1",
    checked_at: now(), path: absPath,
    exists: !!current, current, previous: prev,
    changed, verdict: !current ? "NOT_FOUND" : changed ? "CHANGED" : prev ? "UNCHANGED" : "FIRST_OBSERVATION",
  };

  ensureDir(dirname(stateFile));
  if (current) writeFileSync(stateFile, JSON.stringify({ ...current, path: absPath, observed_at: now() }, null, 2), "utf8");

  if (asJson) printJson(result);
  else process.stdout.write(`${absPath}  ${result.verdict}${changed ? `  (${prev.hash} → ${current.hash})` : ""}\n`);
  return result;
}

// ── workflow.run ──────────────────────────────────────────────────────────────
async function cmdWorkflowRun(args) {
  const defFile = flag(args, "--definition") ?? flag(args, "--def") ?? args.find(a => !a.startsWith("--"));
  const asJson  = hasFlag(args, "--json");
  if (!defFile) { console.error("  error: workflow run requires --definition <file.json>"); process.exitCode = 1; return; }

  const absPath = resolve(process.cwd(), defFile);
  if (!existsSync(absPath)) { console.error(`  error: workflow definition not found: ${absPath}`); process.exitCode = 1; return; }

  let wf;
  try { wf = JSON.parse(readFileSync(absPath, "utf8")); }
  catch (e) { console.error(`  error: invalid JSON in workflow definition: ${e.message}`); process.exitCode = 1; return; }

  const steps = wf.steps ?? wf.workflow ?? [];
  const { buildTruthMatrix } = await import("./truth-matrix.mjs");
  const matrix = buildTruthMatrix();
  const cmdMap = new Map(matrix.commands.map(e => [e.command, e]));

  const results = [];
  for (const step of steps) {
    const cmd = step.command ?? step.cmd ?? "(unknown)";
    const entry = cmdMap.get(cmd);
    results.push({
      command: cmd, params: step.params ?? {},
      executable: !!(entry && entry.execution_state !== "declared-only"),
      execution_state: entry?.execution_state ?? "unknown",
      skipped_reason: !entry ? "not in registry" : entry.execution_state === "declared-only" ? "declared-only" : null,
    });
  }

  const result = {
    schema_version: "aurekai.workflow.run.v1", executed_at: now(),
    definition: absPath, name: wf.name ?? "(unnamed)",
    steps_total: steps.length,
    steps_executable: results.filter(r => r.executable).length,
    steps_skipped: results.filter(r => !r.executable).length,
    steps: results,
    verdict: results.every(r => r.executable) ? "ALL_EXECUTED" : "PARTIAL",
  };

  if (asJson) printJson(result);
  else {
    process.stdout.write(`workflow: ${result.name}  ${result.steps_executable}/${result.steps_total} steps executable\n`);
    for (const r of results) process.stdout.write(`  ${r.executable ? "✓" : "✗"} ${r.command.padEnd(30)} ${r.execution_state}\n`);
  }
  return result;
}

export async function runtimeOpsCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "status":   await cmdApiStatus(rest);      break;
    case "dispatch": await cmdRuntimeDispatch(rest); break;
    case "route":    cmdControlRoute(rest);          break;
    case "tier":     cmdTierRoute(rest);             break;
    case "stitch":   await cmdStitchPlan(rest);      break;
    case "watch":    cmdWatchPath(rest);             break;
    case "workflow": await cmdWorkflowRun(rest);     break;
    default:
      console.error(`  error: unknown runtime-ops subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

// Dedicated single-command entry points used by bin/akai.mjs dispatch
export { cmdApiStatus as apiStatusCommand };
export { cmdRuntimeDispatch as runtimeDispatchCommand };
export { cmdControlRoute as controlRouteCommand };
export { cmdTierRoute as tierRouteCommand };
export { cmdStitchPlan as stitchPlanCommand };
export { cmdWatchPath as watchPathCommand };
export { cmdWorkflowRun as workflowRunCommand };
