import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";

function now() {
  return new Date().toISOString();
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] || null;
}

function parseIntFlag(args, name, fallback) {
  const v = flag(args, name);
  return v == null ? fallback : parseInt(v, 10);
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

function toSourcePath(urlOrPath) {
  if (urlOrPath.startsWith("file://")) return new URL(urlOrPath).pathname;
  return resolve(urlOrPath);
}

async function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return `sha256:${h.digest("hex")}`;
}

async function readRange(urlOrPath, start, endExclusive) {
  if (isHttpUrl(urlOrPath)) {
    const res = await fetch(urlOrPath, {
      headers: {
        Range: `bytes=${start}-${endExclusive - 1}`,
      },
    });
    if (!(res.status === 206 || res.status === 200)) {
      throw new Error(`range request failed: HTTP ${res.status}`);
    }
    const arr = new Uint8Array(await res.arrayBuffer());
    return Buffer.from(arr);
  }

  const p = toSourcePath(urlOrPath);
  const data = readFileSync(p);
  return data.subarray(start, endExclusive);
}

async function totalBytes(urlOrPath) {
  if (isHttpUrl(urlOrPath)) {
    const head = await fetch(urlOrPath, { method: "HEAD" });
    if (!head.ok) throw new Error(`HEAD failed: HTTP ${head.status}`);
    const cl = head.headers.get("content-length");
    if (!cl) throw new Error("missing content-length header");
    return parseInt(cl, 10);
  }

  const p = toSourcePath(urlOrPath);
  return statSync(p).size;
}

async function cmdRange(args) {
  const url = flag(args, "--url") || args[0];
  const out = flag(args, "--out");
  const start = parseIntFlag(args, "--start", null);
  const end = parseIntFlag(args, "--end", null);

  if (!url) throw new Error("fetch range requires --url <source>");
  if (!out) throw new Error("fetch range requires --out <file>");
  if (start == null || end == null) throw new Error("fetch range requires --start <n> and --end <n>");
  if (start < 0 || end <= start) throw new Error("invalid range bounds");

  const bytes = await readRange(url, start, end);
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, bytes);

  const sha = await sha256File(outPath);

  printJson({
    schema_version: "aurekai.fetch.result.v1",
    command: "fetch.range",
    status: "PASS",
    created_at: now(),
    payload: {
      source: url,
      out_path: outPath,
      range: { start, end_exclusive: end },
      bytes_written: bytes.length,
      sha256: sha,
    },
  });
}

async function cmdMultipart(args) {
  const url = flag(args, "--url") || args[0];
  const out = flag(args, "--out");
  const parts = parseIntFlag(args, "--parts", 4);

  if (!url) throw new Error("fetch multipart requires --url <source>");
  if (!out) throw new Error("fetch multipart requires --out <file>");
  if (!Number.isFinite(parts) || parts < 1) throw new Error("--parts must be >= 1");

  const total = await totalBytes(url);
  const outPath = resolve(out);
  const tmpDir = resolve(`${outPath}.parts`);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(dirname(outPath), { recursive: true });

  const chunk = Math.ceil(total / parts);
  const slices = [];
  for (let i = 0; i < parts; i++) {
    const start = i * chunk;
    const end = Math.min((i + 1) * chunk, total);
    if (start >= end) continue;
    slices.push({ i, start, end });
  }

  await Promise.all(
    slices.map(async s => {
      const data = await readRange(url, s.start, s.end);
      const p = join(tmpDir, `part-${String(s.i).padStart(4, "0")}.bin`);
      writeFileSync(p, data);
    }),
  );

  writeFileSync(outPath, Buffer.alloc(0));
  for (const s of slices.sort((a, b) => a.i - b.i)) {
    const p = join(tmpDir, `part-${String(s.i).padStart(4, "0")}.bin`);
    appendFileSync(outPath, readFileSync(p));
  }

  const outSize = statSync(outPath).size;
  const sha = await sha256File(outPath);

  printJson({
    schema_version: "aurekai.fetch.result.v1",
    command: "fetch.multipart",
    status: outSize === total ? "PASS" : "FAIL",
    created_at: now(),
    payload: {
      source: url,
      out_path: outPath,
      total_bytes: total,
      out_bytes: outSize,
      parts_requested: parts,
      parts_written: slices.length,
      sha256: sha,
    },
  });

  if (outSize !== total) process.exitCode = 2;
}

async function cmdResume(args) {
  const url = flag(args, "--url") || args[0];
  const out = flag(args, "--out");

  if (!url) throw new Error("fetch resume requires --url <source>");
  if (!out) throw new Error("fetch resume requires --out <file>");

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });

  const total = await totalBytes(url);
  const existing = existsSync(outPath) ? statSync(outPath).size : 0;

  if (existing > total) {
    throw new Error(`output file larger than source (${existing} > ${total})`);
  }

  if (existing < total) {
    const data = await readRange(url, existing, total);
    appendFileSync(outPath, data);
  }

  const finalSize = existsSync(outPath) ? statSync(outPath).size : 0;
  const sha = finalSize === total ? await sha256File(outPath) : null;

  printJson({
    schema_version: "aurekai.fetch.result.v1",
    command: "fetch.resume",
    status: finalSize === total ? "PASS" : "FAIL",
    created_at: now(),
    payload: {
      source: url,
      out_path: outPath,
      source_bytes: total,
      resumed_from_bytes: existing,
      out_bytes: finalSize,
      completed: finalSize === total,
      sha256: sha,
    },
  });

  if (finalSize !== total) process.exitCode = 2;
}

async function cmdVerify(args) {
  const file = flag(args, "--file") || args[0];
  const expected = flag(args, "--sha256");

  if (!file) throw new Error("fetch verify requires --file <path>");
  if (!expected) throw new Error("fetch verify requires --sha256 <sha256:...>");

  const p = resolve(file);
  if (!existsSync(p)) throw new Error(`file not found: ${file}`);

  const actual = await sha256File(p);
  const pass = actual === expected;

  printJson({
    schema_version: "aurekai.fetch.result.v1",
    command: "fetch.verify",
    status: pass ? "PASS" : "FAIL",
    created_at: now(),
    payload: {
      file: p,
      expected_sha256: expected,
      actual_sha256: actual,
      hash_match: pass,
      bytes: statSync(p).size,
    },
  });

  if (!pass) process.exitCode = 2;
}

function printFetchHelp() {
  console.log("Usage:");
  console.log("  akai fetch range --url <source> --start <N> --end <N> --out <file>");
  console.log("  akai fetch multipart --url <source> --parts <N> --out <file>");
  console.log("  akai fetch resume --url <source> --out <file>");
  console.log("  akai fetch verify --file <file> --sha256 <sha256:...>");
}

export async function fetchCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printFetchHelp();
    return;
  }

  if (sub === "range") return cmdRange(rest);
  if (sub === "multipart") return cmdMultipart(rest);
  if (sub === "resume") return cmdResume(rest);
  if (sub === "verify") return cmdVerify(rest);

  throw new Error(`unknown fetch subcommand '${sub}'`);
}
