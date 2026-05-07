/**
 * src/queue.mjs — queue.enqueue / queue.stats / queue.work
 *
 * Local JSONL task queue at ~/.aurekai/queue/<queue>.jsonl
 * States: pending → claimed → done | failed
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const QUEUE_DIR = join(homedir(), ".aurekai", "queue");
function ensureQueueDir() { if (!existsSync(QUEUE_DIR)) mkdirSync(QUEUE_DIR, { recursive: true }); }
function queueFile(name) { return join(QUEUE_DIR, `${name}.jsonl`); }

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

function readQueue(name) {
  const f = queueFile(name);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function writeQueue(name, entries) {
  ensureQueueDir();
  writeFileSync(queueFile(name), entries.map(e => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""), "utf8");
}

function cmdEnqueue(args) {
  const queue   = flag(args, "--queue") ?? "default";
  const taskArg = flag(args, "--task");
  const metaStr = flag(args, "--meta");
  const asJson  = hasFlag(args, "--json");

  if (!taskArg) { console.error("  error: queue enqueue requires --task <name>"); process.exitCode = 1; return; }

  let meta = null;
  if (metaStr) { try { meta = JSON.parse(metaStr); } catch { console.error("  error: --meta must be valid JSON"); process.exitCode = 1; return; } }

  const task_id = randomBytes(8).toString("hex");
  const entry = { schema_version: "aurekai.queue.task.v1", task_id, queue, task: taskArg, meta: meta ?? undefined, state: "pending", enqueued_at: now(), claimed_at: null, done_at: null };

  ensureQueueDir();
  appendFileSync(queueFile(queue), JSON.stringify(entry) + "\n", "utf8");

  if (asJson) printJson(entry);
  else process.stdout.write(`queued  ${task_id}  ${taskArg}  (queue: ${queue})\n`);
  return entry;
}

function cmdStats(args) {
  const queue  = flag(args, "--queue") ?? "default";
  const asJson = hasFlag(args, "--json");
  const entries = readQueue(queue);
  const byState = {};
  for (const e of entries) byState[e.state] = (byState[e.state] || 0) + 1;
  const result = { schema_version: "aurekai.queue.stats.v1", checked_at: now(), queue, total: entries.length, by_state: byState };
  if (asJson) printJson(result);
  else { process.stdout.write(`queue: ${queue}  total: ${entries.length}\n`); for (const [s, n] of Object.entries(byState)) process.stdout.write(`  ${s.padEnd(10)} ${n}\n`); }
  return result;
}

function cmdWork(args) {
  const queue     = flag(args, "--queue") ?? "default";
  const worker_id = flag(args, "--worker") ?? "local";
  const asJson    = hasFlag(args, "--json");
  const entries   = readQueue(queue);
  const idx       = entries.findIndex(e => e.state === "pending");

  if (idx === -1) {
    const r = { schema_version: "aurekai.queue.work.v1", queue, worker_id, task: null, verdict: "QUEUE_EMPTY" };
    if (asJson) printJson(r); else process.stdout.write(`  queue empty (${queue})\n`);
    return r;
  }

  entries[idx] = { ...entries[idx], state: "claimed", claimed_at: now(), worker_id };
  writeQueue(queue, entries);
  const task = entries[idx];
  const result = { schema_version: "aurekai.queue.work.v1", queue, worker_id, task_id: task.task_id, task: task.task, meta: task.meta, verdict: "CLAIMED" };
  if (asJson) printJson(result);
  else process.stdout.write(`claimed  ${task.task_id}  ${task.task}\n`);
  return result;
}

export async function queueCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "enqueue": cmdEnqueue(rest); break;
    case "stats":   cmdStats(rest);   break;
    case "work":    cmdWork(rest);    break;
    default:
      console.error(`  error: unknown queue subcommand '${sub ?? "(none)"}'.`);
      console.error("  Available: enqueue, stats, work");
      process.exitCode = 1;
  }
}
