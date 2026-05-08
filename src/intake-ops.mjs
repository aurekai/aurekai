/**
 * src/intake-ops.mjs
 *
 * Native intake-family commands:
 *   ingest.file          — ingest a file into the intake store with hash + index
 *   paragraph.reflow     — reflow paragraph text (real text processing)
 *   transcript.clean     — clean up a transcript (deduplicate, trim, normalize)
 *   speech_loop.transform — transform speech/text (case, slug, trim)
 *   media_prep.normalize  — normalize audio/video via ffmpeg (if available)
 *   transcribe.audio     — transcribe via whisper/ffmpeg (if available); honest error if not
 *   frame_extract.video  — extract frames via ffmpeg (if available)
 *   video_demux.split    — split/demux video via ffmpeg (if available)
 *   scene_detect.video   — scene detection via ffmpeg (if available)
 *   segment.speakers     — speaker segmentation stub (requires pyannote)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, basename, extname } from "node:path";
import { spawnSync } from "node:child_process";

const AUREKAI_DIR = join(homedir(), ".aurekai");
const INTAKE_DIR  = join(AUREKAI_DIR, "intake");

function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null; }
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function sha256(buf) { return "sha256:" + createHash("sha256").update(buf).digest("hex"); }
function hasBin(name) { return spawnSync("which", [name], { encoding: "utf8" }).status === 0; }

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, out);
    else out.push(fullPath);
  }
  return out;
}

// ── ingest.file ───────────────────────────────────────────────────────────────
function cmdIngestFile(args) {
  const inPath  = flag(args, "--in") ?? flag(args, "--input") ?? args.find(a => !a.startsWith("--"));
  const tag     = flag(args, "--tag") ?? "";
  const asJson  = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: ingest file requires --in <file>"); process.exitCode = 1; return; }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) { console.error(`  error: file not found: ${absIn}`); process.exitCode = 1; return; }

  const buf  = readFileSync(absIn);
  const hash = sha256(buf);
  const hashHex = hash.replace("sha256:", "");
  const ext  = extname(absIn);
  const destDir = join(INTAKE_DIR, hashHex.slice(0, 2));
  ensureDir(destDir);
  const destFile = join(destDir, `${hashHex}${ext}`);
  writeFileSync(destFile, buf);

  const manifest = { schema_version: "aurekai.intake.v1", ingested_at: now(), source: absIn, dest: destFile, size: buf.length, hash, ext, tag: tag || null };
  writeFileSync(destFile + ".meta.json", JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const result = { ...manifest, verdict: "INGESTED" };
  if (asJson) printJson(result);
  else process.stdout.write(`ingested: ${absIn}  hash: ${hashHex.slice(0, 12)}  dest: ${destFile}\n`);
  return result;
}

// ── intake.resolve ───────────────────────────────────────────────────────────
function cmdIntakeResolve(args) {
  const sourceMatch = flag(args, "--source-match") ?? flag(args, "--match") ?? args.find(a => !a.startsWith("--")) ?? null;
  const hashPrefix = flag(args, "--hash") ?? null;
  const latest = hasFlag(args, "--latest");
  const asJson = hasFlag(args, "--json");

  if (!sourceMatch && !hashPrefix) {
    console.error("  error: intake resolve requires --source-match <text> or --hash <prefix>");
    process.exitCode = 1;
    return;
  }

  const metaFiles = walkFiles(INTAKE_DIR).filter(path => path.endsWith(".meta.json"));
  const query = String(sourceMatch || "").toLowerCase();
  const hashQuery = String(hashPrefix || "").toLowerCase();
  const matches = [];

  for (const metaPath of metaFiles) {
    try {
      const doc = JSON.parse(readFileSync(metaPath, "utf8"));
      const source = String(doc.source || "");
      const dest = String(doc.dest || "");
      const hash = String(doc.hash || "").replace(/^sha256:/, "");
      const haystacks = [source, dest, basename(source), basename(dest), hash].map(value => value.toLowerCase());
      const sourceOk = !query || haystacks.some(value => value.includes(query));
      const hashOk = !hashQuery || hash.startsWith(hashQuery.replace(/^sha256:/, ""));
      if (!sourceOk || !hashOk) continue;

      matches.push({
        schema_version: "aurekai.intake.resolve.match.v1",
        ingested_at: doc.ingested_at || null,
        source,
        dest,
        hash: doc.hash || null,
        size: doc.size || null,
        ext: doc.ext || null,
        meta: metaPath,
      });
    } catch {
      // skip malformed meta files
    }
  }

  matches.sort((a, b) => String(b.ingested_at || "").localeCompare(String(a.ingested_at || "")));
  const resultMatches = latest ? matches.slice(0, 1) : matches;
  const result = {
    schema_version: "aurekai.intake.resolve.v1",
    resolved_at: now(),
    query: sourceMatch,
    hash_prefix: hashPrefix,
    count: resultMatches.length,
    matches: resultMatches,
    verdict: resultMatches.length > 0 ? "RESOLVED" : "NOT_FOUND",
  };

  if (asJson) printJson(result);
  else if (resultMatches.length > 0) resultMatches.forEach(match => process.stdout.write(`${match.dest}\n`));
  else process.stdout.write("\n");
  return result;
}

// ── paragraph.reflow ──────────────────────────────────────────────────────────
function cmdParagraphReflow(args) {
  const inPath    = flag(args, "--in") ?? flag(args, "--input");
  const widthStr  = flag(args, "--width") ?? "80";
  const outArg    = flag(args, "--out");
  const asJson    = hasFlag(args, "--json");
  const text      = inPath ? readFileSync(resolve(process.cwd(), inPath), "utf8") : flag(args, "--text");
  if (!text) { console.error("  error: paragraph reflow requires --in <file> or --text <text>"); process.exitCode = 1; return; }

  const width = parseInt(widthStr, 10) || 80;
  const paragraphs = text.split(/\n\n+/);
  const reflowed = paragraphs.map(para => {
    const words = para.trim().split(/\s+/);
    const lines = []; let current = "";
    for (const w of words) {
      if (current.length + w.length + 1 > width && current) { lines.push(current); current = w; }
      else current = current ? current + " " + w : w;
    }
    if (current) lines.push(current);
    return lines.join("\n");
  }).join("\n\n");

  const result = { schema_version: "aurekai.paragraph.reflow.v1", reflowed_at: now(), original_chars: text.length, reflowed_chars: reflowed.length, width, paragraph_count: paragraphs.length };
  if (outArg) { writeFileSync(resolve(process.cwd(), outArg), reflowed + "\n", "utf8"); if (!asJson) process.stdout.write(`reflowed: ${resolve(process.cwd(), outArg)}\n`); }
  if (asJson) printJson(result);
  else if (!outArg) process.stdout.write(reflowed + "\n");
  return result;
}

// ── transcript.clean ──────────────────────────────────────────────────────────
function cmdTranscriptClean(args) {
  const inPath   = flag(args, "--in") ?? flag(args, "--input");
  const outArg   = flag(args, "--out");
  const asJson   = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: transcript clean requires --in <file>"); process.exitCode = 1; return; }

  const text = readFileSync(resolve(process.cwd(), inPath), "utf8");
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const cleaned = lines
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => { if (seen.has(l)) return false; seen.add(l); return true; })
    // Normalize common transcript artifacts
    .map(l => l.replace(/\[inaudible\]/gi, "…").replace(/\s+/g, " ").replace(/\bum\b|\buh\b|\ber\b/gi, "").trim())
    .filter(l => l.length > 0);

  const output = cleaned.join("\n");
  if (outArg) { writeFileSync(resolve(process.cwd(), outArg), output + "\n", "utf8"); if (!asJson) process.stdout.write(`transcript cleaned: ${resolve(process.cwd(), outArg)}  (${lines.length} → ${cleaned.length} lines)\n`); }
  const result = { schema_version: "aurekai.transcript.clean.v1", cleaned_at: now(), source: resolve(process.cwd(), inPath), original_lines: lines.length, output_lines: cleaned.length, deduped: lines.length - cleaned.length };
  if (asJson) printJson(result);
  else if (!outArg) process.stdout.write(output + "\n");
  return result;
}

// ── speech_loop.transform ─────────────────────────────────────────────────────
function cmdSpeechLoopTransform(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input");
  const op     = flag(args, "--op") ?? "normalize";
  const outArg = flag(args, "--out");
  const asJson = hasFlag(args, "--json");
  const text   = inPath ? readFileSync(resolve(process.cwd(), inPath), "utf8") : flag(args, "--text") ?? "";
  if (!text) { console.error("  error: requires --in <file> or --text <text>"); process.exitCode = 1; return; }

  const ops = {
    normalize: t => t.replace(/\s+/g, " ").trim(),
    lowercase: t => t.toLowerCase(),
    uppercase: t => t.toUpperCase(),
    slug:      t => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    sentences: t => t.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).join("\n"),
  };
  const transform = ops[op] ?? ops.normalize;
  const output = transform(text);
  if (outArg) { writeFileSync(resolve(process.cwd(), outArg), output, "utf8"); }
  const result = { schema_version: "aurekai.speech.transform.v1", transformed_at: now(), op, input_length: text.length, output_length: output.length };
  if (asJson) printJson(result);
  else if (!outArg) process.stdout.write(output + "\n");
  return result;
}

// ── ffmpeg-dependent commands ─────────────────────────────────────────────────
function ffmpegCheck() {
  return hasBin("ffmpeg") ? null : "NEEDS_FFMPEG";
}

function cmdMediaPrepNormalize(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input") ?? args.find(a => !a.startsWith("--"));
  const outArg = flag(args, "--out") ?? (inPath ? inPath.replace(/(\.[^.]+)$/, ".norm$1") : null);
  const asJson = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: media_prep normalize requires --in <file>"); process.exitCode = 1; return; }

  const need = ffmpegCheck();
  if (need) {
    const r = { schema_version: "aurekai.media.normalize.v1", requested_at: now(), verdict: "NEEDS_EXTERNAL", requires: ["ffmpeg"], note: "Install ffmpeg to run media normalization. Detected: false." };
    if (asJson) printJson(r); else { console.error(`  media_prep normalize: ${need}. Install ffmpeg.`); }
    process.exitCode = 2; return r;
  }

  const absIn = resolve(process.cwd(), inPath);
  const absOut = resolve(process.cwd(), outArg);
  ensureDir(dirname(absOut));
  // audio normalization: -af loudnorm
  const r = spawnSync("ffmpeg", ["-i", absIn, "-af", "loudnorm", "-y", absOut], { encoding: "utf8" });
  const result = { schema_version: "aurekai.media.normalize.v1", normalized_at: now(), source: absIn, output: absOut, exit_code: r.status, verdict: r.status === 0 ? "NORMALIZED" : "FFMPEG_ERROR", ffmpeg_stderr: r.stderr?.slice(0, 500) };
  if (asJson) printJson(result);
  else process.stdout.write(`${result.verdict}  ${absOut}\n`);
  return result;
}

function cmdTranscribeAudio(args) {
  const inPath = flag(args, "--in") ?? flag(args, "--input") ?? args.find(a => !a.startsWith("--"));
  const model  = flag(args, "--model") ?? "base";
  const asJson = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: transcribe audio requires --in <file>"); process.exitCode = 1; return; }

  const hasWhisper  = hasBin("whisper");
  const hasWhisperCpp = hasBin("whisper-cpp") || hasBin("whisper_cpp");
  const hasAny = hasWhisper || hasWhisperCpp;

  if (!hasAny) {
    const r = { schema_version: "aurekai.transcribe.v1", requested_at: now(), source: inPath, verdict: "NEEDS_EXTERNAL", requires: ["whisper", "whisper-cpp"], note: "Install openai-whisper (pip install openai-whisper) or whisper.cpp to transcribe audio." };
    if (asJson) printJson(r); else { console.error(`  transcribe.audio: NEEDS_EXTERNAL.`); console.error(`  Install: pip install openai-whisper`); }
    process.exitCode = 2; return r;
  }

  const bin  = hasWhisper ? "whisper" : "whisper-cpp";
  const absIn = resolve(process.cwd(), inPath);
  const r = spawnSync(bin, [absIn, "--model", model, "--output_format", "json"], { encoding: "utf8" });
  const result = { schema_version: "aurekai.transcribe.v1", transcribed_at: now(), source: absIn, model, backend: bin, exit_code: r.status, verdict: r.status === 0 ? "TRANSCRIBED" : "BACKEND_ERROR", stdout: r.stdout?.slice(0, 2000), stderr: r.stderr?.slice(0, 500) };
  if (asJson) printJson(result);
  else process.stdout.write(r.status === 0 ? r.stdout ?? "" : `  BACKEND_ERROR (exit ${r.status})\n`);
  return result;
}

function ffmpegCmd(name, ffmpegArgs, outField, schema, asJson, extra = {}) {
  const need = ffmpegCheck();
  if (need) {
    const r = { schema_version: schema, requested_at: now(), verdict: "NEEDS_EXTERNAL", requires: ["ffmpeg"], ...extra };
    if (asJson) printJson(r); else console.error(`  ${name}: NEEDS_EXTERNAL. Install ffmpeg.`);
    process.exitCode = 2; return r;
  }
  const r = spawnSync("ffmpeg", ffmpegArgs, { encoding: "utf8" });
  const result = { schema_version: schema, executed_at: now(), exit_code: r.status, verdict: r.status === 0 ? "SUCCESS" : "FFMPEG_ERROR", stderr: r.stderr?.slice(0, 500), ...extra };
  if (asJson) printJson(result); else process.stdout.write(`${result.verdict}  (exit ${r.status})\n`);
  return result;
}

function cmdFrameExtract(args) {
  const inPath = flag(args, "--in") ?? args.find(a => !a.startsWith("--"));
  const fps    = flag(args, "--fps") ?? "1";
  const outDir = flag(args, "--out") ?? join(process.cwd(), "frames");
  const asJson = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: frame extract requires --in <file>"); process.exitCode = 1; return; }
  ensureDir(outDir);
  return ffmpegCmd("frame_extract.video", ["-i", resolve(process.cwd(), inPath), "-vf", `fps=${fps}`, join(outDir, "frame_%04d.png"), "-y"], outDir, "aurekai.frame.extract.v1", asJson, { source: inPath, fps, output_dir: outDir });
}

function cmdVideoDemux(args) {
  const inPath  = flag(args, "--in") ?? args.find(a => !a.startsWith("--"));
  const outDir  = flag(args, "--out") ?? join(process.cwd(), "demux");
  const asJson  = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: video demux requires --in <file>"); process.exitCode = 1; return; }
  ensureDir(outDir);
  const absIn = resolve(process.cwd(), inPath);
  const audioOut = join(outDir, "audio.aac");
  const videoOut = join(outDir, "video.mp4");
  // Two-pass: extract audio then video
  spawnSync("ffmpeg", ["-i", absIn, "-vn", "-acodec", "copy", audioOut, "-y"], { encoding: "utf8" });
  const r = spawnSync("ffmpeg", ["-i", absIn, "-an", "-vcodec", "copy", videoOut, "-y"], { encoding: "utf8" });
  const need = ffmpegCheck();
  if (need) { const res = { schema_version: "aurekai.video.demux.v1", verdict: "NEEDS_EXTERNAL", requires: ["ffmpeg"] }; if (asJson) printJson(res); else console.error("  video_demux: NEEDS_EXTERNAL. Install ffmpeg."); process.exitCode = 2; return res; }
  const result = { schema_version: "aurekai.video.demux.v1", demuxed_at: now(), source: absIn, audio: audioOut, video: videoOut, exit_code: r.status, verdict: r.status === 0 ? "DEMUXED" : "FFMPEG_ERROR" };
  if (asJson) printJson(result); else process.stdout.write(`${result.verdict}  audio: ${audioOut}  video: ${videoOut}\n`);
  return result;
}

function cmdSceneDetect(args) {
  const inPath    = flag(args, "--in") ?? args.find(a => !a.startsWith("--"));
  const threshold = flag(args, "--threshold") ?? "0.4";
  const outArg    = flag(args, "--out");
  const asJson    = hasFlag(args, "--json");
  if (!inPath) { console.error("  error: scene detect requires --in <file>"); process.exitCode = 1; return; }
  const absIn = resolve(process.cwd(), inPath);
  // Use ffmpeg select filter to detect scene changes
  const r = ffmpegCmd("scene_detect.video",
    ["-i", absIn, "-vf", `select='gt(scene,${threshold})',showinfo`, "-vsync", "vfr", "-f", "null", "-"],
    null, "aurekai.scene.detect.v1", asJson, { source: absIn, threshold });
  // Parse scene timestamps from stderr
  if (r && r.stderr) {
    const timestamps = [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => parseFloat(m[1]));
    r.scene_timestamps = timestamps;
    r.scene_count = timestamps.length;
  }
  return r;
}

function cmdSegmentSpeakers(args) {
  const inPath = flag(args, "--in") ?? args.find(a => !a.startsWith("--"));
  const asJson = hasFlag(args, "--json");
  const hasPyannote = spawnSync("python3", ["-c", "import pyannote.audio"], { encoding: "utf8" }).status === 0;
  const result = {
    schema_version: "aurekai.segment.speakers.v1", requested_at: now(), source: inPath,
    pyannote_available: hasPyannote,
    verdict: hasPyannote ? "READY" : "NEEDS_EXTERNAL",
    requires: hasPyannote ? [] : ["pyannote.audio (pip install pyannote.audio)"],
    note: hasPyannote ? "pyannote.audio detected — run via python3 to perform diarization." : "Install pyannote.audio for speaker diarization. This command requires a Python runtime.",
  };
  if (asJson) printJson(result);
  else { if (!hasPyannote) console.error(`  segment.speakers: NEEDS_EXTERNAL. ${result.note}`); else process.stdout.write(`  pyannote.audio detected. Use Python API for full diarization.\n`); }
  if (!hasPyannote) process.exitCode = 2;
  return result;
}

export async function intakeCommand(args) {
  const sub = args[0]; const rest = args.slice(1);
  switch (sub) {
    case "ingest":       cmdIngestFile(rest);          break;
    case "resolve":      cmdIntakeResolve(rest);       break;
    case "reflow":       cmdParagraphReflow(rest);      break;
    case "clean":        cmdTranscriptClean(rest);      break;
    case "transform":    cmdSpeechLoopTransform(rest);  break;
    case "normalize":    cmdMediaPrepNormalize(rest);   break;
    case "transcribe":   cmdTranscribeAudio(rest);      break;
    case "frames":       cmdFrameExtract(rest);         break;
    case "demux":        cmdVideoDemux(rest);           break;
    case "scene-detect": cmdSceneDetect(rest);          break;
    case "segment":      cmdSegmentSpeakers(rest);      break;
    default:
      console.error(`  error: unknown intake subcommand '${sub ?? "(none)"}'.`);
      process.exitCode = 1;
  }
}

export { cmdIngestFile, cmdParagraphReflow, cmdTranscriptClean, cmdSpeechLoopTransform,
         cmdMediaPrepNormalize, cmdTranscribeAudio, cmdFrameExtract, cmdVideoDemux,
         cmdSceneDetect, cmdSegmentSpeakers, cmdIntakeResolve };
