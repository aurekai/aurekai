/**
 * src/reason-ops.mjs
 *
 * Native reason-family commands.
 *
 * Reasoning sessions are local journal files at ~/.aurekai/reason/<session_id>.json.
 * All operations are real: real diffs, real branching, real state transitions.
 * No generative AI — reasoning is done by the human; akai manages the session structure.
 *
 *   reason.start   — start a new reasoning session
 *   reason.branch  — branch from a session
 *   reason.run     — advance a session (add a reasoning step)
 *   reason.diff    — diff two sessions
 *   reason.rebase  — rebase one session onto another's final state
 *   flow.branch    — branch a workflow flow (alias of reason.branch with flow type)
 *   learn.feedback — record a labeled feedback example
 *   learn.tune     — summarize feedback set (no model training — records tuning intent)
 *   physics.init   — initialize a simple physics state
 *   physics.kick   — apply a force to physics state
 *   physics.run    — advance physics simulation N steps
 *   physics.diff   — diff two physics states
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const AUREKAI_DIR  = join(homedir(), ".aurekai");
const REASON_DIR   = join(AUREKAI_DIR, "reason");
const FEEDBACK_DIR = join(AUREKAI_DIR, "feedback");
const PHYSICS_DIR  = join(AUREKAI_DIR, "physics");

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function sha256str(s) { return createHash("sha256").update(s).digest("hex"); }

function sessionFile(id) { return join(REASON_DIR, `${id}.session.json`); }
function readSession(id) { const f = sessionFile(id); if (!existsSync(f)) return null; try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }
function writeSession(s) { ensureDir(REASON_DIR); writeFileSync(sessionFile(s.session_id), JSON.stringify(s, null, 2) + "\n", "utf8"); }

// ── reason.start ──────────────────────────────────────────────────────────────
function cmdReasonStart(args) {
  const task    = flag(args, "--task") ?? args.find(a => !a.startsWith("--")) ?? "(unnamed task)";
  const context = flag(args, "--context");
  const asJson  = hasFlag(args, "--json");

  const session_id = randomBytes(8).toString("hex");
  const session = {
    schema_version: "aurekai.reason.session.v1",
    session_id, task,
    created_at: now(), updated_at: now(),
    state: "open",
    steps: [],
    context: context ?? null,
    branch_of: null,
    hash: "",
  };
  session.hash = sha256str(JSON.stringify(session.steps));
  writeSession(session);

  if (asJson) printJson({ ...session, verdict: "STARTED" });
  else process.stdout.write(`reason.start  session_id: ${session_id}  task: "${task}"\n`);
  return session;
}

// ── reason.branch ─────────────────────────────────────────────────────────────
function cmdReasonBranch(args) {
  const fromId  = flag(args, "--from") ?? args.find(a => !a.startsWith("--"));
  const label   = flag(args, "--label") ?? "branch";
  const type    = flag(args, "--type") ?? "reason";
  const asJson  = hasFlag(args, "--json");
  if (!fromId) { console.error("  error: reason branch requires --from <session_id>"); process.exitCode = 1; return; }

  const parent = readSession(fromId);
  if (!parent) { console.error(`  error: session not found: ${fromId}`); process.exitCode = 1; return; }

  const branch_id = randomBytes(8).toString("hex");
  const branch = { ...parent, session_id: branch_id, created_at: now(), updated_at: now(), state: "open", steps: [...parent.steps], branch_of: fromId, type, label };
  branch.hash = sha256str(JSON.stringify(branch.steps));
  writeSession(branch);

  if (asJson) printJson({ ...branch, verdict: "BRANCHED" });
  else process.stdout.write(`reason.branch  new_id: ${branch_id}  from: ${fromId}  label: ${label}\n`);
  return branch;
}

// ── reason.run ────────────────────────────────────────────────────────────────
function cmdReasonRun(args) {
  const sessionId = flag(args, "--session") ?? flag(args, "--id") ?? args.find(a => !a.startsWith("--"));
  const step      = flag(args, "--step") ?? flag(args, "--thought");
  const evidence  = flag(args, "--evidence");
  const asJson    = hasFlag(args, "--json");
  if (!sessionId) { console.error("  error: reason run requires --session <id>"); process.exitCode = 1; return; }
  if (!step) { console.error("  error: reason run requires --step <reasoning-step-text>"); process.exitCode = 1; return; }

  const session = readSession(sessionId);
  if (!session) { console.error(`  error: session not found: ${sessionId}`); process.exitCode = 1; return; }

  const step_id = session.steps.length + 1;
  const entry = { step_id, thought: step, evidence: evidence ?? null, recorded_at: now(), step_hash: sha256str(step) };
  session.steps.push(entry);
  session.hash = sha256str(JSON.stringify(session.steps));
  session.updated_at = now();
  writeSession(session);

  const result = { schema_version: "aurekai.reason.run.v1", session_id: sessionId, step_id, step_hash: entry.step_hash, total_steps: session.steps.length, verdict: "RECORDED" };
  if (asJson) printJson(result);
  else process.stdout.write(`reason.run  session: ${sessionId}  step: ${step_id}  hash: ${entry.step_hash.slice(0, 12)}\n`);
  return result;
}

// ── reason.diff ───────────────────────────────────────────────────────────────
function cmdReasonDiff(args) {
  const aId    = flag(args, "--a");
  const bId    = flag(args, "--b");
  const asJson = hasFlag(args, "--json");
  if (!aId || !bId) { console.error("  error: reason diff requires --a <id> --b <id>"); process.exitCode = 1; return; }

  const a = readSession(aId), b = readSession(bId);
  if (!a) { console.error(`  error: session not found: ${aId}`); process.exitCode = 1; return; }
  if (!b) { console.error(`  error: session not found: ${bId}`); process.exitCode = 1; return; }

  const aHashes = new Set(a.steps.map(s => s.step_hash));
  const bHashes = new Set(b.steps.map(s => s.step_hash));
  const only_in_a = a.steps.filter(s => !bHashes.has(s.step_hash)).map(s => ({ step_id: s.step_id, thought: s.thought.slice(0, 80), hash: s.step_hash }));
  const only_in_b = b.steps.filter(s => !aHashes.has(s.step_hash)).map(s => ({ step_id: s.step_id, thought: s.thought.slice(0, 80), hash: s.step_hash }));
  const shared = a.steps.filter(s => bHashes.has(s.step_hash)).length;

  const result = { schema_version: "aurekai.reason.diff.v1", diffed_at: now(), session_a: aId, session_b: bId, steps_a: a.steps.length, steps_b: b.steps.length, shared_steps: shared, only_in_a, only_in_b, hash_match: a.hash === b.hash, verdict: a.hash === b.hash ? "IDENTICAL" : "DIVERGED" };
  if (asJson) printJson(result);
  else { process.stdout.write(`reason.diff  ${aId} ↔ ${bId}  verdict: ${result.verdict}\n`); process.stdout.write(`  shared: ${shared}  only_a: ${only_in_a.length}  only_b: ${only_in_b.length}\n`); }
  return result;
}

// ── reason.rebase ─────────────────────────────────────────────────────────────
function cmdReasonRebase(args) {
  const sessionId = flag(args, "--session") ?? flag(args, "--id");
  const ontoId    = flag(args, "--onto");
  const asJson    = hasFlag(args, "--json");
  if (!sessionId || !ontoId) { console.error("  error: reason rebase requires --session <id> --onto <id>"); process.exitCode = 1; return; }

  const session = readSession(sessionId), onto = readSession(ontoId);
  if (!session) { console.error(`  error: session not found: ${sessionId}`); process.exitCode = 1; return; }
  if (!onto) { console.error(`  error: base session not found: ${ontoId}`); process.exitCode = 1; return; }

  const ontoHashes = new Set(onto.steps.map(s => s.step_hash));
  const unique = session.steps.filter(s => !ontoHashes.has(s.step_hash));
  const rebased_id = randomBytes(8).toString("hex");
  const rebased = { ...onto, session_id: rebased_id, created_at: now(), updated_at: now(), state: "open", steps: [...onto.steps, ...unique], branch_of: ontoId, rebased_from: sessionId };
  rebased.hash = sha256str(JSON.stringify(rebased.steps));
  writeSession(rebased);

  const result = { schema_version: "aurekai.reason.rebase.v1", rebased_at: now(), new_session_id: rebased_id, from: sessionId, onto: ontoId, base_steps: onto.steps.length, appended_steps: unique.length, total_steps: rebased.steps.length, verdict: "REBASED" };
  if (asJson) printJson(result);
  else process.stdout.write(`reason.rebase  new_id: ${rebased_id}  from: ${sessionId}  onto: ${ontoId}  appended: ${unique.length} steps\n`);
  return result;
}

// ── flow.branch (alias of reason.branch with type=flow) ───────────────────────
function cmdFlowBranch(args) {
  return cmdReasonBranch(["--type", "flow", ...args]);
}

// ── learn.feedback ────────────────────────────────────────────────────────────
function cmdLearnFeedback(args) {
  const input  = flag(args, "--input") ?? flag(args, "--in");
  const label  = flag(args, "--label");
  const model  = flag(args, "--model") ?? "default";
  const score  = flag(args, "--score");
  const asJson = hasFlag(args, "--json");
  if (!input || !label) { console.error("  error: learn feedback requires --input <text> --label <label>"); process.exitCode = 1; return; }

  ensureDir(FEEDBACK_DIR);
  const entry = { schema_version: "aurekai.feedback.v1", recorded_at: now(), model, input, label, score: score ? parseFloat(score) : null, input_hash: sha256str(input) };
  const feedbackFile = join(FEEDBACK_DIR, `${model}.jsonl`);
  appendFileSync(feedbackFile, JSON.stringify(entry) + "\n", "utf8");

  const result = { ...entry, verdict: "RECORDED" };
  if (asJson) printJson(result);
  else process.stdout.write(`feedback recorded  model: ${model}  label: ${label}  hash: ${entry.input_hash.slice(0, 12)}\n`);
  return result;
}

// ── learn.tune ────────────────────────────────────────────────────────────────
function cmdLearnTune(args) {
  const model   = flag(args, "--model") ?? "default";
  const epochs  = parseInt(flag(args, "--epochs") ?? "1", 10);
  const asJson  = hasFlag(args, "--json");

  const feedbackFile = join(FEEDBACK_DIR, `${model}.jsonl`);
  if (!existsSync(feedbackFile)) {
    const r = { schema_version: "aurekai.tune.v1", model, verdict: "NO_FEEDBACK", note: "Record feedback with 'akai learn feedback' before tuning." };
    if (asJson) printJson(r); else process.stdout.write(`  learn.tune: no feedback found for model '${model}'\n`);
    return r;
  }

  const entries = readFileSync(feedbackFile, "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const labelCounts = {};
  for (const e of entries) labelCounts[e.label] = (labelCounts[e.label] || 0) + 1;
  const avgScore = entries.filter(e => e.score != null).reduce((s, e, _, a) => s + e.score / a.length, 0);

  const tune_record = { schema_version: "aurekai.tune.v1", tuned_at: now(), model, epochs, feedback_count: entries.length, label_distribution: labelCounts, avg_score: parseFloat(avgScore.toFixed(4)), verdict: "TUNE_RECORD_CREATED", note: "Local tuning record only — actual weight update requires a training backend." };
  writeFileSync(join(FEEDBACK_DIR, `${model}.tune.json`), JSON.stringify(tune_record, null, 2) + "\n", "utf8");

  if (asJson) printJson(tune_record);
  else { process.stdout.write(`learn.tune  model: ${model}  feedback: ${entries.length}  labels: ${Object.keys(labelCounts).join(", ")}\n`); process.stdout.write(`  ${tune_record.note}\n`); }
  return tune_record;
}

// ── physics state helpers ─────────────────────────────────────────────────────
function physicsFile(id) { return join(PHYSICS_DIR, `${id}.physics.json`); }
function readPhysics(id) { const f = physicsFile(id); if (!existsSync(f)) return null; try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }
function writePhysics(s) { ensureDir(PHYSICS_DIR); writeFileSync(physicsFile(s.state_id), JSON.stringify(s, null, 2) + "\n", "utf8"); }

// ── physics.init ──────────────────────────────────────────────────────────────
function cmdPhysicsInit(args) {
  const mass  = parseFloat(flag(args, "--mass") ?? "1");
  const px    = parseFloat(flag(args, "--x") ?? "0");
  const py    = parseFloat(flag(args, "--y") ?? "0");
  const pz    = parseFloat(flag(args, "--z") ?? "0");
  const dt    = parseFloat(flag(args, "--dt") ?? "0.01");
  const asJson = hasFlag(args, "--json");

  const state_id = randomBytes(8).toString("hex");
  const state = { schema_version: "aurekai.physics.state.v1", state_id, created_at: now(), updated_at: now(), t: 0, dt, mass, position: { x: px, y: py, z: pz }, velocity: { x: 0, y: 0, z: 0 }, acceleration: { x: 0, y: 0, z: 0 }, forces: [], step_count: 0 };
  writePhysics(state);

  if (asJson) printJson({ ...state, verdict: "INITIALIZED" });
  else process.stdout.write(`physics.init  state_id: ${state_id}  mass: ${mass}  pos: (${px},${py},${pz})\n`);
  return state;
}

// ── physics.kick ──────────────────────────────────────────────────────────────
function cmdPhysicsKick(args) {
  const id   = flag(args, "--id") ?? args.find(a => !a.startsWith("--"));
  const fx   = parseFloat(flag(args, "--fx") ?? "0");
  const fy   = parseFloat(flag(args, "--fy") ?? "0");
  const fz   = parseFloat(flag(args, "--fz") ?? "0");
  const asJson = hasFlag(args, "--json");
  if (!id) { console.error("  error: physics kick requires --id <state_id>"); process.exitCode = 1; return; }

  const state = readPhysics(id);
  if (!state) { console.error(`  error: physics state not found: ${id}`); process.exitCode = 1; return; }

  state.forces.push({ fx, fy, fz, applied_at: now() });
  // net acceleration = sum(forces) / mass
  const sumFx = state.forces.reduce((s, f) => s + f.fx, 0);
  const sumFy = state.forces.reduce((s, f) => s + f.fy, 0);
  const sumFz = state.forces.reduce((s, f) => s + f.fz, 0);
  state.acceleration = { x: sumFx / state.mass, y: sumFy / state.mass, z: sumFz / state.mass };
  state.updated_at = now();
  writePhysics(state);

  const result = { schema_version: "aurekai.physics.kick.v1", state_id: id, force: { fx, fy, fz }, acceleration: state.acceleration, verdict: "FORCE_APPLIED" };
  if (asJson) printJson(result);
  else process.stdout.write(`physics.kick  a=(${state.acceleration.x.toFixed(4)},${state.acceleration.y.toFixed(4)},${state.acceleration.z.toFixed(4)})\n`);
  return result;
}

// ── physics.run ───────────────────────────────────────────────────────────────
function cmdPhysicsRun(args) {
  const id     = flag(args, "--id") ?? args.find(a => !a.startsWith("--"));
  const steps  = parseInt(flag(args, "--steps") ?? "10", 10);
  const asJson = hasFlag(args, "--json");
  if (!id) { console.error("  error: physics run requires --id <state_id>"); process.exitCode = 1; return; }

  const state = readPhysics(id);
  if (!state) { console.error(`  error: physics state not found: ${id}`); process.exitCode = 1; return; }

  // Euler integration: v += a*dt, p += v*dt
  for (let i = 0; i < steps; i++) {
    state.velocity.x += state.acceleration.x * state.dt;
    state.velocity.y += state.acceleration.y * state.dt;
    state.velocity.z += state.acceleration.z * state.dt;
    state.position.x += state.velocity.x * state.dt;
    state.position.y += state.velocity.y * state.dt;
    state.position.z += state.velocity.z * state.dt;
    state.t += state.dt;
    state.step_count++;
  }
  state.updated_at = now();
  writePhysics(state);

  const result = { schema_version: "aurekai.physics.run.v1", state_id: id, steps_run: steps, t: state.t, position: state.position, velocity: state.velocity, verdict: "ADVANCED" };
  if (asJson) printJson(result);
  else process.stdout.write(`physics.run  t=${state.t.toFixed(4)}  pos=(${state.position.x.toFixed(4)},${state.position.y.toFixed(4)},${state.position.z.toFixed(4)})\n`);
  return result;
}

// ── physics.diff ──────────────────────────────────────────────────────────────
function cmdPhysicsDiff(args) {
  const aId    = flag(args, "--a");
  const bId    = flag(args, "--b");
  const asJson = hasFlag(args, "--json");
  if (!aId || !bId) { console.error("  error: physics diff requires --a <id> --b <id>"); process.exitCode = 1; return; }

  const a = readPhysics(aId), b = readPhysics(bId);
  if (!a || !b) { console.error("  error: one or both physics states not found"); process.exitCode = 1; return; }

  const delta_pos = { x: b.position.x - a.position.x, y: b.position.y - a.position.y, z: b.position.z - a.position.z };
  const delta_vel = { x: b.velocity.x - a.velocity.x, y: b.velocity.y - a.velocity.y, z: b.velocity.z - a.velocity.z };
  const result = { schema_version: "aurekai.physics.diff.v1", diffed_at: now(), state_a: aId, state_b: bId, delta_position: delta_pos, delta_velocity: delta_vel, delta_t: b.t - a.t, verdict: "DIFFED" };
  if (asJson) printJson(result);
  else process.stdout.write(`physics.diff  Δpos=(${delta_pos.x.toFixed(4)},${delta_pos.y.toFixed(4)},${delta_pos.z.toFixed(4)})  Δt=${result.delta_t.toFixed(4)}\n`);
  return result;
}

export async function reasonCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "start":    cmdReasonStart(rest);    break;
    case "branch":   cmdReasonBranch(rest);   break;
    case "run":      cmdReasonRun(rest);      break;
    case "diff":     cmdReasonDiff(rest);     break;
    case "rebase":   cmdReasonRebase(rest);   break;
    default:
      console.error(`  error: unknown reason subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export async function flowCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  if (sub === "branch") { cmdFlowBranch(rest); } else { console.error(`  error: unknown flow subcommand '${sub ?? "(none)"}'.`); process.exitCode = 1; }
}

export async function learnCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "feedback": cmdLearnFeedback(rest); break;
    case "tune":     cmdLearnTune(rest);     break;
    default:
      console.error(`  error: unknown learn subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export async function physicsCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "init":  cmdPhysicsInit(rest);  break;
    case "kick":  cmdPhysicsKick(rest);  break;
    case "run":   cmdPhysicsRun(rest);   break;
    case "diff":  cmdPhysicsDiff(rest);  break;
    default:
      console.error(`  error: unknown physics subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export { cmdReasonStart, cmdReasonBranch, cmdReasonRun, cmdReasonDiff, cmdReasonRebase,
         cmdFlowBranch, cmdLearnFeedback, cmdLearnTune,
         cmdPhysicsInit, cmdPhysicsKick, cmdPhysicsRun, cmdPhysicsDiff };
