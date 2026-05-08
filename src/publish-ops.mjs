/**
 * src/publish-ops.mjs
 *
 * Native publish-family commands:
 *   narrate.brief     — structured narration from a brief JSON (no AI — deterministic)
 *   render.document   — render brief/artifact to Markdown or HTML document
 *   pack.deliverable  — pack files + manifest into a deliverable bundle directory
 *   surface.publish   — publish artifact to a local surface (directory or stdout)
 *   clips.extract     — extract text clips/segments from a transcript or text file
 *   repurpose.content — transform content between formats (json→md, md→json, etc.)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename, extname } from "node:path";
import { generateBriefArtifact } from "./brief-gen.mjs";

const AUREKAI_DIR = join(homedir(), ".aurekai");
const SURFACES_DIR = join(AUREKAI_DIR, "surfaces");

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function sha256(buf) { return "sha256:" + createHash("sha256").update(buf).digest("hex"); }

function resolveOutputPath(outArg, sourceBaseName) {
  const absOut = resolve(outArg);
  const asDirHint = outArg.endsWith("/");

  if (existsSync(absOut)) {
    if (statSync(absOut).isDirectory()) return join(absOut, sourceBaseName);
    return absOut;
  }

  if (asDirHint) return join(absOut, sourceBaseName);
  if (extname(absOut)) return absOut;
  return join(absOut, sourceBaseName);
}

// ── narrate.brief ─────────────────────────────────────────────────────────────
function cmdNarrateBrief(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input");
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");
  const silent = hasFlag(args, "--silent");
  if (!inPath) { console.error("  error: narrate brief requires --in <brief.json>"); process.exitCode = 1; return; }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: file not found: ${absIn}`); process.exitCode = 1; return; }

  let brief;
  try { brief = JSON.parse(readFileSync(absIn, "utf8")); }
  catch { console.error("  error: input must be valid JSON"); process.exitCode = 1; return; }

  const lines = [];
  const title  = brief.title ?? brief.name ?? basename(absIn, extname(absIn));
  const source = brief.source ?? inPath;
  const ts     = brief.generated_at ?? now();
  lines.push(`This is a brief for "${title}", generated on ${ts}.`);
  if (brief.source_bytes) lines.push(`The source document is ${brief.source_bytes.toLocaleString()} bytes.`);
  if (brief.source_hash) lines.push(`Its integrity hash is ${brief.source_hash}.`);
  if (brief.input_type) lines.push(`Content type: ${brief.input_type}.`);
  if (brief.summary?.word_count) lines.push(`It contains ${brief.summary.word_count.toLocaleString()} words across ${brief.summary.line_count?.toLocaleString() ?? "unknown"} lines.`);
  if (brief.summary?.heading_count) lines.push(`There are ${brief.summary.heading_count} headings.`);
  if (brief.structure?.top_keys?.length) lines.push(`Top-level keys: ${brief.structure.top_keys.slice(0, 8).join(", ")}.`);
  if (brief.structure?.schema_version) lines.push(`Schema version declared: ${brief.structure.schema_version}.`);

  const narration = lines.join(" ");
  const result = { schema_version: "aurekai.narration.v1", narrated_at: now(), source: absIn, title, narration };

  if (outArg) {
    const absOut = resolve(outArg);
    ensureDir(dirname(absOut));
    writeFileSync(absOut, asJson ? JSON.stringify(result, null, 2) + "\n" : narration + "\n", "utf8");
    if (!asJson && !silent) process.stderr.write(`narration written: ${absOut}\n`);
  }
  if (asJson && !silent) printJson(result);
  else if (!outArg) process.stdout.write(narration + "\n");
  return result;
}

// ── render.document ───────────────────────────────────────────────────────────
function cmdRenderDocument(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input");
  const format = flag(args, "--format") ?? "md";
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");
  const silent = hasFlag(args, "--silent");
  if (!inPath) { console.error("  error: render document requires --in <file>"); process.exitCode = 1; return; }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: file not found: ${absIn}`); process.exitCode = 1; return; }

  const raw = readFileSync(absIn, "utf8");
  let data;
  try { data = JSON.parse(raw); } catch { data = { _text: raw }; }

  let rendered = "";
  if (format === "md") {
    rendered += `# ${data.title ?? data.name ?? basename(absIn)}\n\n`;
    rendered += `**Generated:** ${data.generated_at ?? now()}  \n`;
    rendered += `**Source hash:** \`${data.source_hash ?? sha256(Buffer.from(raw))}\`\n\n`;
    rendered += "## Content\n\n";
    if (data._text) rendered += data._text;
    else rendered += "```json\n" + JSON.stringify(data, null, 2) + "\n```\n";
  } else if (format === "html") {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    rendered += `<!DOCTYPE html>\n<html><head><title>${esc(data.title ?? basename(absIn))}</title></head>\n<body>\n`;
    rendered += `<h1>${esc(data.title ?? data.name ?? basename(absIn))}</h1>\n`;
    rendered += `<pre>${esc(JSON.stringify(data, null, 2))}</pre>\n</body></html>\n`;
  } else {
    rendered = JSON.stringify(data, null, 2) + "\n";
  }

  const result = { schema_version: "aurekai.render.v1", rendered_at: now(), source: absIn, format, output_bytes: rendered.length };
  if (outArg) {
    const absOut = resolve(outArg);
    ensureDir(dirname(absOut));
    writeFileSync(absOut, rendered, "utf8");
    result.output = absOut;
    if (!asJson && !silent) process.stderr.write(`document rendered: ${absOut}  (${format})\n`);
  }
  if (asJson && !silent) printJson(result);
  else if (!outArg) process.stdout.write(rendered);
  return result;
}

// ── pack.deliverable ──────────────────────────────────────────────────────────
function cmdPackDeliverable(args) {
  const inputs = (flag(args, "--inputs") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const name   = flag(args, "--name") ?? `deliverable-${Date.now()}`;
  const outDir = flag(args, "--out") ?? join(AUREKAI_DIR, "deliverables", name);
  const asJson = hasFlag(args, "--json");

  ensureDir(outDir);
  const packed = [];
  for (const inp of inputs) {
    const absIn = resolve(process.cwd(), inp);
    if (!existsSync(absIn)) { packed.push({ source: inp, status: "MISSING" }); continue; }
    const dest = join(outDir, basename(absIn));
    copyFileSync(absIn, dest);
    const buf = readFileSync(dest);
    packed.push({ source: absIn, dest, status: "PACKED", hash: sha256(buf), size: buf.length });
  }

  const manifest = { schema_version: "aurekai.deliverable.v1", packed_at: now(), name, output_dir: outDir, file_count: packed.length, files: packed, verdict: packed.every(f => f.status === "PACKED") ? "COMPLETE" : "INCOMPLETE" };
  writeFileSync(join(outDir, "deliverable.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  if (asJson) printJson(manifest);
  else process.stdout.write(`deliverable packed: ${outDir}  files: ${packed.length}  verdict: ${manifest.verdict}\n`);
  return manifest;
}

// ── surface.publish ───────────────────────────────────────────────────────────
function cmdSurfacePublish(args) {
  const inPath  = flag(args, "--in") ?? flag(args, "--input");
  const surface = flag(args, "--surface") ?? "local";
  const outArg  = flag(args, "--out");
  const asJson  = hasFlag(args, "--json");
  const silent = hasFlag(args, "--silent");
  if (!inPath) { console.error("  error: surface publish requires --in <file>"); process.exitCode = 1; return; }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: file not found: ${absIn}`); process.exitCode = 1; return; }

  const defaultDir = join(SURFACES_DIR, surface);
  const dest = outArg
    ? resolveOutputPath(outArg, basename(absIn))
    : join(defaultDir, basename(absIn));

  ensureDir(dirname(dest));
  if (resolve(absIn) !== resolve(dest)) {
    copyFileSync(absIn, dest);
  }
  const buf = readFileSync(dest);

  const result = { schema_version: "aurekai.surface.publish.v1", published_at: now(), surface, source: absIn, dest, size: buf.length, hash: sha256(buf), verdict: "PUBLISHED" };
  if (asJson && !silent) printJson(result);
  else if (!silent) process.stderr.write(`published: ${basename(absIn)}  surface: ${surface}  dest: ${dest}\n`);
  return result;
}

function cmdPublishChain(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input");
  const outDir = flag(args, "--out-dir") ?? process.cwd();
  const surface = flag(args, "--surface") ?? "local";
  const stemArg = flag(args, "--stem");
  const briefOutArg = flag(args, "--brief-out");
  const narrationOutArg = flag(args, "--narration-out");
  const renderOutArg = flag(args, "--render-out");
  const publishOutArg = flag(args, "--publish-out");
  const asJson = hasFlag(args, "--json");

  if (!inPath) {
    console.error("  error: publish chain requires --in <file>");
    process.exitCode = 1;
    return;
  }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) {
    console.error(`  error: file not found: ${absIn}`);
    process.exitCode = 1;
    return;
  }

  const stem = stemArg || basename(absIn, extname(absIn));
  const absOutDir = resolve(process.cwd(), outDir);
  const briefOut = briefOutArg ? resolve(process.cwd(), briefOutArg) : join(absOutDir, `${stem}-brief.json`);
  const narrationOut = narrationOutArg ? resolve(process.cwd(), narrationOutArg) : join(absOutDir, `${stem}-narration.json`);
  const renderOut = renderOutArg ? resolve(process.cwd(), renderOutArg) : join(absOutDir, `${stem}-render.md`);
  const publishOut = publishOutArg ? resolve(process.cwd(), publishOutArg) : join(SURFACES_DIR, surface, `${stem}-render.md`);

  let briefArtifact;
  try {
    briefArtifact = generateBriefArtifact({ inputPath: absIn, format: "json", outPath: briefOut });
  } catch (err) {
    console.error(`  error: ${err?.message || err}`);
    process.exitCode = 1;
    return;
  }

  const narration = cmdNarrateBrief(["--in", briefOut, "--out", narrationOut, "--json", "--silent"]);
  const rendered = cmdRenderDocument(["--in", narrationOut, "--format", "md", "--out", renderOut, "--silent"]);
  const published = cmdSurfacePublish(["--in", renderOut, "--surface", surface, "--out", publishOut, "--json", "--silent"]);

  const checks = [
    { code: "brief_written", ok: existsSync(briefOut) && statSync(briefOut).size > 0, path: briefOut },
    { code: "narration_written", ok: existsSync(narrationOut) && statSync(narrationOut).size > 0, path: narrationOut },
    { code: "render_written", ok: existsSync(renderOut) && statSync(renderOut).size > 0, path: renderOut },
    { code: "publish_written", ok: existsSync(publishOut) && statSync(publishOut).size > 0, path: publishOut },
    { code: "publish_matches_render", ok: existsSync(renderOut) && existsSync(publishOut) && statSync(renderOut).size === statSync(publishOut).size, render_bytes: existsSync(renderOut) ? statSync(renderOut).size : null, publish_bytes: existsSync(publishOut) ? statSync(publishOut).size : null },
  ];
  const verdict = checks.every(item => item.ok) ? "PASS" : "FAIL";

  const result = {
    schema_version: "aurekai.publish.chain.v1",
    chained_at: now(),
    input: absIn,
    surface,
    outputs: {
      brief: briefOut,
      narration: narrationOut,
      render: renderOut,
      publish: publishOut,
    },
    artifacts: {
      brief: briefArtifact.brief,
      narration,
      render: rendered,
      publish: published,
    },
    checks,
    verdict,
  };

  if (asJson) printJson(result);
  else process.stdout.write(`publish.chain  verdict:${verdict}  render:${renderOut}  publish:${publishOut}\n`);

  if (verdict !== "PASS") process.exitCode = 2;
  return result;
}

// ── clips.extract ─────────────────────────────────────────────────────────────
function cmdClipsExtract(args) {
  const inPath      = flag(args, "--in") ?? flag(args, "--input");
  const maxLengthS  = parseInt(flag(args, "--max-length") ?? "100", 10);
  const minLengthS  = parseInt(flag(args, "--min-length") ?? "10", 10);
  const outArg      = flag(args, "--out");
  const asJson      = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: clips extract requires --in <file>"); process.exitCode = 1; return; }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: file not found: ${absIn}`); process.exitCode = 1; return; }

  const text = readFileSync(absIn, "utf8");
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) ?? text.split(/\n+/).filter(Boolean);
  const clips = sentences
    .map(s => s.trim())
    .filter(s => s.length >= minLengthS && s.length <= maxLengthS)
    .map((text, i) => ({ clip_id: i + 1, text, length: text.length, hash: sha256(Buffer.from(text)).slice(0, 20) }));

  const result = { schema_version: "aurekai.clips.v1", extracted_at: now(), source: absIn, total_clips: clips.length, clips };
  if (outArg) { ensureDir(dirname(resolve(outArg))); writeFileSync(resolve(outArg), JSON.stringify(result, null, 2) + "\n", "utf8"); if (!asJson) process.stdout.write(`clips written: ${resolve(outArg)}  (${clips.length} clips)\n`); }
  if (asJson) printJson(result);
  else if (!outArg) { process.stdout.write(`clips extracted: ${clips.length}\n`); for (const c of clips.slice(0, 10)) process.stdout.write(`  [${c.clip_id}] ${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}\n`); }
  return result;
}

// ── repurpose.content ─────────────────────────────────────────────────────────
function cmdRepurposeContent(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input");
  const toFmt  = flag(args, "--to") ?? flag(args, "--format") ?? "md";
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: repurpose content requires --in <file> --to <format>"); process.exitCode = 1; return; }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: file not found: ${absIn}`); process.exitCode = 1; return; }

  const raw = readFileSync(absIn, "utf8");
  const srcFmt = extname(absIn).replace(".", "") || "unknown";
  let output = "";

  if (toFmt === "md") {
    if (srcFmt === "json") {
      try {
        const data = JSON.parse(raw);
        const title = data.title ?? data.name ?? basename(absIn);
        output = `# ${title}\n\n`;
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "string" || typeof v === "number") output += `**${k}:** ${v}\n`;
        }
      } catch { output = raw; }
    } else { output = raw; }
  } else if (toFmt === "json") {
    if (srcFmt === "md" || srcFmt === "txt") {
      const lines = raw.split(/\r?\n/);
      const title = lines.find(l => /^#\s/.test(l))?.replace(/^#+\s*/, "") ?? basename(absIn, extname(absIn));
      const words = raw.trim().split(/\s+/).length;
      output = JSON.stringify({ schema_version: "aurekai.repurposed.v1", title, source: absIn, format_from: srcFmt, format_to: toFmt, word_count: words, repurposed_at: now(), content: raw }, null, 2) + "\n";
    } else { output = JSON.stringify({ content: raw, source: absIn }, null, 2) + "\n"; }
  } else { output = raw; }

  const result = { schema_version: "aurekai.repurpose.v1", repurposed_at: now(), source: absIn, format_from: srcFmt, format_to: toFmt, output_bytes: output.length };
  if (outArg) { ensureDir(dirname(resolve(outArg))); writeFileSync(resolve(outArg), output, "utf8"); result.output = resolve(outArg); if (!asJson) process.stdout.write(`repurposed: ${absIn} → ${resolve(outArg)}  (${srcFmt} → ${toFmt})\n`); }
  if (asJson) printJson(result);
  else if (!outArg) process.stdout.write(output);
  return result;
}

export async function publishCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "chain":     cmdPublishChain(rest);       break;
    case "narrate":   cmdNarrateBrief(rest);     break;
    case "render":    cmdRenderDocument(rest);    break;
    case "pack":      cmdPackDeliverable(rest);   break;
    case "publish":   cmdSurfacePublish(rest);    break;
    case "clips":     cmdClipsExtract(rest);      break;
    case "repurpose": cmdRepurposeContent(rest);  break;
    default:
      console.error(`  error: unknown publish subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export { cmdNarrateBrief, cmdRenderDocument, cmdPackDeliverable, cmdSurfacePublish,
         cmdClipsExtract, cmdRepurposeContent, cmdPublishChain };
