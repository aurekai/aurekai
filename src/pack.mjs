import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
  closeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const PACK_MAGIC = Buffer.from("AKPACKV1", "ascii");
const HEADER_LEN = PACK_MAGIC.length + 8;

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

function hasFlag(args, name) {
  return args.includes(name);
}

function readU64LE(buf, offset) {
  return Number(buf.readBigUInt64LE(offset));
}

function writeU64LE(value) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value), 0);
  return b;
}

async function hashFile(path) {
  const sha256 = createHash("sha256");
  const blake2b = createHash("blake2b512");

  const stream = createReadStream(path);
  await new Promise((resolveP, rejectP) => {
    stream.on("data", chunk => {
      sha256.update(chunk);
      blake2b.update(chunk);
    });
    stream.on("error", rejectP);
    stream.on("end", resolveP);
  });

  return {
    sha256: `sha256:${sha256.digest("hex")}`,
    blake2b: `blake2b512:${blake2b.digest("hex")}`,
  };
}

function parseInputFiles(args) {
  const inputs = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      if (["--out", "--inputs", "--out-dir", "--file"].includes(a)) i += 1;
      continue;
    }
    inputs.push(a);
  }

  const csv = flag(args, "--inputs");
  if (csv) {
    for (const part of csv.split(",").map(x => x.trim()).filter(Boolean)) {
      inputs.push(part);
    }
  }

  return [...new Set(inputs)];
}

async function buildPack(args) {
  const out = flag(args, "--out");
  if (!out) throw new Error("pack build requires --out <file.akpack>");

  const inputFiles = parseInputFiles(args);
  if (inputFiles.length === 0) {
    throw new Error("pack build requires at least one input file");
  }

  const files = [];
  let offset = 0;

  for (const input of inputFiles) {
    const p = resolve(input);
    if (!existsSync(p)) throw new Error(`input not found: ${input}`);
    const st = statSync(p);
    if (!st.isFile()) throw new Error(`input is not a file: ${input}`);
    const hashes = await hashFile(p);

    files.push({
      name: basename(p),
      source_path: p,
      size_bytes: st.size,
      offset_bytes: offset,
      sha256: hashes.sha256,
      blake2b: hashes.blake2b,
    });
    offset += st.size;
  }

  const metadata = {
    schema_version: "aurekai.pack.v1",
    created_at: now(),
    file_count: files.length,
    payload_bytes: files.reduce((s, f) => s + f.size_bytes, 0),
    files,
  };

  const metadataBuf = Buffer.from(JSON.stringify(metadata), "utf8");
  const header = Buffer.concat([PACK_MAGIC, writeU64LE(metadataBuf.length)]);

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });

  const fd = openSync(outPath, "w");
  writeSync(fd, header);
  writeSync(fd, metadataBuf);
  closeSync(fd);

  for (const entry of files) {
    await new Promise((resolveP, rejectP) => {
      const r = createReadStream(entry.source_path);
      const w = createWriteStream(outPath, { flags: "a" });
      r.on("error", rejectP);
      w.on("error", rejectP);
      w.on("finish", resolveP);
      r.pipe(w);
    });
  }

  const outHashes = await hashFile(outPath);
  const outStat = statSync(outPath);

  printJson({
    schema_version: "aurekai.pack.result.v1",
    command: "pack.build",
    status: "PASS",
    created_at: now(),
    payload: {
      output: outPath,
      file_count: files.length,
      metadata_bytes: metadataBuf.length,
      payload_bytes: metadata.payload_bytes,
      pack_bytes: outStat.size,
      sha256: outHashes.sha256,
      blake2b: outHashes.blake2b,
      files: files.map(f => ({ name: f.name, size_bytes: f.size_bytes, offset_bytes: f.offset_bytes })),
    },
  });
}

