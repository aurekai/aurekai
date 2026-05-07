/**
 * src/space.mjs
 *
 * Native substrate/space operations:
 *   space.open    — open/create a named local namespace
 *   space.put     — put a key/value pair into a space
 *   space.attach  — attach a resource path to a space
 *   time.schedule — schedule a future task (local queue + metadata)
 *   time.rerun    — rerun a previously recorded task
 *   vec.search    — cosine similarity search over a stored embedding set
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { compile as compileChart, detectChart } from "./chart-compiler.mjs";
import { e8NeighborScore } from "./e8-lattice.mjs";
import { buildCommittedState, buildTransitionRecord, deriveCommitmentSalt, evaluateContinuityPolicy, hashValue } from "./state-continuity.mjs";

const AUREKAI_DIR  = join(homedir(), ".aurekai");
const SPACES_DIR   = join(AUREKAI_DIR, "spaces");
const SCHEDULE_DIR = join(AUREKAI_DIR, "schedule");
const RERUN_DIR    = join(AUREKAI_DIR, "rerun");
const EMBED_DIR    = join(AUREKAI_DIR, "embeddings");
const AUDIT_DIR    = join(AUREKAI_DIR, "audit");

function writeAudit(operation, command, ref, bytesWritten = 0, metadata = {}, status = "PASS") {
  ensureDir(AUDIT_DIR);
  const safe = (ref ?? "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  const ts = new Date().toISOString();
  const promoted = {
    state_commitment: metadata.state_commitment ?? null,
    prior_commitment: metadata.prior_commitment ?? null,
    transition_type: metadata.transition_type ?? null,
    continuity_relation: metadata.continuity_relation ?? null,
    continuity_class: metadata.continuity_class ?? null,
    continuity_verdict: metadata.continuity_verdict ?? null,
    opening_policy: metadata.opening_policy ?? null,
    residual_delta: metadata.residual_delta ?? null,
    transition_witness: metadata.transition_witness ?? null,
  };
  const record = JSON.stringify({
    operation, command, actor: "akai-runner", model_ref: ref,
    proof_hash: "ak:sha256:" + createHash("sha256").update(command + ref).digest("hex").slice(0, 16),
    status, duration_ms: 1, bytes_read: 0, bytes_written: bytesWritten,
    ...promoted,
    timestamp: ts, created_at: ts, metadata: { trigger: "cli", ...metadata },
  }) + "\n";
  appendFileSync(join(AUDIT_DIR, `${safe}.jsonl`), record, "utf8");
}

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function printSpaceHelp() {
  process.stdout.write("Usage:\n");
  process.stdout.write("  akai space open   --name <space> [--type <kind>] [--opening-policy <public|commit-only|partial-open|private>] [--continuity-policy <default|strict|handoff>] [--json]\n");
  process.stdout.write("  akai space put    --space <name> --key <k> --value <v> [--opening-policy <public|commit-only|partial-open|private>] [--continuity-policy <default|strict|handoff>] [--json]\n");
  process.stdout.write("  akai space attach --space <name> --resource <path|uri> [--label <text>] [--opening-policy <public|commit-only|partial-open|private>] [--continuity-policy <default|strict|handoff>] [--json]\n");
  process.stdout.write("  akai space schedule --task <text> [--at <iso>|--delay-seconds <N>] [--json]\n");
  process.stdout.write("  akai space rerun --id <schedule_id> [--json]\n");
  process.stdout.write("  akai space search --query <text> [--store <dir>] [--top-k <N>] [--json]\n");
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createEmptySpace(name, type = "generic", openingPolicy = "commit-only", continuityPolicy = "default") {
  const ts = now();
  return {
    schema_version: "aurekai.space.v1",
    name,
    type,
    created_at: ts,
    updated_at: ts,
    keys: {},
    attachments: [],
    _state: {
      schema_version: "aurekai.space.state.v1",
      state_type: "space.state",
      opening_policy: openingPolicy,
      continuity_policy: continuityPolicy,
      commitment_salt: randomBytes(16).toString("hex"),
    },
  };
}

function normalizeSpace(space, name, type = "generic", openingPolicy = "commit-only", continuityPolicy = "default") {
  const normalized = space ?? createEmptySpace(name, type, openingPolicy, continuityPolicy);
  normalized.schema_version = normalized.schema_version ?? "aurekai.space.v1";
  normalized.name = normalized.name ?? name;
  normalized.type = normalized.type ?? type;
  normalized.created_at = normalized.created_at ?? now();
  normalized.updated_at = normalized.updated_at ?? normalized.created_at;
  normalized.keys = normalized.keys ?? {};
  normalized.attachments = normalized.attachments ?? [];
  normalized._state = normalized._state ?? { schema_version: "aurekai.space.state.v1" };
  normalized._state.schema_version = normalized._state.schema_version ?? "aurekai.space.state.v1";
  normalized._state.state_type = normalized._state.state_type ?? "space.state";
  normalized._state.opening_policy = normalized._state.opening_policy ?? openingPolicy;
  normalized._state.continuity_policy = normalized._state.continuity_policy ?? continuityPolicy;
  normalized._state.commitment_salt = normalized._state.commitment_salt ?? randomBytes(16).toString("hex");
  return normalized;
}

function describeStoredState(entry) {
  if (!entry?._continuity) return null;
  return {
    state_type: entry._continuity.state_type,
    state_commitment: entry._continuity.state_commitment,
    chart_id: entry._continuity.chart_id,
    cell: entry._continuity.cell,
    cell_key: entry._continuity.cell_key,
    residual_norm: entry._continuity.residual_norm,
    residual_class: entry._continuity.residual_class,
    witness_hash: entry._continuity.witness_hash,
  };
}

function summarizeSpace(space) {
  return {
    name: space.name,
    type: space.type,
    key_count: Object.keys(space.keys ?? {}).length,
    attachment_count: (space.attachments ?? []).length,
    keys: Object.entries(space.keys ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({
        key,
        state_commitment: value?._continuity?.state_commitment ?? null,
        payload_hash: value?._continuity?.payload_hash ?? hashValue(value?.value ?? null),
        chart_id: value?._e8?.chart_id ?? null,
        cell_key: value?._e8?.cell_key ?? null,
        residual_norm: value?._e8?.residual_norm ?? null,
      })),
    attachments: (space.attachments ?? [])
      .slice()
      .sort((left, right) => String(left.label ?? left.resource).localeCompare(String(right.label ?? right.resource)))
      .map(value => ({
        resource: value.resource,
        label: value.label,
        state_commitment: value?._continuity?.state_commitment ?? null,
        payload_hash: value?._continuity?.payload_hash ?? hashValue({ resource: value.resource, label: value.label }),
        chart_id: value?._e8?.chart_id ?? null,
        cell_key: value?._e8?.cell_key ?? null,
        residual_norm: value?._e8?.residual_norm ?? null,
      })),
  };
}

function buildSpaceDescriptor(space, openingPolicy, commitmentSalt) {
  return buildCommittedState({
    stateType: "space.state",
    payload: summarizeSpace(space),
    chartType: "generic",
    openingPolicy,
    commitmentSalt,
    publicFields: { space: space.name, type: space.type },
  });
}

function continuityStatus(verdict) {
  if (verdict === "CONTINUITY_FAIL") return "FAIL";
  if (verdict === "PASS_WITH_DRIFT" || verdict === "BOUNDARY_CROSSING") return "WARN";
  return "PASS";
}

function finalizeSpaceState(space, previousSpace, transitionType, metadata = {}, continuityPolicy = null) {
  const openingPolicy = space._state?.opening_policy ?? "commit-only";
  const policyName = continuityPolicy ?? space._state?.continuity_policy ?? "default";
  const commitmentSalt = space._state?.commitment_salt ?? randomBytes(16).toString("hex");
  const nextState = buildSpaceDescriptor(space, openingPolicy, commitmentSalt);
  const previousState = previousSpace
    ? (previousSpace._state?.state_commitment ? describeStoredState({ _continuity: previousSpace._state }) : buildSpaceDescriptor(previousSpace, openingPolicy, commitmentSalt))
    : null;
  const transition = buildTransitionRecord({
    transitionType,
    previousState,
    nextState,
    openingPolicy,
    metadata: { space: space.name, ...metadata },
  });
  const policyEval = evaluateContinuityPolicy(transition, policyName);

  space._state = {
    schema_version: "aurekai.space.state.v1",
    state_type: nextState.state_type,
    commitment_salt: commitmentSalt,
    opening_policy: openingPolicy,
    state_commitment: nextState.state_commitment,
    prior_commitment: transition.prior_commitment,
    cell_commitment: nextState.cell_commitment,
    chart_id: nextState.chart_id,
    cell: nextState.cell,
    cell_key: nextState.cell_key,
    residual_norm: nextState.residual_norm,
    residual_class: nextState.residual_class,
    witness_hash: nextState.witness_hash,
    payload_hash: nextState.payload_hash,
    transition_type: transition.transition_type,
    residual_delta: transition.residual_delta,
    invariants_checked: transition.invariants_checked,
    continuity_class: transition.continuity_class,
    continuity_policy: policyEval.policy_id,
    continuity_verdict: policyEval.continuity_verdict,
    continuity_violations: policyEval.violations,
  };

  return { nextState, transition, policyEval, status: continuityStatus(policyEval.continuity_verdict) };
}

function spaceFile(name) { return join(SPACES_DIR, `${name}.space.json`); }
function readSpace(name) {
  const f = spaceFile(name);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}
function writeSpace(space) { ensureDir(SPACES_DIR); writeFileSync(spaceFile(space.name), JSON.stringify(space, null, 2) + "\n", "utf8"); }

// ── space.open ────────────────────────────────────────────────────────────────
function cmdSpaceOpen(args) {
  const name   = flag(args, "--name") ?? args.find(a => !a.startsWith("--")) ?? `space-${randomBytes(4).toString("hex")}`;
  const type   = flag(args, "--type") ?? "generic";
  const openingPolicy = flag(args, "--opening-policy") ?? "commit-only";
  const continuityPolicy = flag(args, "--continuity-policy") ?? "default";
  const asJson = hasFlag(args, "--json");

  const previousSpaceRaw = readSpace(name);
  const previousSpace = previousSpaceRaw ? normalizeSpace(cloneJson(previousSpaceRaw), name, type, openingPolicy, continuityPolicy) : null;
  const existed = Boolean(previousSpace);
  const space = normalizeSpace(cloneJson(previousSpaceRaw), name, type, openingPolicy, continuityPolicy);
  const { transition, policyEval, status } = finalizeSpaceState(space, previousSpace, existed ? "space.open" : "space.open.create", { created: !existed }, continuityPolicy);
  writeSpace(space);

  writeAudit("open", "space.open", name, 0, {
    state_commitment: space._state.state_commitment,
    prior_commitment: space._state.prior_commitment,
    transition_type: transition.transition_type,
    continuity_relation: transition.continuity_relation,
    continuity_class: transition.continuity_class,
    continuity_verdict: policyEval.continuity_verdict,
    opening_policy: space._state.opening_policy,
    continuity_policy: policyEval.policy_id,
    transition_witness: transition.transition_witness,
  }, status);
  if (asJson) printJson({ ...space, transition, continuity_policy: policyEval.policy_id, continuity_verdict: policyEval.continuity_verdict, continuity_violations: policyEval.violations, verdict: existed ? "OPENED" : "CREATED" });
  else process.stdout.write(`space: ${name}  type: ${type}  keys: ${Object.keys(space.keys).length}  attachments: ${space.attachments.length}\n`);
  return space;
}

// ── space.put ─────────────────────────────────────────────────────────────────
function cmdSpacePut(args) {
  const spaceName = flag(args, "--space") ?? "default";
  const key       = flag(args, "--key");
  const value     = flag(args, "--value");
  const openingPolicy = flag(args, "--opening-policy") ?? "commit-only";
  const continuityPolicy = flag(args, "--continuity-policy") ?? "default";
  const asJson    = hasFlag(args, "--json");
  if (!key || value === null || value === undefined) { console.error("  error: space put requires --space <name> --key <k> --value <v>"); process.exitCode = 1; return; }

  const previousSpaceRaw = readSpace(spaceName);
  const previousSpace = previousSpaceRaw ? normalizeSpace(cloneJson(previousSpaceRaw), spaceName, "generic", openingPolicy, continuityPolicy) : null;
  const space = normalizeSpace(cloneJson(previousSpaceRaw), spaceName, "generic", openingPolicy, continuityPolicy);
  let parsed;
  try { parsed = JSON.parse(value); } catch { parsed = value; }
  // Compile E8 cell for this value — stored as internal metadata, never changes the value.
  const chartType = detectChart(parsed);
  const e8 = compileChart(chartType, parsed);
  const priorEntry = previousSpace?.keys?.[key] ?? null;
  const commitmentSalt = deriveCommitmentSalt(space._state.commitment_salt, `key:${key}`);
  const nextDescriptor = buildCommittedState({
    stateType: "space.key",
    payload: parsed,
    chartAnnotation: e8,
    openingPolicy: space._state.opening_policy,
    commitmentSalt,
    publicFields: { space: spaceName, key },
  });
  const priorDescriptor = priorEntry ? describeStoredState(priorEntry) : null;
  const entryTransition = buildTransitionRecord({
    transitionType: priorEntry ? "space.put.update" : "space.put.create",
    previousState: priorDescriptor,
    nextState: nextDescriptor,
    openingPolicy: space._state.opening_policy,
    metadata: { space: spaceName, key },
  });

  space.keys[key] = {
    value: parsed,
    set_at: now(),
    _e8: { chart_id: e8.chart_id, cell: e8.e8_cell, cell_key: e8.cell_key, residual_norm: e8.residual_norm, witness_hash: e8.witness_hash },
    _continuity: {
      ...nextDescriptor,
      prior_commitment: entryTransition.prior_commitment,
      transition_type: entryTransition.transition_type,
      residual_delta: entryTransition.residual_delta,
      invariants_checked: entryTransition.invariants_checked,
      continuity_class: entryTransition.continuity_class,
    },
  };
  space.updated_at = now();
  const { transition, policyEval, status } = finalizeSpaceState(space, previousSpace, entryTransition.transition_type, { key }, continuityPolicy);
  writeSpace(space);

  const storedE8 = space.keys[key]._e8;
  writeAudit("put", "space.put", spaceName, JSON.stringify(space).length, {
    key,
    state_commitment: nextDescriptor.state_commitment,
    prior_commitment: entryTransition.prior_commitment,
    space_commitment: space._state.state_commitment,
    transition_type: entryTransition.transition_type,
    continuity_relation: entryTransition.continuity_relation,
    continuity_class: entryTransition.continuity_class,
    continuity_verdict: policyEval.continuity_verdict,
    opening_policy: nextDescriptor.opening_policy,
    continuity_policy: policyEval.policy_id,
    residual_delta: entryTransition.residual_delta,
    transition_witness: entryTransition.transition_witness,
  }, status);
  const result = {
    schema_version: "aurekai.space.put.v1",
    space: spaceName,
    key,
    value: parsed,
    _e8: storedE8,
    state_commitment: nextDescriptor.state_commitment,
    prior_commitment: entryTransition.prior_commitment,
    chart_id: nextDescriptor.chart_id,
    cell_key: nextDescriptor.cell_key,
    residual_norm: nextDescriptor.residual_norm,
    residual_delta: entryTransition.residual_delta,
    continuity_class: entryTransition.continuity_class,
    continuity_relation: entryTransition.continuity_relation,
    invariants_checked: entryTransition.invariants_checked,
    transition_type: entryTransition.transition_type,
    transition_witness: entryTransition.transition_witness,
    witnesses: entryTransition.witnesses,
    opening_policy: nextDescriptor.opening_policy,
    continuity_policy: policyEval.policy_id,
    continuity_verdict: policyEval.continuity_verdict,
    continuity_violations: policyEval.violations,
    transition,
    verdict: "STORED",
  };
  if (asJson) printJson(result);
  else process.stdout.write(`space.put  ${spaceName}.${key} = ${JSON.stringify(parsed)}\n`);
  return result;
}

// ── space.attach ──────────────────────────────────────────────────────────────
function cmdSpaceAttach(args) {
  const spaceName = flag(args, "--space") ?? "default";
  // Do NOT use positional fallback — it picks up flag values like the space name.
  const resource  = flag(args, "--resource");
  const label     = flag(args, "--label") ?? resource;
  const openingPolicy = flag(args, "--opening-policy") ?? "commit-only";
  const continuityPolicy = flag(args, "--continuity-policy") ?? "default";
  const asJson    = hasFlag(args, "--json");
  if (!resource) { console.error("  error: space attach requires --resource <path|uri>"); process.exitCode = 1; return; }

  const previousSpaceRaw = readSpace(spaceName);
  const previousSpace = previousSpaceRaw ? normalizeSpace(cloneJson(previousSpaceRaw), spaceName, "generic", openingPolicy, continuityPolicy) : null;
  const space = normalizeSpace(cloneJson(previousSpaceRaw), spaceName, "generic", openingPolicy, continuityPolicy);
  const e8 = compileChart("text_proof", resource);
  const priorAttachment = previousSpace?.attachments?.find(entry => entry.resource === resource) ?? null;
  const attachmentPayload = { resource, label, exists_local: existsSync(resolve(process.cwd(), resource)) };
  const nextDescriptor = buildCommittedState({
    stateType: "space.attachment",
    payload: attachmentPayload,
    chartAnnotation: e8,
    openingPolicy: space._state.opening_policy,
    commitmentSalt: deriveCommitmentSalt(space._state.commitment_salt, `attachment:${resource}`),
    publicFields: { space: spaceName, label },
  });
  const priorDescriptor = priorAttachment ? describeStoredState(priorAttachment) : null;
  const attachmentTransition = buildTransitionRecord({
    transitionType: priorAttachment ? "space.attach.update" : "space.attach.create",
    previousState: priorDescriptor,
    nextState: nextDescriptor,
    openingPolicy: space._state.opening_policy,
    metadata: { space: spaceName, resource, label },
  });
  const attachment = {
    resource,
    label,
    attached_at: now(),
    exists_local: attachmentPayload.exists_local,
    _e8: { chart_id: e8.chart_id, cell: e8.e8_cell, cell_key: e8.cell_key, residual_norm: e8.residual_norm, witness_hash: e8.witness_hash },
    _continuity: {
      ...nextDescriptor,
      prior_commitment: attachmentTransition.prior_commitment,
      transition_type: attachmentTransition.transition_type,
      residual_delta: attachmentTransition.residual_delta,
      invariants_checked: attachmentTransition.invariants_checked,
      continuity_class: attachmentTransition.continuity_class,
    },
  };
  space.attachments = space.attachments.filter(a => a.resource !== resource);
  space.attachments.push(attachment);
  space.updated_at = now();
  const { transition, policyEval, status } = finalizeSpaceState(space, previousSpace, attachmentTransition.transition_type, { resource, label }, continuityPolicy);
  writeSpace(space);

  writeAudit("attach", "space.attach", spaceName, JSON.stringify(attachment).length, {
    resource,
    label,
    state_commitment: nextDescriptor.state_commitment,
    prior_commitment: attachmentTransition.prior_commitment,
    space_commitment: space._state.state_commitment,
    transition_type: attachmentTransition.transition_type,
    continuity_relation: attachmentTransition.continuity_relation,
    continuity_class: attachmentTransition.continuity_class,
    continuity_verdict: policyEval.continuity_verdict,
    opening_policy: nextDescriptor.opening_policy,
    continuity_policy: policyEval.policy_id,
    residual_delta: attachmentTransition.residual_delta,
    transition_witness: attachmentTransition.transition_witness,
  }, status);
  const result = {
    schema_version: "aurekai.space.attach.v1",
    space: spaceName,
    resource,
    label,
    exists_local: attachment.exists_local,
    state_commitment: nextDescriptor.state_commitment,
    prior_commitment: attachmentTransition.prior_commitment,
    chart_id: nextDescriptor.chart_id,
    cell_key: nextDescriptor.cell_key,
    residual_norm: nextDescriptor.residual_norm,
    residual_delta: attachmentTransition.residual_delta,
    continuity_class: attachmentTransition.continuity_class,
    continuity_relation: attachmentTransition.continuity_relation,
    invariants_checked: attachmentTransition.invariants_checked,
    transition_type: attachmentTransition.transition_type,
    transition_witness: attachmentTransition.transition_witness,
    witnesses: attachmentTransition.witnesses,
    opening_policy: nextDescriptor.opening_policy,
    continuity_policy: policyEval.policy_id,
    continuity_verdict: policyEval.continuity_verdict,
    continuity_violations: policyEval.violations,
    transition,
    verdict: "ATTACHED",
  };
  if (asJson) printJson(result);
  else process.stdout.write(`space.attach  ${spaceName} ← ${resource}  label: ${label}\n`);
  return result;
}

// ── time.schedule ─────────────────────────────────────────────────────────────
function cmdTimeSchedule(args) {
  const task     = flag(args, "--task") ?? args.find(a => !a.startsWith("--")) ?? "(unnamed)";
  const runAt    = flag(args, "--at") ?? flag(args, "--run-at");
  const delay    = flag(args, "--delay-seconds");
  const asJson   = hasFlag(args, "--json");

  const now_ts  = Date.now();
  let run_at_ts = runAt ? Date.parse(runAt) : delay ? now_ts + parseInt(delay, 10) * 1000 : now_ts + 60000;
  if (isNaN(run_at_ts)) run_at_ts = now_ts + 60000;

  const schedule_id = randomBytes(8).toString("hex");
  const entry = { schema_version: "aurekai.schedule.v1", schedule_id, task, scheduled_at: now(), run_at: new Date(run_at_ts).toISOString(), state: "scheduled" };

  ensureDir(SCHEDULE_DIR);
  writeFileSync(join(SCHEDULE_DIR, `${schedule_id}.json`), JSON.stringify(entry, null, 2) + "\n", "utf8");

  const result = { ...entry, verdict: "SCHEDULED", note: "Local schedule record created. No daemon runs this automatically — use 'akai queue work --queue schedule' to poll." };
  if (asJson) printJson(result);
  else process.stdout.write(`scheduled  id: ${schedule_id}  task: ${task}  run_at: ${entry.run_at}\n`);
  return result;
}

// ── time.rerun ────────────────────────────────────────────────────────────────
function cmdTimeRerun(args) {
  const id     = flag(args, "--id") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");
  if (!id) { console.error("  error: time rerun requires --id <schedule_id|artifact_id>"); process.exitCode = 1; return; }

  const schedFile = join(SCHEDULE_DIR, `${id}.json`);
  if (!existsSync(schedFile)) { console.error(`  error: schedule not found: ${id}`); process.exitCode = 1; return; }

  const entry = JSON.parse(readFileSync(schedFile, "utf8"));
  const rerun_id = randomBytes(8).toString("hex");
  const rerun = { ...entry, schedule_id: rerun_id, original_id: id, rerun_at: now(), state: "scheduled", run_at: new Date(Date.now() + 1000).toISOString() };
  writeFileSync(join(SCHEDULE_DIR, `${rerun_id}.json`), JSON.stringify(rerun, null, 2) + "\n", "utf8");

  const result = { ...rerun, verdict: "REQUEUED" };
  if (asJson) printJson(result);
  else process.stdout.write(`rerun scheduled  new_id: ${rerun_id}  task: ${rerun.task}  run_at: ${rerun.run_at}\n`);
  return result;
}

// ── vec.search ────────────────────────────────────────────────────────────────
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function cmdVecSearch(args) {
  const query   = flag(args, "--query") ?? flag(args, "--text");
  const store   = flag(args, "--store") ?? EMBED_DIR;
  const topK    = parseInt(flag(args, "--top-k") ?? "5", 10);
  const asJson  = hasFlag(args, "--json");
  if (!query) { console.error("  error: vec search requires --query <text>"); process.exitCode = 1; return; }

  // Build query embedding (64D structural, unchanged)
  const base = createHash("sha256").update(query).digest();
  const queryVec = Array.from({ length: 64 }, (_, i) => {
    const salt = createHash("sha256").update(base).update(Buffer.from([i])).digest();
    const val = ((salt[0] << 8 | salt[1]) / 65535) * 2 - 1;
    return parseFloat(val.toFixed(6));
  });
  const qNorm = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0));
  const qNormVec = qNorm === 0 ? queryVec : queryVec.map(v => v / qNorm);

  // E8 cell for query — used in compatibility scoring when stored entry has a cell.
  const qE8 = compileChart("text_proof", query);

  // Search embedding store
  const absStore = resolve(process.cwd(), store);
  const candidates = [];
  if (existsSync(absStore)) {
    for (const f of readdirSync(absStore).filter(f => f.endsWith(".embed.json"))) {
      try {
        const e = JSON.parse(readFileSync(join(absStore, f), "utf8"));
        if (!e.vector) continue;
        const cosineSim = cosine(qNormVec, e.vector);

        // E8 compatibility bonus: if the stored entry has a cell, blend it in.
        // compatibility = 0.80 * cosine + 0.15 * e8_neighbor + 0.05 * (1 - residual_penalty)
        let score = cosineSim;
        if (e._e8?.cell) {
          const neighborScore = e8NeighborScore(qE8.e8_cell, e._e8.cell);
          const residualPenalty = Math.min(1, (e._e8.residual_norm ?? 0) / 2);
          score = 0.80 * cosineSim + 0.15 * neighborScore + 0.05 * (1 - residualPenalty);
        }
        candidates.push({
          id: e.id ?? f,
          label: e.label ?? e.text_hash,
          cosine_sim: parseFloat(cosineSim.toFixed(6)),
          score: parseFloat(score.toFixed(6)),
          e8_cell_key: e._e8?.cell_key ?? null,
        });
      } catch {}
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const results = candidates.slice(0, topK);

  const result = {
    schema_version: "aurekai.vec.search.v1",
    searched_at: now(),
    query,
    query_hash: "sha256:" + createHash("sha256").update(query).digest("hex"),
    query_e8_cell_key: qE8.cell_key,
    store: absStore,
    total_candidates: candidates.length,
    top_k: topK,
    results,
    scoring: "0.80*cosine + 0.15*e8_neighbor + 0.05*(1-residual)",
    verdict: results.length > 0 ? "FOUND" : "EMPTY_STORE",
  };
  if (asJson) printJson(result);
  else { process.stdout.write(`vec.search  candidates: ${candidates.length}  query: "${query.slice(0, 40)}"\n`); for (const r of results) process.stdout.write(`  ${r.score.toFixed(4)}  ${r.label}\n`); }
  return result;
}

export async function spaceCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printSpaceHelp();
    return;
  }
  switch (sub) {
    case "open":     cmdSpaceOpen(rest);    break;
    case "put":      cmdSpacePut(rest);     break;
    case "attach":   cmdSpaceAttach(rest);  break;
    case "schedule": cmdTimeSchedule(rest); break;
    case "rerun":    cmdTimeRerun(rest);    break;
    case "search":   cmdVecSearch(rest);    break;
    default:
      console.error(`  error: unknown space subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export { cmdSpaceOpen, cmdSpacePut, cmdSpaceAttach, cmdTimeSchedule, cmdTimeRerun, cmdVecSearch };
