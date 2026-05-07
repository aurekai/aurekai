/**
 * src/artifact-store.mjs
 *
 * Native artifact/entity operations:
 *   emit.artifact    — write a structured artifact to ~/.aurekai/artifacts/
 *   distribute.bundle— bundle artifacts into a distributable archive
 *   entity.resolve   — resolve entity by name/id from registry or artifacts
 *   family.group     — group truth-matrix commands by family
 *   compress.family  — gzip a file/artifact
 *   query.sql        — query audit/meter JSONL with simple field filters
 *   embed.text       — structural text embedding (hash-based, real SHA-256)
 */
import { createHash, randomBytes } from "node:crypto";
import { createGzip } from "node:zlib";
import {
  createReadStream, createWriteStream,
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { compile as compileChart, detectChart } from "./chart-compiler.mjs";

const AUREKAI_DIR    = join(homedir(), ".aurekai");
const ARTIFACTS_DIR  = join(AUREKAI_DIR, "artifacts");
const BUNDLES_DIR    = join(AUREKAI_DIR, "bundles");
const ENTITIES_DIR   = join(AUREKAI_DIR, "entities");

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function sha256(buf) { return "sha256:" + createHash("sha256").update(buf).digest("hex"); }

// ── emit.artifact ─────────────────────────────────────────────────────────────
function cmdEmitArtifact(args) {
  const name    = flag(args, "--name") ?? `artifact-${randomBytes(4).toString("hex")}`;
  const type    = flag(args, "--type") ?? "generic";
  const inPath  = flag(args, "--in") ?? flag(args, "--input");
  const dataStr = flag(args, "--data");
  const outArg  = flag(args, "--out");
  const asJson  = hasFlag(args, "--json");

  let payload = null, contentHash = null, contentBytes = 0;
  if (inPath) {
    const absIn = resolve(process.cwd(), inPath);
    if (!existsSync(absIn)) { console.error(`  error: --in file not found: ${absIn}`); process.exitCode = 1; return; }
    const buf = readFileSync(absIn);
    contentHash = sha256(buf);
    contentBytes = buf.length;
    try { payload = JSON.parse(buf); } catch { payload = { _raw: buf.toString("utf8").slice(0, 1024) }; }
  } else if (dataStr) {
    try { payload = JSON.parse(dataStr); } catch { payload = { _raw: dataStr }; }
    const buf = Buffer.from(dataStr);
    contentHash = sha256(buf);
    contentBytes = buf.length;
  }

  const artifact_id = createHash("sha256").update(`${name}:${type}:${now()}:${randomBytes(4).toString("hex")}`).digest("hex");
  const artifact = { schema_version: "aurekai.artifact.v1", artifact_id, emitted_at: now(), name, type, content_hash: contentHash, content_bytes: contentBytes, payload };

  const outPath = outArg ? resolve(process.cwd(), outArg) : join(ARTIFACTS_DIR, `${artifact_id}.artifact.json`);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  const result = { ...artifact, output: outPath, verdict: "EMITTED" };
  if (asJson) printJson(result);
  else process.stdout.write(`artifact emitted  id: ${artifact_id.slice(0, 12)}  type: ${type}  path: ${outPath}\n`);
  return result;
}

// ── distribute.bundle ─────────────────────────────────────────────────────────
function cmdDistributeBundle(args) {
  const inputs = (flag(args, "--inputs") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const name   = flag(args, "--name") ?? `bundle-${randomBytes(4).toString("hex")}`;
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");

  const bundle_id = randomBytes(8).toString("hex");
  const files = inputs.map(inp => {
    const abs = resolve(process.cwd(), inp);
    if (!existsSync(abs)) return { path: inp, exists: false, hash: null };
    const buf = readFileSync(abs);
    return { path: abs, exists: true, size: buf.length, hash: sha256(buf), basename: basename(abs) };
  });

  const manifest = { schema_version: "aurekai.bundle.v1", bundle_id, bundled_at: now(), name, file_count: files.length, files, verdict: files.every(f => f.exists) ? "COMPLETE" : "MISSING_FILES" };
  const outPath = outArg ? resolve(process.cwd(), outArg) : join(BUNDLES_DIR, `${bundle_id}.bundle.json`);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  if (asJson) printJson({ ...manifest, output: outPath });
  else process.stdout.write(`bundle created  id: ${bundle_id}  files: ${files.length}  path: ${outPath}  verdict: ${manifest.verdict}\n`);
  return manifest;
}

// ── entity.resolve ────────────────────────────────────────────────────────────
async function cmdEntityResolve(args) {
  const nameArg = flag(args, "--name") ?? flag(args, "--id") ?? args.find(a => !a.startsWith("--"));
  const asJson  = hasFlag(args, "--json");
  if (!nameArg) { console.error("  error: entity resolve requires --name <name>"); process.exitCode = 1; return; }

  // Search registry, truth matrix, and artifacts
  const { buildTruthMatrix } = await import("./truth-matrix.mjs");
  const matrix = buildTruthMatrix();

  const q = nameArg.toLowerCase();
  const matchedCmds = matrix.commands.filter(e => e.command.includes(q) || e.family === q);

  // Search artifacts
  const artifactMatches = [];
  if (existsSync(ARTIFACTS_DIR)) {
    for (const f of readdirSync(ARTIFACTS_DIR).filter(f => f.endsWith(".artifact.json"))) {
      try {
        const a = JSON.parse(readFileSync(join(ARTIFACTS_DIR, f), "utf8"));
        if ((a.name ?? "").includes(q) || (a.artifact_id ?? "").startsWith(q)) artifactMatches.push({ artifact_id: a.artifact_id, name: a.name, type: a.type, emitted_at: a.emitted_at });
      } catch {}
    }
  }

  const result = {
    schema_version: "aurekai.entity.resolve.v1",
    resolved_at: now(), query: nameArg,
    registry_matches: matchedCmds,
    artifact_matches: artifactMatches,
    verdict: (matchedCmds.length || artifactMatches.length) ? "FOUND" : "NOT_FOUND",
  };
  if (asJson) printJson(result);
  else {
    if (!matchedCmds.length && !artifactMatches.length) process.stdout.write(`  entity '${nameArg}' not found\n`);
    for (const c of matchedCmds) process.stdout.write(`  command  ${c.command.padEnd(30)} ${c.family}  ${c.execution_state}\n`);
    for (const a of artifactMatches) process.stdout.write(`  artifact ${a.artifact_id.slice(0, 12)}  ${a.name}  ${a.type}\n`);
  }
  return result;
}

// ── family.group ──────────────────────────────────────────────────────────────
async function cmdFamilyGroup(args) {
  const familyFilter = flag(args, "--family");
  const asJson       = hasFlag(args, "--json");

  const { buildTruthMatrix } = await import("./truth-matrix.mjs");
  const matrix = buildTruthMatrix();

  const groups = {};
  for (const e of matrix.commands) {
    if (familyFilter && e.family !== familyFilter) continue;
    if (!groups[e.family]) groups[e.family] = { family: e.family, native: [], declared: [], hyper: [] };
    if (e.execution_state === "native") groups[e.family].native.push(e.command);
    else if (e.execution_state === "declared-only") groups[e.family].declared.push(e.command);
    else groups[e.family].hyper.push(e.command);
  }

  const result = { schema_version: "aurekai.family.group.v1", grouped_at: now(), family_count: Object.keys(groups).length, groups: Object.values(groups) };
  if (asJson) printJson(result);
  else for (const g of Object.values(groups)) process.stdout.write(`  ${g.family.padEnd(20)} native:${g.native.length}  declared:${g.declared.length}  hyper:${g.hyper.length}\n`);
  return result;
}

// ── compress.family ───────────────────────────────────────────────────────────
async function cmdCompressFamily(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input") ?? args.find(a => !a.startsWith("--"));
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: compress family requires --in <file>"); process.exitCode = 1; return; }

  const absIn  = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: file not found: ${absIn}`); process.exitCode = 1; return; }

  const absOut = outArg ? resolve(process.cwd(), outArg) : absIn + ".gz";
  ensureDir(dirname(absOut));

  await pipeline(createReadStream(absIn), createGzip(), createWriteStream(absOut));

  const inBuf  = readFileSync(absIn);
  const outBuf = readFileSync(absOut);
  const result = { schema_version: "aurekai.compress.v1", compressed_at: now(), source: absIn, output: absOut, source_bytes: inBuf.length, compressed_bytes: outBuf.length, ratio: parseFloat((outBuf.length / inBuf.length).toFixed(4)), source_hash: sha256(inBuf), verdict: "COMPRESSED" };

  if (asJson) printJson(result);
  else process.stdout.write(`compressed: ${absOut}  ${inBuf.length}b → ${outBuf.length}b  ratio: ${result.ratio}\n`);
  return result;
}

// ── query (simple JSON/JSONL field filter) ─────────────────────────────────────
function cmdQuerySql(args) {
  const src    = flag(args, "--from") ?? flag(args, "--source");
  const where  = flag(args, "--where");
  const select = flag(args, "--select");
  const limit  = parseInt(flag(args, "--limit") ?? "100", 10);
  const asJson = hasFlag(args, "--json");
  if (!src) { console.error("  error: query requires --from <file|audit|meter>"); process.exitCode = 1; return; }

  let entries = [];
  // Resolve built-in source aliases
  const auditDir = join(AUREKAI_DIR, "audit");
  const meterDir = join(AUREKAI_DIR, "meter");
  if (src === "audit") {
    if (existsSync(auditDir)) for (const f of readdirSync(auditDir).filter(f => f.endsWith(".jsonl"))) entries.push(...readFileSync(join(auditDir, f), "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }));
  } else if (src === "meter") {
    if (existsSync(meterDir)) for (const f of readdirSync(meterDir).filter(f => f.endsWith(".jsonl"))) entries.push(...readFileSync(join(meterDir, f), "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }));
  } else {
    const absPath = resolve(process.cwd(), src);
    if (!existsSync(absPath)) { console.error(`  error: file not found: ${absPath}`); process.exitCode = 1; return; }
    const text = readFileSync(absPath, "utf8");
    if (src.endsWith(".jsonl")) entries = text.split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
    else { try { const p = JSON.parse(text); entries = Array.isArray(p) ? p : [p]; } catch { console.error("  error: file is not valid JSON/JSONL"); process.exitCode = 1; return; } }
  }

  // where: "field=value" (exact), "field=value%" (prefix), "field~value" (substring)
  if (where) {
    const matchOp = where.match(/^([^=~<>!]+)(=~|~=|~|>=|<=|!=|=)(.*)$/);
    if (matchOp) {
      const [, field, op, rawVal] = matchOp;
      const val = rawVal.endsWith("%") ? rawVal.slice(0, -1) : rawVal; // strip SQL-style wildcard
      const prefix = rawVal.endsWith("%");
      entries = entries.filter(e => {
        const ev = String(e[field] ?? "");
        if (op === "=" || op === "=~" || op === "~=") return prefix ? ev.startsWith(val) : ev === val;
        if (op === "~") return ev.includes(val);
        if (op === "!=") return ev !== val;
        if (op === ">=") return parseFloat(ev) >= parseFloat(val);
        if (op === "<=") return parseFloat(ev) <= parseFloat(val);
        return ev === val;
      });
    } else {
      // Legacy bare "field=value" or "field:value" split
      const [field, value] = where.split(/[=:]/);
      if (field && value !== undefined) {
        const prefix = value.endsWith("%");
        const val = prefix ? value.slice(0, -1) : value;
        entries = entries.filter(e => {
          const ev = String(e[field] ?? "");
          return prefix ? ev.startsWith(val) : ev === val;
        });
      }
    }
  }

  // Select fields — applied on the filtered set; preserve all fields when not specified
  const totalMatched = entries.length;
  let results = entries.slice(0, limit);
  if (select) {
    const fields = select.split(",").map(s => s.trim()).filter(Boolean);
    results = results.map(e => Object.fromEntries(fields.map(f => [f, e[f] ?? null])));
  }

  const output = { schema_version: "aurekai.query.v1", queried_at: now(), source: src, where: where ?? null, select: select ?? null, limit, total_matched: totalMatched, result_count: results.length, results };
  if (asJson) printJson(output);
  else { process.stdout.write(`query: ${src}  matched: ${totalMatched}  returned: ${results.length}\n`); for (const r of results) process.stdout.write(`  ${JSON.stringify(r)}\n`); }
  return output;
}

// ── embed.text ────────────────────────────────────────────────────────────────
function cmdEmbedText(args) {
  const text   = flag(args, "--text") ?? (flag(args, "--in") ? readFileSync(resolve(process.cwd(), flag(args, "--in")), "utf8") : null);
  const asJson = hasFlag(args, "--json");
  if (!text) { console.error("  error: embed text requires --text <text> or --in <file>"); process.exitCode = 1; return; }

  // Structural embedding: 64-dim hash-based vector, deterministic
  const dims = 64;
  const baseHash = createHash("sha256").update(text).digest();
  const vector = Array.from({ length: dims }, (_, i) => {
    const byte = baseHash[i % 32];
    const salt = createHash("sha256").update(baseHash).update(Buffer.from([i])).digest();
    const val = ((salt[0] << 8 | salt[1]) / 65535) * 2 - 1;
    return parseFloat(val.toFixed(6));
  });
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  const normalized = vector.map(v => parseFloat((v / norm).toFixed(6)));

  // E8 cell for this text — same content always maps to the same cell.
  const e8 = compileChart("text_proof", text);
  const textHash = sha256(Buffer.from(text));

  const result = {
    schema_version: "aurekai.embed.v1",
    embedded_at: now(),
    text_length: text.length,
    text_hash: textHash,
    dims,
    algorithm: "sha256-structural-64d",
    vector: normalized,
    _e8: {
      chart_id: e8.chart_id,
      cell: e8.e8_cell,
      cell_key: e8.cell_key,
      residual_norm: e8.residual_norm,
      witness_hash: e8.witness_hash,
    },
    note: "deterministic structural embedding — not a learned embedding",
  };
  if (asJson) printJson(result);
  else process.stdout.write(`embed.text  dims:${dims}  text_hash:${result.text_hash}  e8_cell:${e8.cell_key}\n  vector: [${normalized.slice(0, 6).join(", ")} ...]\n`);
  return result;
}

export async function artifactStoreCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "emit":      cmdEmitArtifact(rest);            break;
    case "bundle":    cmdDistributeBundle(rest);         break;
    case "resolve":   await cmdEntityResolve(rest);      break;
    case "group":     await cmdFamilyGroup(rest);        break;
    case "compress":  await cmdCompressFamily(rest);     break;
    case "query":     cmdQuerySql(rest);                 break;
    case "embed":     cmdEmbedText(rest);                break;
    default:
      console.error(`  error: unknown artifact-store subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export { cmdEmitArtifact, cmdDistributeBundle, cmdEntityResolve, cmdFamilyGroup,
         cmdCompressFamily, cmdQuerySql, cmdEmbedText };
