/**
 * src/brief-gen.mjs
 *
 * Native implementation of brief.generate (publish family).
 *
 * Reads an input file (JSON, Markdown, plain text, or binary), hashes it,
 * extracts structure, and produces a portable structured brief document.
 *
 * All computation is real: real SHA-256, real content parsing, no generated text.
 * The "generate" step is structural extraction, not AI generation.
 *
 * CLI surface:
 *   akai brief generate --input <file> [--title <text>] [--format json|md]
 *                       [--out <file>] [--json]
 *
 * Output schema: "aurekai.brief.v1"
 *
 * Fields:
 *   schema_version, generated_at, title, source, source_bytes, source_hash,
 *   input_type, structure (type-specific),
 *   summary { line_count, word_count, char_count, top_keys, heading_count }
 */

import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from "node:fs";
import { basename, extname, resolve, dirname } from "node:path";

// ── helpers ──────────────────────────────────────────────────────────────────
function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
}
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

function sha256Buf(buf) {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

// ── content analysis ─────────────────────────────────────────────────────────
function analyzeText(text) {
  const lines = text.split(/\r?\n/);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const headings = lines.filter(l => /^#{1,6}\s/.test(l)).map(l => l.trim());
  const listItems = lines.filter(l => /^[\-\*\+]\s/.test(l.trim())).length;
  const codeBlocks = (text.match(/```/g) || []).length >> 1;
  return {
    line_count: lines.length,
    word_count: words.length,
    char_count: text.length,
    heading_count: headings.length,
    headings: headings.slice(0, 10),
    list_item_count: listItems,
    code_block_count: codeBlocks,
  };
}

function analyzeJson(text) {
  const obj = JSON.parse(text);
  const topKeys = Object.keys(obj);
  const isArray = Array.isArray(obj);
  const depth = measureDepth(obj, 0);
  return {
    top_keys: topKeys.slice(0, 20),
    top_key_count: topKeys.length,
    is_array: isArray,
    array_length: isArray ? obj.length : null,
    max_depth: depth,
    schema_version: obj.schema_version ?? null,
    id: obj.id ?? obj.name ?? obj.slug ?? null,
  };
}

function measureDepth(obj, d) {
  if (d > 10 || typeof obj !== "object" || obj === null) return d;
  const vals = Array.isArray(obj) ? obj : Object.values(obj);
  return Math.max(d, ...vals.map(v => measureDepth(v, d + 1)));
}

function briefMarkdown(brief) {
  const b = brief;
  const lines = [
    `# ${b.title}`,
    ``,
    `**Generated:** ${b.generated_at}  `,
    `**Source:** ${b.source}  `,
    `**Hash:** \`${b.source_hash}\`  `,
    `**Type:** ${b.input_type}  `,
    `**Size:** ${b.source_bytes} bytes`,
    ``,
    `## Summary`,
    ``,
  ];
  const s = b.summary;
  if (s.line_count != null) lines.push(`- Lines: ${s.line_count}`);
  if (s.word_count != null) lines.push(`- Words: ${s.word_count}`);
  if (s.char_count != null) lines.push(`- Characters: ${s.char_count}`);
  if (s.heading_count != null) lines.push(`- Headings: ${s.heading_count}`);
  if (s.top_keys?.length) lines.push(`- Top keys: \`${s.top_keys.join("`, `")}\``);

  if (b.input_type === "json" && b.structure) {
    lines.push(``, `## Structure`);
    lines.push(`- Top-level keys: ${b.structure.top_key_count}`);
    lines.push(`- Max depth: ${b.structure.max_depth}`);
    if (b.structure.schema_version) lines.push(`- Schema version: ${b.structure.schema_version}`);
    if (b.structure.is_array) lines.push(`- Array length: ${b.structure.array_length}`);
  }

  if (b.input_type === "markdown" || b.input_type === "text") {
    const hdgs = b.structure?.headings ?? [];
    if (hdgs.length) {
      lines.push(``, `## Headings`);
      hdgs.forEach(h => lines.push(`- ${h}`));
    }
  }
  return lines.join("\n") + "\n";
}

export function generateBriefArtifact({ inputPath, titleArg = null, format = "json", outPath = null }) {
  const absInput = resolve(process.cwd(), inputPath);
  if (!existsSync(absInput)) {
    throw new Error(`input file not found: ${absInput}`);
  }

  const rawBytes = readFileSync(absInput);
  const sourceHash = sha256Buf(rawBytes);
  const ext = extname(absInput).toLowerCase();
  const text = rawBytes.toString("utf8");

  let inputType, structure;
  try {
    if (ext === ".json" || ext === ".jsonl" || ext === ".aknetlist" || ext === ".akproof") {
      inputType = "json";
      structure = analyzeJson(text);
    } else if (ext === ".md" || ext === ".markdown") {
      inputType = "markdown";
      structure = analyzeText(text);
    } else {
      try {
        JSON.parse(text);
        inputType = "json";
        structure = analyzeJson(text);
      } catch {
        inputType = "text";
        structure = analyzeText(text);
      }
    }
  } catch {
    inputType = "binary";
    structure = { byte_count: rawBytes.length, note: "binary content — structural analysis skipped" };
  }

  const title = titleArg ?? `Brief: ${basename(absInput)}`;
  const summary = {
    line_count: structure.line_count ?? null,
    word_count: structure.word_count ?? null,
    char_count: structure.char_count ?? null,
    heading_count: structure.heading_count ?? null,
    top_keys: structure.top_keys ?? null,
  };

  const brief = {
    schema_version: "aurekai.brief.v1",
    generated_at: now(),
    title,
    source: absInput,
    source_bytes: rawBytes.length,
    source_hash: sourceHash,
    input_type: inputType,
    structure,
    summary,
  };

  const rendered = format === "md" ? briefMarkdown(brief) : JSON.stringify(brief, null, 2);
  let absOut = null;
  if (outPath) {
    absOut = resolve(process.cwd(), outPath);
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, rendered + (format === "md" ? "" : "\n"), "utf8");
  }

  return { brief, rendered, absInput, absOut };
}

// ── brief.generate ───────────────────────────────────────────────────────────
export async function briefCommand(args) {
  const sub = args[0];
  if (sub !== "generate") {
    console.error(`  error: unknown brief subcommand '${sub ?? "(none)"}'.`);
    console.error("  Available: generate");
    process.exitCode = 1;
    return;
  }

  const rest     = args.slice(1);
  const inputPath = flag(rest, "--input") ?? flag(rest, "--in");
  const titleArg  = flag(rest, "--title");
  const format    = flag(rest, "--format") ?? "json";   // "json" | "md"
  const outPath   = flag(rest, "--out");
  const asJson    = hasFlag(rest, "--json");

  if (!inputPath) {
    console.error("  error: brief generate requires --input <file>");
    process.exitCode = 1;
    return;
  }

  let artifact;
  try {
    artifact = generateBriefArtifact({ inputPath, titleArg, format, outPath });
  } catch (err) {
    console.error(`  error: ${err?.message || err}`);
    process.exitCode = 1;
    return;
  }

  const { brief, rendered, absOut } = artifact;

  if (absOut && !asJson) {
    process.stdout.write(`brief written: ${absOut}\n`);
  }

  if (format === "json" || asJson) {
    printJson(brief);
  } else if (format === "md" && !outPath) {
    process.stdout.write(rendered);
  }

  return brief;
}