function readPackIndex(packPath) {
  const p = resolve(packPath);
  if (!existsSync(p)) throw new Error(`pack not found: ${packPath}`);

  const fd = openSync(p, "r");
  const magic = Buffer.alloc(PACK_MAGIC.length);
  readSync(fd, magic, 0, PACK_MAGIC.length, 0);

  if (!magic.equals(PACK_MAGIC)) {
    closeSync(fd);
    throw new Error("invalid pack magic");
  }

  const lenBuf = Buffer.alloc(8);
  readSync(fd, lenBuf, 0, 8, PACK_MAGIC.length);
  const metadataLen = readU64LE(lenBuf, 0);

  const metadataStart = HEADER_LEN;
  const metaBuf = Buffer.alloc(metadataLen);
  readSync(fd, metaBuf, 0, metadataLen, metadataStart);
  const metadataRaw = metaBuf.toString("utf8");
  const metadata = JSON.parse(metadataRaw);

  closeSync(fd);

  return {
    packPath: p,
    metadata,
    metadataLen,
    payloadStart: HEADER_LEN + metadataLen,
    packSize: statSync(p).size,
  };
}

async function inspectPack(args) {
  const packPath = args[0];
  if (!packPath) throw new Error("pack inspect requires <file.akpack>");

  const idx = readPackIndex(packPath);

  printJson({
    schema_version: "aurekai.pack.result.v1",
    command: "pack.inspect",
    status: "PASS",
    created_at: now(),
    payload: {
      pack_path: idx.packPath,
      schema_version: idx.metadata.schema_version,
      metadata_bytes: idx.metadataLen,
      payload_start: idx.payloadStart,
      payload_bytes: idx.metadata.payload_bytes,
      pack_bytes: idx.packSize,
      file_count: idx.metadata.file_count,
      files: idx.metadata.files.map(f => ({
        name: f.name,
        size_bytes: f.size_bytes,
        offset_bytes: f.offset_bytes,
        sha256: f.sha256,
      })),
    },
  });
}

async function copyRange(packPath, start, length, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });

  await new Promise((resolveP, rejectP) => {
    const r = createReadStream(packPath, { start, end: start + length - 1 });
    const w = createWriteStream(outPath, { flags: "w" });
    r.on("error", rejectP);
    w.on("error", rejectP);
    w.on("finish", resolveP);
    r.pipe(w);
  });
}

async function materializePack(args) {
  const packPath = args[0];
  if (!packPath) throw new Error("pack materialize requires <file.akpack>");

  const outDir = resolve(flag(args, "--out-dir") || ".");
  const oneFile = flag(args, "--file");
  const verify = hasFlag(args, "--verify");

  const idx = readPackIndex(packPath);

  const targets = oneFile
    ? idx.metadata.files.filter(f => f.name === oneFile)
    : idx.metadata.files;

  if (targets.length === 0) {
    throw new Error(oneFile ? `file '${oneFile}' not found in pack` : "pack has no files");
  }

  const extracted = [];
  for (const f of targets) {
    const absStart = idx.payloadStart + f.offset_bytes;
    const outPath = join(outDir, f.name);
    await copyRange(idx.packPath, absStart, f.size_bytes, outPath);

    let hashOk = null;
    if (verify) {
      const h = await hashFile(outPath);
      hashOk = h.sha256 === f.sha256;
      if (!hashOk) throw new Error(`verification failed for '${f.name}'`);
    }

    extracted.push({
      name: f.name,
      out_path: outPath,
      size_bytes: statSync(outPath).size,
      verified: hashOk,
    });
  }

  printJson({
    schema_version: "aurekai.pack.result.v1",
    command: "pack.materialize",
    status: "PASS",
    created_at: now(),
    payload: {
      pack_path: idx.packPath,
      out_dir: outDir,
      extracted_count: extracted.length,
      extracted,
      verify,
    },
  });
}

function printPackHelp() {
  console.log("Usage:");
  console.log("  akai pack build <file1> [file2 ...] --out <bundle.akpack>");
  console.log("  akai pack build --inputs <f1,f2,...> --out <bundle.akpack>");
  console.log("  akai pack inspect <bundle.akpack>");
  console.log("  akai pack materialize <bundle.akpack> [--out-dir <dir>] [--file <name>] [--verify]");
}

export async function packCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printPackHelp();
    return;
  }

  if (sub === "build") return buildPack(rest);
  if (sub === "inspect") return inspectPack(rest);
  if (sub === "materialize") return materializePack(rest);

  throw new Error(`unknown pack subcommand '${sub}'`);
}
