/**
 * Aurekai canonical operations — canon.hash, canon.parse, canon.diff
 *
 * All output is real: real SHA-256 over real file bytes, real JSON key-sort.
 * No synthetics.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || null;
}
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

/**
 * Canonical JSON serialization: keys sorted recursively, no extra whitespace.
 * This is the definition used for canon.hash --canonical-json.
 */
function canonSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonSerialize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonSerialize(value[k])).join(",") + "}";
}

function hashBuf(buf, algorithm = "sha256") {
  return createHash(algorithm).update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// canon hash
// ---------------------------------------------------------------------------
async function cmdCanonHash(args) {
  const inFile = flag(args, "--in") || flag(args, "--file") || args.find(a => !a.startsWith("-"));
  if (!inFile) throw new Error("canon hash requires --in <file>");
  const algorithm = flag(args, "--algorithm") || "sha256";
  const canonicalJson = hasFlag(args, "--canonical-json");
  const asJson = hasFlag(args, "--json");

  const inPath = resolve(inFile);
  if (!existsSync(inPath)) throw new Error(`file not found: ${inFile}`);
  const stat = statSync(inPath);
  const raw = readFileSync(inPath);
  const rawHash = hashBuf(raw, algorithm);

  let canonicalHash = rawHash;
  let canonicalForm = "raw-bytes";
  if (canonicalJson) {
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      const canonical = canonSerialize(parsed);
      canonicalHash = hashBuf(Buffer.from(canonical, "utf8"), algorithm);
      canonicalForm = "json-key-sorted";
    } catch {
      // Not valid JSON — fall through to raw-bytes canonical
    }
  }

  const payload = {
    schema_version: "aurekai.canon.hash.v1",
    computed_at: now(),
    source: inPath,
    source_bytes: stat.size,
    algorithm,
    raw_hash: `${algorithm}:${rawHash}`,
    canonical_hash: `${algorithm}:${canonicalHash}`,
    canonical_form: canonicalForm,
  };

  if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
  printJson({ schema_version: "aurekai.weightops.result.v1", command: "canon.hash", status: "PASS", created_at: now(), payload });
}

// ---------------------------------------------------------------------------
// canon parse
// ---------------------------------------------------------------------------
async function cmdCanonParse(args) {
  const inFile = flag(args, "--in") || args.find(a => !a.startsWith("-"));
  if (!inFile) throw new Error("canon parse requires --in <file>");
  const outFile = flag(args, "--out");
  const asJson = hasFlag(args, "--json");

  const inPath = resolve(inFile);
  if (!existsSync(inPath)) throw new Error(`file not found: ${inFile}`);
  const raw = readFileSync(inPath, "utf8");

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error(`canon parse: ${inFile} is not valid JSON — ${e.message}`);
  }
  const canonical = canonSerialize(parsed);
  const hash = hashBuf(Buffer.from(canonical, "utf8"), "sha256");

  const payload = {
    schema_version: "aurekai.canon.parse.v1",
    parsed_at: now(),
    source: inPath,
    source_bytes: Buffer.byteLength(raw, "utf8"),
    canonical_bytes: Buffer.byteLength(canonical, "utf8"),
    canonical_hash: `sha256:${hash}`,
  };

  if (outFile) {
    const outPath = resolve(outFile);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, canonical + "\n", "utf8");
    payload.output = outPath;
  }

  if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
  printJson({ schema_version: "aurekai.weightops.result.v1", command: "canon.parse", status: "PASS", created_at: now(), payload });
}

// ---------------------------------------------------------------------------
// canon diff
// ---------------------------------------------------------------------------
function diffValues(a, b, path) {
  const changes = [];
  if (
    a === null || b === null ||
    typeof a !== "object" || typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: path || ".", op: "replace", old: a, new: b });
    return changes;
  }
  if (Array.isArray(a)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const p = `${path}[${i}]`;
      if (i >= a.length) changes.push({ path: p, op: "add", new: b[i] });
      else if (i >= b.length) changes.push({ path: p, op: "remove", old: a[i] });
      else changes.push(...diffValues(a[i], b[i], p));
    }
    return changes;
  }
  const allKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of allKeys) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in a)) changes.push({ path: p, op: "add", new: b[k] });
    else if (!(k in b)) changes.push({ path: p, op: "remove", old: a[k] });
    else changes.push(...diffValues(a[k], b[k], p));
  }
  return changes;
}

async function cmdCanonDiff(args) {
  const fileA = flag(args, "--a") || args.filter(a => !a.startsWith("-"))[0];
  const fileB = flag(args, "--b") || args.filter(a => !a.startsWith("-"))[1];
  if (!fileA || !fileB) throw new Error("canon diff requires --a <file_a> --b <file_b>");
  const asJson = hasFlag(args, "--json");

  const pathA = resolve(fileA);
  const pathB = resolve(fileB);
  if (!existsSync(pathA)) throw new Error(`file not found: ${fileA}`);
  if (!existsSync(pathB)) throw new Error(`file not found: ${fileB}`);

  let docA, docB;
  try { docA = JSON.parse(readFileSync(pathA, "utf8")); } catch (e) { throw new Error(`${fileA}: not valid JSON`); }
  try { docB = JSON.parse(readFileSync(pathB, "utf8")); } catch (e) { throw new Error(`${fileB}: not valid JSON`); }

  const hashA = hashBuf(Buffer.from(canonSerialize(docA), "utf8"), "sha256");
  const hashB = hashBuf(Buffer.from(canonSerialize(docB), "utf8"), "sha256");
  const identical = hashA === hashB;
  const changes = identical ? [] : diffValues(docA, docB, "");

  const payload = {
    schema_version: "aurekai.canon.diff.v1",
    diffed_at: now(),
    source_a: pathA,
    source_b: pathB,
    hash_a: `sha256:${hashA}`,
    hash_b: `sha256:${hashB}`,
    identical,
    change_count: changes.length,
    changes,
  };

  if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
  printJson({ schema_version: "aurekai.weightops.result.v1", command: "canon.diff", status: "PASS", created_at: now(), payload });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
function printCanonHelp() {
  console.log("Usage:");
  console.log("  akai canon hash  --in <file> [--algorithm sha256] [--canonical-json] [--json]");
  console.log("  akai canon parse --in <file> [--out <file.canonical.json>] [--json]");
  console.log("  akai canon diff  --a <file_a> --b <file_b> [--json]");
}

export async function canonCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") { printCanonHelp(); return; }
  if (sub === "hash")  return cmdCanonHash(rest);
  if (sub === "parse") return cmdCanonParse(rest);
  if (sub === "diff")  return cmdCanonDiff(rest);
  throw new Error(`unknown canon subcommand '${sub}'`);
}
