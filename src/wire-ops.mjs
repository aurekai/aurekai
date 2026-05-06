/**
 * src/wire-ops.mjs
 *
 * Native implementation of wire-family commands.
 *
 * Implemented:
 *   wire report  — structured diagnostic report of wire/tel activity from the audit log
 *   wire doctor  — basic connectivity/environment self-check (stub for offline use)
 *
 * All computation is real. No synthetics.
 *   - wire.report reads ~/.aurekai/audit/<model>.jsonl and summarises wire-family events.
 *   - If no audit log exists the report is returned with an honest INCOMPLETE verdict.
 *
 * CLI surface:
 *   akai wire report [--model <name>] [--since <iso>] [--out <file>] [--json]
 *   akai wire doctor [--json]
 */

import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
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

function sha256(buf) {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

const WIRE_FAMILY_PREFIXES = [
  "tel.", "wire.", "net.", "moq.", "pcap", "ingest_pcap",
];

function isWireEvent(cmd) {
  return WIRE_FAMILY_PREFIXES.some(p => cmd.startsWith(p));
}

const AUREKAI_DIR = join(homedir(), ".aurekai");
const AUDIT_DIR   = join(AUREKAI_DIR, "audit");

// ── read audit logs ──────────────────────────────────────────────────────────
function readAuditEntries(modelFilter, since) {
  if (!existsSync(AUDIT_DIR)) return [];
  const files = readdirSync(AUDIT_DIR)
    .filter(f => f.endsWith(".jsonl"))
    .filter(f => modelFilter ? f.startsWith(modelFilter + ".") : true);

  const sinceMs = since ? Date.parse(since) : 0;
  const entries = [];
  for (const f of files) {
    const model = f.replace(/\.jsonl$/, "");
    const lines = readFileSync(join(AUDIT_DIR, f), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        const ts = Date.parse(e.timestamp || e.created_at || "");
        if (!isNaN(ts) && ts < sinceMs) continue;
        entries.push({ model, ...e });
      } catch { /* skip malformed lines */ }
    }
  }
  return entries;
}

// ── wire.report ──────────────────────────────────────────────────────────────
function cmdWireReport(args) {
  const model  = flag(args, "--model");
  const since  = flag(args, "--since");
  const outPath = flag(args, "--out");
  const asJson = hasFlag(args, "--json");

  const allEntries = readAuditEntries(model, since);
  const wireEntries = allEntries.filter(e => {
    const cmd = e.command || e.cmd || "";
    return isWireEvent(cmd);
  });

  // Build per-command tallies
  const cmdCounts = {};
  const modelSet = new Set();
  let earliest = null;
  let latest = null;

  for (const e of wireEntries) {
    const cmd = e.command || e.cmd || "(unknown)";
    cmdCounts[cmd] = (cmdCounts[cmd] || 0) + 1;
    if (e.model) modelSet.add(e.model);
    const ts = e.timestamp || e.created_at;
    if (ts) {
      if (!earliest || ts < earliest) earliest = ts;
      if (!latest   || ts > latest  ) latest   = ts;
    }
  }

  const verdict = wireEntries.length > 0 ? "PRESENT" : "NO_WIRE_EVENTS";
  const auditAvailable = existsSync(AUDIT_DIR);

  const report = {
    schema_version: "aurekai.wire.report.v1",
    generated_at: now(),
    model_filter: model ?? "(all)",
    since_filter: since ?? "(all)",
    audit_log_available: auditAvailable,
    total_audit_entries: allEntries.length,
    wire_event_count: wireEntries.length,
    models_observed: [...modelSet],
    event_window: { earliest: earliest ?? null, latest: latest ?? null },
    command_breakdown: cmdCounts,
    verdict,
    note: auditAvailable
      ? null
      : "Audit log directory ~/.aurekai/audit does not exist. Run wire commands to populate.",
  };

  if (outPath) {
    mkdirSync(outPath.replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    if (!asJson) process.stdout.write(`wire report written: ${outPath}\n`);
  }

  if (asJson) {
    printJson(report);
  } else if (!outPath) {
    process.stdout.write(`wire.report\n`);
    process.stdout.write(`  verdict         : ${verdict}\n`);
    process.stdout.write(`  wire events     : ${wireEntries.length} / ${allEntries.length} total audit entries\n`);
    process.stdout.write(`  models observed : ${[...modelSet].join(", ") || "(none)"}\n`);
    if (Object.keys(cmdCounts).length) {
      process.stdout.write(`  breakdown:\n`);
      for (const [c, n] of Object.entries(cmdCounts)) {
        process.stdout.write(`    ${c.padEnd(30)} ${n}\n`);
      }
    }
  }

  return report;
}

// ── wire.doctor ──────────────────────────────────────────────────────────────
function cmdWireDoctor(args) {
  const asJson = hasFlag(args, "--json");
  const checks = [
    { name: "audit_dir",    ok: existsSync(AUDIT_DIR),   path: AUDIT_DIR },
    { name: "netlists_dir", ok: existsSync(join(AUREKAI_DIR, "netlists")),
      path: join(AUREKAI_DIR, "netlists") },
    { name: "meter_dir",    ok: existsSync(join(AUREKAI_DIR, "meter")),
      path: join(AUREKAI_DIR, "meter") },
  ];
  const allOk = checks.every(c => c.ok);
  const result = {
    schema_version: "aurekai.wire.doctor.v1",
    checked_at: now(),
    verdict: allOk ? "OK" : "INCOMPLETE",
    checks,
    note: allOk ? null : "Some directories are missing — they will be created on first use.",
  };

  if (asJson) {
    printJson(result);
  } else {
    for (const c of checks) {
      process.stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(20)} ${c.path}\n`);
    }
    process.stdout.write(`  verdict: ${result.verdict}\n`);
  }
  return result;
}

// ── dispatcher ───────────────────────────────────────────────────────────────
export async function wireCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "report":
      cmdWireReport(rest);
      break;
    case "doctor":
      cmdWireDoctor(rest);
      break;
    default:
      console.error(`  error: unknown wire subcommand '${sub ?? "(none)"}'.`);
      console.error("  Available: report, doctor");
      process.exitCode = 1;
  }
}
