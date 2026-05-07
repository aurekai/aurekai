/**
 * src/tel-ops.mjs
 *
 * Native wire/tel simulation commands.
 * Implements local telephony simulation (no real PSTN/SMS gateway).
 *
 *   tel.mock       — create a mock tel session
 *   tel.sim_call   — simulate an inbound/outbound call record
 *   tel.sim_sms    — simulate an SMS record
 *   tel.listen     — listen for local tel events (poll mode, one-shot)
 *   tel.send_sms   — honest: requires external SMS provider
 *   wire.recipe    — read/write a local wire recipe file
 *   wire.space_export — export wire space state to file
 *   wire.ingest_pcap  — ingest a PCAP file (requires tcpdump/tshark)
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const AUREKAI_DIR = join(homedir(), ".aurekai");
const TEL_DIR     = join(AUREKAI_DIR, "tel");
const WIRE_DIR    = join(AUREKAI_DIR, "wire");

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

// ── tel.mock ──────────────────────────────────────────────────────────────────
function cmdTelMock(args) {
  const name   = flag(args, "--name") ?? `mock-${randomBytes(4).toString("hex")}`;
  const type   = flag(args, "--type") ?? "call";
  const asJson = hasFlag(args, "--json");

  const session_id = randomBytes(8).toString("hex");
  const session = { schema_version: "aurekai.tel.mock.v1", session_id, name, type, created_at: now(), events: [], state: "ready" };
  ensureDir(TEL_DIR);
  writeFileSync(join(TEL_DIR, `${session_id}.tel.json`), JSON.stringify(session, null, 2) + "\n", "utf8");

  const result = { ...session, verdict: "MOCK_READY" };
  if (asJson) printJson(result);
  else process.stdout.write(`tel.mock  session_id: ${session_id}  name: ${name}  type: ${type}\n`);
  return result;
}

// ── tel.sim_call ──────────────────────────────────────────────────────────────
function cmdTelSimCall(args) {
  const from      = flag(args, "--from") ?? "+10000000000";
  const to        = flag(args, "--to")   ?? "+19999999999";
  const direction = flag(args, "--direction") ?? "inbound";
  const duration  = parseInt(flag(args, "--duration-seconds") ?? "30", 10);
  const status    = flag(args, "--status") ?? "completed";
  const asJson    = hasFlag(args, "--json");

  const call_id = randomBytes(8).toString("hex");
  const call = {
    schema_version: "aurekai.tel.call.v1",
    call_id, from, to, direction,
    started_at: now(),
    ended_at: new Date(Date.now() + duration * 1000).toISOString(),
    duration_seconds: duration,
    status,
    simulation: true,
  };
  ensureDir(TEL_DIR);
  appendFileSync(join(TEL_DIR, "calls.jsonl"), JSON.stringify(call) + "\n", "utf8");

  const result = { ...call, verdict: "SIMULATED" };
  if (asJson) printJson(result);
  else process.stdout.write(`tel.sim_call  ${from} → ${to}  ${direction}  ${duration}s  ${status}\n`);
  return result;
}

// ── tel.sim_sms ───────────────────────────────────────────────────────────────
function cmdTelSimSms(args) {
  const from      = flag(args, "--from") ?? "+10000000000";
  const to        = flag(args, "--to")   ?? "+19999999999";
  const body      = flag(args, "--body") ?? "(simulated message)";
  const direction = flag(args, "--direction") ?? "inbound";
  const asJson    = hasFlag(args, "--json");

  const sms_id = randomBytes(8).toString("hex");
  const sms = {
    schema_version: "aurekai.tel.sms.v1",
    sms_id, from, to, body, direction,
    sent_at: now(),
    simulation: true,
  };
  ensureDir(TEL_DIR);
  appendFileSync(join(TEL_DIR, "sms.jsonl"), JSON.stringify(sms) + "\n", "utf8");

  const result = { ...sms, verdict: "SIMULATED" };
  if (asJson) printJson(result);
  else process.stdout.write(`tel.sim_sms  ${from} → ${to}  "${body.slice(0, 40)}"\n`);
  return result;
}

// ── tel.listen ────────────────────────────────────────────────────────────────
function cmdTelListen(args) {
  const since  = flag(args, "--since");
  const type   = flag(args, "--type"); // calls | sms | all
  const limit  = parseInt(flag(args, "--limit") ?? "20", 10);
  const asJson = hasFlag(args, "--json");

  const sinceMs = since ? Date.parse(since) : 0;
  const events = [];

  if (!type || type === "calls" || type === "all") {
    const callsFile = join(TEL_DIR, "calls.jsonl");
    if (existsSync(callsFile)) {
      events.push(...readFileSync(callsFile, "utf8").split("\n").filter(Boolean).flatMap(l => {
        try { const e = JSON.parse(l); const ts = Date.parse(e.started_at ?? ""); if (!isNaN(ts) && ts < sinceMs) return []; return [{ ...e, event_type: "call" }]; } catch { return []; }
      }));
    }
  }
  if (!type || type === "sms" || type === "all") {
    const smsFile = join(TEL_DIR, "sms.jsonl");
    if (existsSync(smsFile)) {
      events.push(...readFileSync(smsFile, "utf8").split("\n").filter(Boolean).flatMap(l => {
        try { const e = JSON.parse(l); const ts = Date.parse(e.sent_at ?? ""); if (!isNaN(ts) && ts < sinceMs) return []; return [{ ...e, event_type: "sms" }]; } catch { return []; }
      }));
    }
  }

  events.sort((a, b) => (b.started_at ?? b.sent_at ?? "").localeCompare(a.started_at ?? a.sent_at ?? ""));
  const result = { schema_version: "aurekai.tel.listen.v1", polled_at: now(), since_filter: since ?? "(all)", type_filter: type ?? "all", event_count: events.length, events: events.slice(0, limit) };

  if (asJson) printJson(result);
  else {
    if (!events.length) process.stdout.write("  no tel events\n");
    else for (const e of events.slice(0, limit)) process.stdout.write(`  ${e.event_type.padEnd(5)} ${(e.started_at ?? e.sent_at ?? "").slice(0, 19)}  ${e.from} → ${e.to}\n`);
  }
  return result;
}

// ── tel.send_sms (honest stub) ────────────────────────────────────────────────
function cmdTelSendSms(args) {
  const asJson = hasFlag(args, "--json");
  const result = { schema_version: "aurekai.tel.send_sms.v1", requested_at: now(), verdict: "NEEDS_EXTERNAL", requires: ["SMS_GATEWAY_CREDENTIALS", "AKAI_SMS_PROVIDER"], note: "tel.send_sms requires a configured SMS provider. Set AKAI_SMS_PROVIDER (twilio|vonage) and credentials in ~/.aurekai/tel-config.json." };
  if (asJson) printJson(result);
  else { console.error(`  tel.send_sms: NEEDS_EXTERNAL`); console.error(`  ${result.note}`); }
  process.exitCode = 2;
  return result;
}

// ── wire.recipe ───────────────────────────────────────────────────────────────
function cmdWireRecipe(args) {
  const sub    = args[0];
  const rest   = args.slice(1);
  const asJson = hasFlag(args, "--json");
  ensureDir(WIRE_DIR);

  if (sub === "list" || !sub) {
    const recipes = existsSync(join(WIRE_DIR, "recipes")) ? readdirSync(join(WIRE_DIR, "recipes")).filter(f => f.endsWith(".recipe.json")) : [];
    const result = { schema_version: "aurekai.wire.recipe.list.v1", listed_at: now(), recipe_count: recipes.length, recipes: recipes.map(r => r.replace(".recipe.json", "")) };
    if (asJson) printJson(result); else process.stdout.write(recipes.length ? recipes.map(r => `  ${r}`).join("\n") + "\n" : "  no wire recipes\n");
    return result;
  }

  if (sub === "create") {
    const name = flag(rest, "--name") ?? `recipe-${randomBytes(4).toString("hex")}`;
    const steps = flag(rest, "--steps") ?? "[]";
    const recipeDir = join(WIRE_DIR, "recipes");
    ensureDir(recipeDir);
    let stepsArr;
    try { stepsArr = JSON.parse(steps); } catch { stepsArr = [steps]; }
    const recipe = { schema_version: "aurekai.wire.recipe.v1", created_at: now(), name, steps: stepsArr };
    writeFileSync(join(recipeDir, `${name}.recipe.json`), JSON.stringify(recipe, null, 2) + "\n", "utf8");
    const result = { ...recipe, verdict: "CREATED" };
    if (asJson) printJson(result); else process.stdout.write(`wire.recipe created: ${name}\n`);
    return result;
  }

  console.error(`  error: wire recipe: unknown subcommand '${sub}'. Available: list, create`);
  process.exitCode = 1;
}

// ── wire.space_export ─────────────────────────────────────────────────────────
function cmdWireSpaceExport(args) {
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");

  const spacesDir = join(homedir(), ".aurekai", "spaces");
  const spaces = existsSync(spacesDir) ? readdirSync(spacesDir).filter(f => f.endsWith(".space.json")).map(f => { try { return JSON.parse(readFileSync(join(spacesDir, f), "utf8")); } catch { return null; } }).filter(Boolean) : [];

  const export_doc = { schema_version: "aurekai.wire.space.export.v1", exported_at: now(), space_count: spaces.length, spaces };
  if (outArg) { ensureDir(dirname(resolve(process.cwd(), outArg))); writeFileSync(resolve(process.cwd(), outArg), JSON.stringify(export_doc, null, 2) + "\n", "utf8"); if (!asJson) process.stdout.write(`wire.space_export written: ${resolve(process.cwd(), outArg)}\n`); }
  if (asJson) printJson(export_doc);
  else if (!outArg) process.stdout.write(`wire.space_export  spaces: ${spaces.length}\n`);
  return export_doc;
}

// ── wire.ingest_pcap ──────────────────────────────────────────────────────────
function cmdWireIngestPcap(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--pcap") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");

  const hasTshark  = spawnSync("which", ["tshark"],  { encoding: "utf8" }).status === 0;
  const hasTcpdump = spawnSync("which", ["tcpdump"], { encoding: "utf8" }).status === 0;

  if (!hasTshark && !hasTcpdump) {
    const r = { schema_version: "aurekai.wire.pcap.v1", requested_at: now(), verdict: "NEEDS_EXTERNAL", requires: ["tshark", "tcpdump"], source: inPath ?? null, note: "wire.ingest_pcap requires tshark or tcpdump. Install wireshark-cli or use tcpdump." };
    if (asJson) printJson(r); else { console.error(`  wire.ingest_pcap: NEEDS_EXTERNAL. Install tshark or tcpdump.`); }
    process.exitCode = 2; return r;
  }

  if (!inPath) { console.error("  error: wire ingest-pcap requires --in <file.pcap>"); process.exitCode = 1; return; }
  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: pcap file not found: ${absIn}`); process.exitCode = 1; return; }

  const bin = hasTshark ? "tshark" : "tcpdump";
  const binArgs = hasTshark ? ["-r", absIn, "-T", "json"] : ["-r", absIn, "-nn", "-q"];
  const r = spawnSync(bin, binArgs, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

  let packets = [];
  if (hasTshark && r.status === 0) { try { packets = JSON.parse(r.stdout); } catch {} }

  const result = { schema_version: "aurekai.wire.pcap.v1", ingested_at: now(), source: absIn, backend: bin, exit_code: r.status, packet_count: packets.length, verdict: r.status === 0 ? "INGESTED" : "BACKEND_ERROR", stderr: r.stderr?.slice(0, 500) };
  if (asJson) printJson(result); else process.stdout.write(`wire.ingest_pcap  ${result.verdict}  packets: ${result.packet_count}  source: ${absIn}\n`);
  return result;
}

// ── moq.video_relay (honest stub) ────────────────────────────────────────────
function cmdMoqVideoRelay(args) {
  const asJson = hasFlag(args, "--json");
  const result = { schema_version: "aurekai.moq.video_relay.v1", requested_at: now(), verdict: "NEEDS_EXTERNAL", requires: ["MOQ_RELAY_INFRA", "AKAI_MOQ_ENDPOINT"], note: "moq.video_relay requires a MoQ (Media over QUIC) relay infrastructure endpoint. Set AKAI_MOQ_ENDPOINT to your relay URL." };
  if (asJson) printJson(result);
  else { console.error(`  moq.video_relay: NEEDS_EXTERNAL`); console.error(`  ${result.note}`); }
  process.exitCode = 2;
  return result;
}

export async function telCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "mock":     cmdTelMock(rest);    break;
    case "sim-call": cmdTelSimCall(rest); break;
    case "sim-sms":  cmdTelSimSms(rest);  break;
    case "listen":   cmdTelListen(rest);  break;
    case "send-sms": cmdTelSendSms(rest); break;
    case "moq-relay": cmdMoqVideoRelay(rest); break;
    default:
      console.error(`  error: unknown tel subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export { cmdTelMock, cmdTelSimCall, cmdTelSimSms, cmdTelListen, cmdTelSendSms,
         cmdWireRecipe, cmdWireSpaceExport, cmdWireIngestPcap, cmdMoqVideoRelay };
