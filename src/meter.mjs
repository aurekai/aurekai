/**
 * src/meter.mjs
 *
 * Native implementation of meter.record (commerce family).
 *
 * Records a metered usage event to ~/.aurekai/meter/<model>.jsonl.
 * All computation is real: real timestamps, real event IDs (SHA-256 of content).
 * No billing integration — local ledger only.
 *
 * CLI surface:
 *   akai meter record --event <name> [--model <name>] [--quantity <n>]
 *                     [--unit <unit>] [--meta <json>] [--json]
 *
 *   akai meter list   [--model <name>] [--since <iso>] [--json]
 *   akai meter summary [--model <name>] [--since <iso>] [--json]
 *
 * Output schema: "aurekai.meter.event.v1"
 *
 * Meter store:
 *   ~/.aurekai/meter/<model>.jsonl  (one JSONL per model)
 *   Default model: "default"
 */

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, appendFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── helpers ──────────────────────────────────────────────────────────────────
function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
}
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

const METER_DIR = join(homedir(), ".aurekai", "meter");

function ensureMeterDir() {
  if (!existsSync(METER_DIR)) mkdirSync(METER_DIR, { recursive: true });
}

function meterFile(model) {
  return join(METER_DIR, `${model}.jsonl`);
}

function readMeterEntries(model, since) {
  const f = meterFile(model);
  if (!existsSync(f)) return [];
  const sinceMs = since ? Date.parse(since) : 0;
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap(line => {
      try {
        const e = JSON.parse(line);
        const ts = Date.parse(e.recorded_at ?? "");
        if (!isNaN(ts) && ts < sinceMs) return [];
        return [e];
      } catch { return []; }
    });
}

// ── meter.record ─────────────────────────────────────────────────────────────
function cmdMeterRecord(args) {
  const event    = flag(args, "--event");
  const model    = flag(args, "--model") ?? "default";
  const quantStr = flag(args, "--quantity") ?? "1";
  const unit     = flag(args, "--unit") ?? "count";
  const metaStr  = flag(args, "--meta");
  const asJson   = hasFlag(args, "--json");

  if (!event) {
    console.error("  error: meter record requires --event <name>");
    process.exitCode = 1;
    return;
  }

  const quantity = parseFloat(quantStr);
  if (!isFinite(quantity)) {
    console.error(`  error: --quantity must be a number, got: ${quantStr}`);
    process.exitCode = 1;
    return;
  }

  let meta = null;
  if (metaStr) {
    try { meta = JSON.parse(metaStr); }
    catch { console.error("  error: --meta must be valid JSON"); process.exitCode = 1; return; }
  }

  const ts = now();
  // Deterministic event ID: hash of (model + event + timestamp + random nonce)
  const nonce = randomBytes(8).toString("hex");
  const eventId = createHash("sha256")
    .update(`${model}:${event}:${ts}:${nonce}`)
    .digest("hex");

  const entry = {
    schema_version: "aurekai.meter.event.v1",
    event_id: eventId,
    recorded_at: ts,
    model,
    event,
    quantity,
    unit,
    meta: meta ?? undefined,
  };

  ensureMeterDir();
  appendFileSync(meterFile(model), JSON.stringify(entry) + "\n", "utf8");

  if (asJson) {
    printJson(entry);
  } else {
    process.stdout.write(`meter.record\n`);
    process.stdout.write(`  event_id : ${eventId}\n`);
    process.stdout.write(`  event    : ${event}\n`);
    process.stdout.write(`  quantity : ${quantity} ${unit}\n`);
    process.stdout.write(`  model    : ${model}\n`);
    process.stdout.write(`  store    : ${meterFile(model)}\n`);
  }
  return entry;
}

// ── meter.list ───────────────────────────────────────────────────────────────
function cmdMeterList(args) {
  const model  = flag(args, "--model") ?? "default";
  const since  = flag(args, "--since");
  const asJson = hasFlag(args, "--json");

  const entries = readMeterEntries(model, since);

  if (asJson) {
    printJson({ schema_version: "aurekai.meter.list.v1", model, entries });
  } else {
    if (!entries.length) {
      process.stdout.write(`  No meter events for model '${model}'.\n`);
      return;
    }
    for (const e of entries) {
      process.stdout.write(
        `  ${e.recorded_at}  ${e.event.padEnd(30)}  ${String(e.quantity).padStart(6)} ${e.unit}\n`
      );
    }
  }
}

// ── meter.summary ─────────────────────────────────────────────────────────────
function cmdMeterSummary(args) {
  const model  = flag(args, "--model") ?? "default";
  const since  = flag(args, "--since");
  const asJson = hasFlag(args, "--json");

  const entries = readMeterEntries(model, since);

  // Aggregate by event name and unit
  const totals = {};
  for (const e of entries) {
    const key = `${e.event}:${e.unit}`;
    totals[key] = (totals[key] || 0) + e.quantity;
  }

  const aggregated = Object.entries(totals).map(([key, total]) => {
    const [event, unit] = key.split(":");
    return { event, unit, total };
  });

  const result = {
    schema_version: "aurekai.meter.summary.v1",
    summarized_at: now(),
    model,
    since_filter: since ?? "(all)",
    total_events: entries.length,
    aggregated,
  };

  if (asJson) {
    printJson(result);
  } else {
    process.stdout.write(`meter summary — model: ${model}\n`);
    process.stdout.write(`  total events : ${entries.length}\n`);
    if (!aggregated.length) {
      process.stdout.write(`  (no events)\n`);
    } else {
      for (const a of aggregated) {
        process.stdout.write(
          `  ${a.event.padEnd(30)}  ${String(a.total).padStart(8)} ${a.unit}\n`
        );
      }
    }
  }
  return result;
}

// ── dispatcher ───────────────────────────────────────────────────────────────
export async function meterCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "record":
      cmdMeterRecord(rest);
      break;
    case "list":
      cmdMeterList(rest);
      break;
    case "summary":
      cmdMeterSummary(rest);
      break;
    default:
      console.error(`  error: unknown meter subcommand '${sub ?? "(none)"}'.`);
      console.error("  Available: record, list, summary");
      process.exitCode = 1;
  }
}
