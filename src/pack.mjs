import { createHash } from "node:crypto";
import {
  createReadStream,
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
import { chunkBufferCdc } from "./chunking.mjs";
import { compileManifestBinary, parseManifestBinary } from "./manifest-bin.mjs";

const PACK_MAGIC = Buffer.from("AKPACKV2", "ascii");
const HEADER_LEN = PACK_MAGIC.length + 16;

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

  const fileEntries = [];
  const uniqueChunks = [];
  const chunkByHash = new Map();

  for (const input of inputFiles) {
    const p = resolve(input);
    if (!existsSync(p)) throw new Error(`input not found: ${input}`);
    const st = statSync(p);
    if (!st.isFile()) throw new Error(`input is not a file: ${input}`);
    const hashes = await hashFile(p);
    const content = readFileSync(p);
    const chunks = chunkBufferCdc(content);
    const chunkRefs = [];

    for (const chunk of chunks) {
      const key = chunk.hashes.blake3;
      if (!chunkByHash.has(key)) {
        chunkByHash.set(key, uniqueChunks.length);
        uniqueChunks.push({
          blake3: chunk.hashes.blake3,
          sha256: chunk.hashes.sha256,
          size_bytes: chunk.length,
          logical_ref_count: 0,
          data: chunk.buffer,
          pack_offset_bytes: 0,
        });
      }
      const chunkIndex = chunkByHash.get(key);
      uniqueChunks[chunkIndex].logical_ref_count += 1;
      chunkRefs.push(chunkIndex);
    }

    fileEntries.push({
      name: basename(p),
      source_path: p,
      size_bytes: st.size,
      sha256: hashes.sha256,
      blake2b: hashes.blake2b,
      chunk_refs: chunkRefs,
    });
  }

  fileEntries.sort((a, b) => a.size_bytes - b.size_bytes);

  let packOffset = 0;
  for (const chunk of uniqueChunks) {
    chunk.pack_offset_bytes = packOffset;
    packOffset += chunk.size_bytes;
  }

  let firstChunkIndex = 0;
  const regions = fileEntries.map(file => {
    const region = {
      name: file.name,
      source_path: file.source_path,
      logical_size_bytes: file.size_bytes,
      sha256: file.sha256,
      chunk_refs: file.chunk_refs,
      first_chunk_index: firstChunkIndex,
      chunk_count: file.chunk_refs.length,
    };
    firstChunkIndex += file.chunk_refs.length;
    return region;
  });

  const metadata = {
    schema_version: "aurekai.pack.v2",
    created_at: now(),
    layout: {
      strategy: "size-ascending-region-first",
      chunking: "content-defined",
      hash: "blake3",
      binary_manifest: true,
    },
    file_count: fileEntries.length,
    region_count: regions.length,
    unique_chunk_count: uniqueChunks.length,
    logical_payload_bytes: fileEntries.reduce((s, f) => s + f.size_bytes, 0),
    stored_payload_bytes: uniqueChunks.reduce((s, c) => s + c.size_bytes, 0),
    dedupe_ratio: Number((fileEntries.reduce((s, f) => s + f.size_bytes, 0) / Math.max(1, uniqueChunks.reduce((s, c) => s + c.size_bytes, 0))).toFixed(4)),
    regions: regions.map(region => ({
      name: region.name,
      source_path: region.source_path,
      logical_size_bytes: region.logical_size_bytes,
      sha256: region.sha256,
      chunk_refs: region.chunk_refs,
      first_chunk_index: region.first_chunk_index,
      chunk_count: region.chunk_count,
    })),
    chunks: uniqueChunks.map(chunk => ({
      blake3: chunk.blake3,
      sha256: chunk.sha256,
      size_bytes: chunk.size_bytes,
      logical_ref_count: chunk.logical_ref_count,
      pack_offset_bytes: chunk.pack_offset_bytes,
    })),
    files: regions.map(region => ({
      name: region.name,
      size_bytes: region.logical_size_bytes,
      sha256: region.sha256,
      chunk_count: region.chunk_count,
    })),
  };

  const metadataBuf = Buffer.from(JSON.stringify(metadata), "utf8");
  const draftBinaryManifest = compileManifestBinary({
    regions: regions.map(region => ({
      name: region.name,
      first_chunk_index: region.first_chunk_index,
      chunk_count: region.chunk_count,
      logical_size_bytes: region.logical_size_bytes,
    })),
    chunks: uniqueChunks.map(chunk => ({
      blake3: chunk.blake3,
      pack_offset_bytes: 0,
      size_bytes: chunk.size_bytes,
      logical_ref_count: chunk.logical_ref_count,
    })),
  });
  const makeAbsoluteChunks = payloadStart => uniqueChunks.map(chunk => ({
    blake3: chunk.blake3,
    sha256: chunk.sha256,
    size_bytes: chunk.size_bytes,
    logical_ref_count: chunk.logical_ref_count,
    pack_offset_bytes: payloadStart + chunk.pack_offset_bytes,
  }));

  let finalizedMetadata = null;
  let finalizedMetadataBuf = null;
  let metadataLength = metadataBuf.length;

  while (true) {
    const payloadStart = HEADER_LEN + metadataLength + draftBinaryManifest.length;
    const candidateMetadata = {
      ...metadata,
      binary_manifest_bytes: draftBinaryManifest.length,
      payload_start_bytes: payloadStart,
      chunks: makeAbsoluteChunks(payloadStart),
    };
    const candidateBuf = Buffer.from(JSON.stringify(candidateMetadata), "utf8");
    if (candidateBuf.length === metadataLength) {
      finalizedMetadata = candidateMetadata;
      finalizedMetadataBuf = candidateBuf;
      break;
    }
    metadataLength = candidateBuf.length;
  }

  const binaryManifest = compileManifestBinary({
    regions: regions.map(region => ({
      name: region.name,
      first_chunk_index: region.first_chunk_index,
      chunk_count: region.chunk_count,
      logical_size_bytes: region.logical_size_bytes,
    })),
    chunks: uniqueChunks.map(chunk => ({
      blake3: chunk.blake3,
      pack_offset_bytes: chunk.pack_offset_bytes,
      size_bytes: chunk.size_bytes,
      logical_ref_count: chunk.logical_ref_count,
    })),
  });

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });

  const rewriteFd = openSync(outPath, "w");
  writeSync(rewriteFd, Buffer.concat([
    PACK_MAGIC,
    writeU64LE(finalizedMetadataBuf.length),
    writeU64LE(binaryManifest.length),
  ]));
  writeSync(rewriteFd, finalizedMetadataBuf);
  writeSync(rewriteFd, binaryManifest);

  for (const chunk of uniqueChunks) {
    writeSync(rewriteFd, chunk.data);
  }
  closeSync(rewriteFd);

  const outHashes = await hashFile(outPath);
  const outStat = statSync(outPath);

  printJson({
    schema_version: "aurekai.pack.result.v1",
    command: "pack.build",
    status: "PASS",
    created_at: now(),
    payload: {
      output: outPath,
      file_count: fileEntries.length,
      region_count: regions.length,
      unique_chunk_count: uniqueChunks.length,
      metadata_bytes: metadataBuf.length,
      binary_manifest_bytes: binaryManifest.length,
      logical_payload_bytes: finalizedMetadata.logical_payload_bytes,
      stored_payload_bytes: finalizedMetadata.stored_payload_bytes,
      dedupe_ratio: finalizedMetadata.dedupe_ratio,
      pack_bytes: outStat.size,
      sha256: outHashes.sha256,
      blake2b: outHashes.blake2b,
      files: finalizedMetadata.files.map(f => ({ name: f.name, size_bytes: f.size_bytes, chunk_count: f.chunk_count })),
    },
  });
}

