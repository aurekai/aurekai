/**
 * src/ledger.mjs
 *
 * Native commerce/ledger commands:
 *   usage.report     — aggregate meter data into structured usage report
 *   ledger.export    — export meter JSONL as ledger (JSON or CSV)
 *   gate.issue       — issue a local HMAC-signed gate token
 *   gate.guard       — verify a gate token
 *   auth.verify      — verify an auth token (local HMAC)
 *   finance.margin   — calculate gross margin
 *   invoice.generate — generate a local invoice document
 *   pay.invoice      — honest stub: requires payment processor
 *   project.create   — scaffold a local project directory
 *   cms.entry.create — create a CMS entry file
 *   outreach.followup— queue a followup task (uses queue.mjs)
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

const AUREKAI_DIR  = join(homedir(), ".aurekai");
const METER_DIR    = join(AUREKAI_DIR, "meter");
const TOKENS_DIR   = join(AUREKAI_DIR, "tokens");
const PROJECTS_DIR = join(AUREKAI_DIR, "projects");
const CMS_DIR      = join(AUREKAI_DIR, "cms");
const QUEUE_DIR    = join(AUREKAI_DIR, "queue");

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function getSecret() {
  const secretFile = join(AUREKAI_DIR, ".local-secret");
  if (!existsSync(secretFile)) {
    ensureDir(AUREKAI_DIR);
    const secret = randomBytes(32).toString("hex");
    writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }
  return readFileSync(secretFile, "utf8").trim();
}

function readAllMeterEntries(modelFilter, since) {
  if (!existsSync(METER_DIR)) return [];
  const sinceMs = since ? Date.parse(since) : 0;
  return readdirSync(METER_DIR)
    .filter(f => f.endsWith(".jsonl") && (!modelFilter || f.startsWith(modelFilter + ".")))
    .flatMap(f => readFileSync(join(METER_DIR, f), "utf8").split("\n").filter(Boolean)
      .flatMap(l => { try { const e = JSON.parse(l); const ts = Date.parse(e.recorded_at ?? ""); if (!isNaN(ts) && ts < sinceMs) return []; return [e]; } catch { return []; } }));
}

// ── usage.report ─────────────────────────────────────────────────────────────
function cmdUsageReport(args) {
  const model  = flag(args, "--model");
  const since  = flag(args, "--since");
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");

  const entries = readAllMeterEntries(model, since);
  const models = [...new Set(entries.map(e => e.model))];
  const byEvent = {};
  const byModel = {};
  let earliest = null, latest = null;

  for (const e of entries) {
    const key = `${e.event}:${e.unit}`;
    byEvent[key] = (byEvent[key] || 0) + e.quantity;
    if (!byModel[e.model]) byModel[e.model] = {};
    const mkey = `${e.event}:${e.unit}`;
    byModel[e.model][mkey] = (byModel[e.model][mkey] || 0) + e.quantity;
    if (e.recorded_at) { if (!earliest || e.recorded_at < earliest) earliest = e.recorded_at; if (!latest || e.recorded_at > latest) latest = e.recorded_at; }
  }

  const event_totals = Object.entries(byEvent).map(([k, v]) => { const [event, unit] = k.split(":"); return { event, unit, total: v }; });
  const result = {
    schema_version: "aurekai.usage.report.v1",
    generated_at: now(),
    model_filter: model ?? "(all)",
    since_filter: since ?? "(all)",
    total_events: entries.length,
    models_observed: models,
    event_window: { earliest: earliest ?? null, latest: latest ?? null },
    event_totals,
    by_model: byModel,
    verdict: entries.length > 0 ? "PRESENT" : "NO_USAGE_DATA",
  };

  if (outArg) { ensureDir(dirname(resolve(outArg))); writeFileSync(resolve(outArg), JSON.stringify(result, null, 2) + "\n", "utf8"); }
  if (asJson) printJson(result);
  else {
    process.stdout.write(`usage.report  total_events: ${entries.length}  models: ${models.join(", ") || "(none)"}\n`);
    for (const t of event_totals) process.stdout.write(`  ${t.event.padEnd(32)} ${String(t.total).padStart(8)} ${t.unit}\n`);
  }
  return result;
}

// ── ledger.export ─────────────────────────────────────────────────────────────
function cmdLedgerExport(args) {
  const model  = flag(args, "--model");
  const format = flag(args, "--format") ?? "json";
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");

  const entries = readAllMeterEntries(model, null);
  let output;
  if (format === "csv") {
    const header = "event_id,recorded_at,model,event,quantity,unit";
    const rows   = entries.map(e => `${e.event_id},${e.recorded_at},${e.model},${e.event},${e.quantity},${e.unit}`);
    output = [header, ...rows].join("\n") + "\n";
  } else {
    output = JSON.stringify({ schema_version: "aurekai.ledger.v1", exported_at: now(), model_filter: model ?? "(all)", entry_count: entries.length, entries }, null, 2) + "\n";
  }

  if (outArg) { ensureDir(dirname(resolve(outArg))); writeFileSync(resolve(outArg), output, "utf8"); if (!asJson) process.stdout.write(`ledger exported: ${resolve(outArg)}  (${entries.length} entries)\n`); }
  else if (format === "json" && asJson) process.stdout.write(output);
  else process.stdout.write(output);
}

// ── gate.issue ────────────────────────────────────────────────────────────────
function cmdGateIssue(args) {
  const subject = flag(args, "--subject") ?? "anonymous";
  const ttlStr  = flag(args, "--ttl-seconds") ?? "3600";
  const claims  = flag(args, "--claims");
  const asJson  = hasFlag(args, "--json");

  const secret   = getSecret();
  const issued   = Math.floor(Date.now() / 1000);
  const ttl      = parseInt(ttlStr, 10) || 3600;
  const expires  = issued + ttl;
  const claimsObj = claims ? (() => { try { return JSON.parse(claims); } catch { return {}; } })() : {};
  const payload  = JSON.stringify({ subject, issued, expires, ...claimsObj });
  const sig      = createHmac("sha256", secret).update(payload).digest("hex");
  const token    = Buffer.from(JSON.stringify({ p: payload, s: sig })).toString("base64url");

  ensureDir(TOKENS_DIR);
  appendFileSync(join(TOKENS_DIR, "issued.jsonl"), JSON.stringify({ subject, issued: new Date(issued * 1000).toISOString(), expires: new Date(expires * 1000).toISOString(), token_prefix: token.slice(0, 12) }) + "\n", "utf8");

  const result = { schema_version: "aurekai.gate.token.v1", issued_at: now(), subject, expires_at: new Date(expires * 1000).toISOString(), ttl_seconds: ttl, token, verdict: "ISSUED" };
  if (asJson) printJson(result);
  else process.stdout.write(`token issued  subject:${subject}  expires:${result.expires_at}\n${token}\n`);
  return result;
}

// ── gate.guard ────────────────────────────────────────────────────────────────
function cmdGateGuard(args) {
  const token  = flag(args, "--token") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");
  if (!token) { console.error("  error: gate guard requires --token <token>"); process.exitCode = 1; return; }

  const secret = getSecret();
  let verdict = "INVALID", subject = null, expires_at = null, reason = null;
  try {
    const { p: payload, s: sig } = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (sig !== expected) { reason = "signature mismatch"; }
    else {
      const parsed = JSON.parse(payload);
      subject = parsed.subject;
      expires_at = new Date(parsed.expires * 1000).toISOString();
      if (Math.floor(Date.now() / 1000) > parsed.expires) { verdict = "EXPIRED"; reason = "token expired"; }
      else verdict = "VALID";
    }
  } catch (e) { reason = `parse error: ${e.message}`; }

  const result = { schema_version: "aurekai.gate.guard.v1", checked_at: now(), verdict, subject, expires_at, reason };
  if (asJson) printJson(result);
  else process.stdout.write(`gate.guard  verdict: ${verdict}${subject ? `  subject: ${subject}` : ""}${reason ? `  reason: ${reason}` : ""}\n`);
  return result;
}

// ── auth.verify ───────────────────────────────────────────────────────────────
function cmdAuthVerify(args) {
  const token  = flag(args, "--token") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");
  if (!token) { console.error("  error: auth verify requires --token <token>"); process.exitCode = 1; return; }
  // Delegates to gate guard semantics
  const secret = getSecret();
  let verdict = "INVALID", subject = null, reason = null;
  try {
    const { p: payload, s: sig } = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (sig !== expected) reason = "signature mismatch";
    else { const p = JSON.parse(payload); subject = p.subject; verdict = Math.floor(Date.now() / 1000) > p.expires ? "EXPIRED" : "VERIFIED"; }
  } catch (e) { reason = e.message; }
  const result = { schema_version: "aurekai.auth.verify.v1", verified_at: now(), verdict, subject, reason };
  if (asJson) printJson(result);
  else process.stdout.write(`auth.verify  verdict: ${verdict}${subject ? `  subject: ${subject}` : ""}${reason ? `  (${reason})` : ""}\n`);
  return result;
}

// ── finance.margin ────────────────────────────────────────────────────────────
function cmdFinanceMargin(args) {
  const revenueStr = flag(args, "--revenue") ?? flag(args, "--rev");
  const costStr    = flag(args, "--cost");
  const asJson     = hasFlag(args, "--json");
  if (!revenueStr || !costStr) { console.error("  error: finance margin requires --revenue <n> --cost <n>"); process.exitCode = 1; return; }
  const revenue = parseFloat(revenueStr), cost = parseFloat(costStr);
  if (!isFinite(revenue) || !isFinite(costStr)) { console.error("  error: revenue and cost must be numbers"); process.exitCode = 1; return; }
  const gross_profit = revenue - cost;
  const gross_margin_pct = revenue !== 0 ? parseFloat(((gross_profit / revenue) * 100).toFixed(4)) : null;
  const result = { schema_version: "aurekai.finance.margin.v1", calculated_at: now(), revenue, cost, gross_profit, gross_margin_pct, verdict: gross_profit >= 0 ? "POSITIVE" : "NEGATIVE" };
  if (asJson) printJson(result);
  else process.stdout.write(`revenue: ${revenue}  cost: ${cost}  gross_profit: ${gross_profit}  margin: ${gross_margin_pct}%\n`);
  return result;
}

// ── invoice.generate ──────────────────────────────────────────────────────────
function cmdInvoiceGenerate(args) {
  const to      = flag(args, "--to") ?? "client";
  const from    = flag(args, "--from") ?? "aurekai";
  const items   = flag(args, "--items");
  const outArg  = flag(args, "--out");
  const asJson  = hasFlag(args, "--json");

  const invoice_id = randomBytes(6).toString("hex").toUpperCase();
  const line_items = items ? (() => { try { return JSON.parse(items); } catch { return [{ description: items, quantity: 1, unit_price: 0 }]; } })() : [];
  const total = line_items.reduce((s, it) => s + (it.quantity ?? 1) * (it.unit_price ?? 0), 0);

  const invoice = {
    schema_version: "aurekai.invoice.v1",
    generated_at: now(), invoice_id,
    from, to,
    line_items,
    total,
    currency: flag(args, "--currency") ?? "USD",
    due_date: flag(args, "--due") ?? null,
    status: "DRAFT",
  };

  if (outArg) { ensureDir(dirname(resolve(outArg))); writeFileSync(resolve(outArg), JSON.stringify(invoice, null, 2) + "\n", "utf8"); if (!asJson) process.stdout.write(`invoice written: ${resolve(outArg)}\n`); }
  if (asJson) printJson(invoice);
  else if (!outArg) { process.stdout.write(`INVOICE ${invoice_id}  ${from} → ${to}  total: ${total} ${invoice.currency}\n`); for (const it of line_items) process.stdout.write(`  ${it.description}  qty:${it.quantity ?? 1}  unit:${it.unit_price ?? 0}\n`); }
  return invoice;
}

// ── pay.invoice ───────────────────────────────────────────────────────────────
function cmdPayInvoice(args) {
  const id     = flag(args, "--invoice-id") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");
  const result = { schema_version: "aurekai.pay.invoice.v1", requested_at: now(), invoice_id: id ?? null, verdict: "NEEDS_PAYMENT_PROCESSOR", requires: ["payment-processor-credentials", "AKAI_PAYMENT_KEY"], note: "pay.invoice requires a configured payment processor. Set AKAI_PAYMENT_KEY and configure a provider in ~/.aurekai/payment-config.json." };
  if (asJson) printJson(result);
  else { console.error(`  pay.invoice: ${result.verdict}`); console.error(`  ${result.note}`); }
  process.exitCode = 2;
  return result;
}

// ── project.create ────────────────────────────────────────────────────────────
function cmdProjectCreate(args) {
  const name   = flag(args, "--name") ?? args.find(a => !a.startsWith("--")) ?? `project-${randomBytes(4).toString("hex")}`;
  const type   = flag(args, "--type") ?? "generic";
  const outDir = flag(args, "--out") ?? join(PROJECTS_DIR, name);
  const asJson = hasFlag(args, "--json");

  ensureDir(outDir);
  const manifest = { schema_version: "aurekai.project.v1", created_at: now(), name, type, path: outDir };
  writeFileSync(join(outDir, "project.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "README.md"), `# ${name}\n\nType: ${type}\nCreated: ${now()}\n`, "utf8");

  const result = { ...manifest, verdict: "CREATED" };
  if (asJson) printJson(result);
  else process.stdout.write(`project created: ${name}  type: ${type}  path: ${outDir}\n`);
  return result;
}

// ── cms.entry.create ──────────────────────────────────────────────────────────
function cmdCmsEntryCreate(args) {
  const slug    = flag(args, "--slug") ?? `entry-${randomBytes(4).toString("hex")}`;
  const title   = flag(args, "--title") ?? slug;
  const content = flag(args, "--content") ?? "";
  const type    = flag(args, "--type") ?? "post";
  const asJson  = hasFlag(args, "--json");

  const entryDir = join(CMS_DIR, type);
  ensureDir(entryDir);
  const entry = { schema_version: "aurekai.cms.entry.v1", created_at: now(), slug, title, type, content, status: "draft" };
  const entryFile = join(entryDir, `${slug}.json`);
  writeFileSync(entryFile, JSON.stringify(entry, null, 2) + "\n", "utf8");

  const result = { ...entry, path: entryFile, verdict: "CREATED" };
  if (asJson) printJson(result);
  else process.stdout.write(`cms entry created: ${slug}  type: ${type}  path: ${entryFile}\n`);
  return result;
}

// ── outreach.followup ─────────────────────────────────────────────────────────
function cmdOutreachFollowup(args) {
  const to      = flag(args, "--to") ?? "contact";
  const subject = flag(args, "--subject") ?? "Follow-up";
  const channel = flag(args, "--channel") ?? "email";
  const asJson  = hasFlag(args, "--json");

  // Queue the followup task (does not send — no SMTP/CRM configured)
  ensureDir(QUEUE_DIR);
  const task_id = randomBytes(8).toString("hex");
  const task = { schema_version: "aurekai.queue.task.v1", task_id, queue: "outreach", task: "followup", meta: { to, subject, channel }, state: "pending", enqueued_at: now() };
  appendFileSync(join(QUEUE_DIR, "outreach.jsonl"), JSON.stringify(task) + "\n", "utf8");

  const result = { schema_version: "aurekai.outreach.followup.v1", queued_at: now(), task_id, to, subject, channel, verdict: "QUEUED", note: `Queued in ~/.aurekai/queue/outreach.jsonl. Actual sending requires an SMTP/CRM integration.` };
  if (asJson) printJson(result);
  else process.stdout.write(`outreach.followup queued  to: ${to}  subject: ${subject}  task_id: ${task_id}\n`);
  return result;
}

export async function ledgerCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "usage":    cmdUsageReport(rest);       break;
    case "export":   cmdLedgerExport(rest);       break;
    case "gate-issue":   cmdGateIssue(rest);      break;
    case "gate-guard":   cmdGateGuard(rest);      break;
    case "auth-verify":  cmdAuthVerify(rest);     break;
    case "margin":   cmdFinanceMargin(rest);      break;
    case "invoice":  cmdInvoiceGenerate(rest);    break;
    case "pay":      cmdPayInvoice(rest);         break;
    case "project":  cmdProjectCreate(rest);      break;
    case "cms":      cmdCmsEntryCreate(rest);     break;
    case "outreach": cmdOutreachFollowup(rest);   break;
    default:
      console.error(`  error: unknown ledger subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

// Named exports for direct dispatch
export { cmdUsageReport, cmdLedgerExport, cmdGateIssue, cmdGateGuard, cmdAuthVerify,
         cmdFinanceMargin, cmdInvoiceGenerate, cmdPayInvoice, cmdProjectCreate,
         cmdCmsEntryCreate, cmdOutreachFollowup };
