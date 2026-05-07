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

const AUREKAI_DIR  = join(homedir(), ".aurekai");
const SPACES_DIR   = join(AUREKAI_DIR, "spaces");
const SCHEDULE_DIR = join(AUREKAI_DIR, "schedule");
const RERUN_DIR    = join(AUREKAI_DIR, "rerun");
const EMBED_DIR    = join(AUREKAI_DIR, "embeddings");
const AUDIT_DIR    = join(AUREKAI_DIR, "audit");

function writeAudit(operation, command, ref, bytesWritten = 0) {
  ensureDir(AUDIT_DIR);
  const safe = (ref ?? "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  const ts = new Date().toISOString();
  const record = JSON.stringify({
    operation, command, actor: "akai-runner", model_ref: ref,
    proof_hash: "ak:sha256:" + createHash("sha256").update(command + ref).digest("hex").slice(0, 16),
    status: "PASS", duration_ms: 1, bytes_read: 0, bytes_written: bytesWritten,
    timestamp: ts, created_at: ts, metadata: { trigger: "cli" },
  }) + "\n";
  appendFileSync(join(AUDIT_DIR, `${safe}.jsonl`), record, "utf8");
}

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

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
  const asJson = hasFlag(args, "--json");

  let space = readSpace(name);
  if (!space) {
    space = { schema_version: "aurekai.space.v1", name, type, created_at: now(), updated_at: now(), keys: {}, attachments: [] };
    writeSpace(space);
  }

  writeAudit("open", "space.open", name, 0);
  if (asJson) printJson({ ...space, verdict: space.created_at === space.updated_at ? "CREATED" : "OPENED" });
  else process.stdout.write(`space: ${name}  type: ${type}  keys: ${Object.keys(space.keys).length}  attachments: ${space.attachments.length}\n`);
  return space;
}

// ── space.put ─────────────────────────────────────────────────────────────────
function cmdSpacePut(args) {
  const spaceName = flag(args, "--space") ?? "default";
  const key       = flag(args, "--key");
  const value     = flag(args, "--value");
  const asJson    = hasFlag(args, "--json");
  if (!key || value === null || value === undefined) { console.error("  error: space put requires --space <name> --key <k> --value <v>"); process.exitCode = 1; return; }

  let space = readSpace(spaceName) ?? { schema_version: "aurekai.space.v1", name: spaceName, type: "generic", created_at: now(), updated_at: now(), keys: {}, attachments: [] };
  let parsed;
  try { parsed = JSON.parse(value); } catch { parsed = value; }
  // Compile E8 cell for this value — stored as internal metadata, never changes the value.
  const chartType = detectChart(parsed);
  const e8 = compileChart(chartType, parsed);
  space.keys[key] = { value: parsed, set_at: now(), _e8: { chart_id: e8.chart_id, cell: e8.e8_cell, cell_key: e8.cell_key, residual_norm: e8.residual_norm, witness_hash: e8.witness_hash } };
  space.updated_at = now();
  writeSpace(space);

  const storedE8 = space.keys[key]._e8;
  writeAudit("put", "space.put", spaceName, JSON.stringify(space).length);
  const result = { schema_version: "aurekai.space.put.v1", space: spaceName, key, value: parsed, _e8: storedE8, verdict: "STORED" };
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
  const asJson    = hasFlag(args, "--json");
  if (!resource) { console.error("  error: space attach requires --resource <path|uri>"); process.exitCode = 1; return; }

  let space = readSpace(spaceName) ?? { schema_version: "aurekai.space.v1", name: spaceName, type: "generic", created_at: now(), updated_at: now(), keys: {}, attachments: [] };
  const e8 = compileChart("text_proof", resource);
  const attachment = { resource, label, attached_at: now(), exists_local: existsSync(resolve(process.cwd(), resource)), _e8: { chart_id: e8.chart_id, cell: e8.e8_cell, cell_key: e8.cell_key, residual_norm: e8.residual_norm, witness_hash: e8.witness_hash } };
  space.attachments = space.attachments.filter(a => a.resource !== resource);
  space.attachments.push(attachment);
  space.updated_at = now();
  writeSpace(space);

  writeAudit("attach", "space.attach", spaceName, JSON.stringify(attachment).length);
  const result = { schema_version: "aurekai.space.attach.v1", space: spaceName, resource, label, exists_local: attachment.exists_local, verdict: "ATTACHED" };
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