export function readPackIndex(packPath) {
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
  const binLenBuf = Buffer.alloc(8);
  readSync(fd, binLenBuf, 0, 8, PACK_MAGIC.length + 8);
  const binaryManifestLen = readU64LE(binLenBuf, 0);

  const metadataStart = HEADER_LEN;
  const metaBuf = Buffer.alloc(metadataLen);
  readSync(fd, metaBuf, 0, metadataLen, metadataStart);
  const metadataRaw = metaBuf.toString("utf8");
  const metadata = JSON.parse(metadataRaw);

  const binaryManifestStart = metadataStart + metadataLen;
  const binaryManifestBuf = Buffer.alloc(binaryManifestLen);
  readSync(fd, binaryManifestBuf, 0, binaryManifestLen, binaryManifestStart);
  const binaryManifest = parseManifestBinary(binaryManifestBuf);

  closeSync(fd);

  return {
    packPath: p,
    metadata,
    metadataLen,
    binaryManifest,
    binaryManifestLen,
    payloadStart: HEADER_LEN + metadataLen + binaryManifestLen,
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
      binary_manifest_bytes: idx.binaryManifestLen,
      binary_manifest: idx.binaryManifest,
      payload_start: idx.payloadStart,
      payload_bytes: idx.metadata.stored_payload_bytes,
      pack_bytes: idx.packSize,
      file_count: idx.metadata.file_count,
      unique_chunk_count: idx.metadata.unique_chunk_count,
      regions: idx.metadata.regions,
      chunks: idx.metadata.chunks,
      files: idx.metadata.files,
    },
  });
}

function readPackBytes(packPath, start, length) {
  const fd = openSync(packPath, "r");
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return buf;
  } finally {
    closeSync(fd);
  }
}

async function materializePack(args) {
  const packPath = args[0];
  if (!packPath) throw new Error("pack materialize requires <file.akpack>");

  const outDir = resolve(flag(args, "--out-dir") || ".");
  const oneFile = flag(args, "--file");
  const verify = hasFlag(args, "--verify");

  const idx = readPackIndex(packPath);

  const targets = oneFile
    ? idx.metadata.regions.filter(f => f.name === oneFile)
    : idx.metadata.regions;

  if (targets.length === 0) {
    throw new Error(oneFile ? `file '${oneFile}' not found in pack` : "pack has no files");
  }

  const extracted = [];
  for (const f of targets) {
    const outPath = join(outDir, f.name);
    mkdirSync(dirname(outPath), { recursive: true });

    const fd = openSync(outPath, "w");
    try {
      for (const chunkRef of f.chunk_refs) {
        const chunk = idx.metadata.chunks[chunkRef];
        const data = readPackBytes(idx.packPath, chunk.pack_offset_bytes, chunk.size_bytes);
        writeSync(fd, data);
      }
    } finally {
      closeSync(fd);
    }

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
