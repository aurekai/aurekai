import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync, openSync, writeSync, closeSync } from "node:fs";
import { createReadStream } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { Blake3Hasher } from "@napi-rs/blake-hash";
import { chunkBufferCdc, hashStringsToBlake3 } from "./chunking.mjs";

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

function casRoot() {
  return process.env.AKAI_CAS_HOME || join(homedir(), ".aurekai", "cas");
}

function casDirs() {
  const root = casRoot();
  return {
    root,
    blobs: join(root, "blobs"),
    manifests: join(root, "manifests"),
    refs: join(root, "refs"),
    indexes: join(root, "indexes"),
    chunks: join(root, "chunks"),
  };
}

function ensureCasDirs() {
  const d = casDirs();
  mkdirSync(d.blobs, { recursive: true });
  mkdirSync(d.manifests, { recursive: true });
  mkdirSync(d.refs, { recursive: true });
  mkdirSync(d.indexes, { recursive: true });
  mkdirSync(d.chunks, { recursive: true });
  return d;
}

function sanitizeRefName(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "-") || "artifact";
}

async function hashFile(filePath) {
  const sha256 = createHash("sha256");
  const blake2b = createHash("blake2b512");
  const blake3 = new Blake3Hasher();

  const stream = createReadStream(filePath);
  await new Promise((resolveP, rejectP) => {
    stream.on("data", chunk => {
      sha256.update(chunk);
      blake2b.update(chunk);
      blake3.update(chunk);
    });
    stream.on("error", rejectP);
    stream.on("end", resolveP);
  });

  const sha = sha256.digest("hex");
  const b2 = blake2b.digest("hex");
  return {
    sha256: `sha256:${sha}`,
    blake2b: `blake2b512:${b2}`,
    blake3: `blake3:${blake3.digest("hex")}`,
    contentAddress: `ak://sha256:${sha}`,
  };
}

function indexPathForBlake3(rootHash) {
  const d = ensureCasDirs();
  return join(d.indexes, `${String(rootHash || "").replace(/:/g, "-")}.json`);
}

function writeChunkGraph(dirs, srcPath) {
  const content = readFileSync(srcPath);
  const chunkRecords = chunkBufferCdc(content);
  let reusedChunks = 0;

  for (const chunk of chunkRecords) {
    const chunkId = chunk.hashes.blake3.replace("blake3:", "");
    const chunkPath = join(dirs.chunks, chunkId);
    if (existsSync(chunkPath)) {
      reusedChunks += 1;
    } else {
      writeFileSync(chunkPath, chunk.buffer);
    }
  }

  const chunkGraphRoot = hashStringsToBlake3(chunkRecords.map(chunk => `${chunk.hashes.blake3}:${chunk.offset}:${chunk.length}`));
  return {
    chunkGraphRoot,
    reusedChunks,
    chunks: chunkRecords.map(chunk => ({
      index: chunk.index,
      offset: chunk.offset,
      length: chunk.length,
      hashes: chunk.hashes,
      chunk_ref: `ak://blake3:${chunk.hashes.blake3.replace("blake3:", "")}`,
    })),
  };
}

function resolveRef(input) {
  const d = ensureCasDirs();

  if (input.startsWith("ak://blake3:")) {
    const idxPath = indexPathForBlake3(input.replace("ak://", ""));
    if (!existsSync(idxPath)) {
      throw new Error(`index missing for ${input}`);
    }
    const idx = JSON.parse(readFileSync(idxPath, "utf8"));
    const manifestPath = idx.manifest_path;
    if (!existsSync(manifestPath)) {
      throw new Error(`manifest missing for ${input}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { manifest, manifestPath, refName: null };
  }

  if (input.startsWith("ak://sha256:")) {
    const sha = input.replace("ak://sha256:", "");
    const manifestPath = join(d.manifests, `${sha}.json`);
    if (!existsSync(manifestPath)) {
      throw new Error(`manifest missing for ${input}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { manifest, manifestPath, refName: null };
  }

  const refPath = join(d.refs, `${sanitizeRefName(input)}.json`);
  if (!existsSync(refPath)) {
    throw new Error(`unknown ref '${input}'`);
  }

  const refDoc = JSON.parse(readFileSync(refPath, "utf8"));
  const sha = String(refDoc.artifact_id || "").replace("ak://sha256:", "");
  const manifestPath = join(d.manifests, `${sha}.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest missing for ref '${input}'`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return { manifest, manifestPath, refName: sanitizeRefName(input) };
}

async function cmdImport(args) {
  const src = args[0];
  if (!src) throw new Error("cas import requires <artifact-path>");

  const srcPath = resolve(src);
  if (!existsSync(srcPath)) throw new Error(`artifact not found: ${src}`);

  const refArg = flag(args, "--ref");
  const refName = sanitizeRefName(refArg || basename(srcPath));

  const d = ensureCasDirs();
  const st = statSync(srcPath);
  const hashes = await hashFile(srcPath);
  const sha = hashes.sha256.replace("sha256:", "");
  const chunkGraph = writeChunkGraph(d, srcPath);

  const blobPath = join(d.blobs, sha);
  if (!existsSync(blobPath)) {
    copyFileSync(srcPath, blobPath);
  }

  const manifest = {
    schema_version: "aurekai.cas.manifest.v1",
    artifact_id: hashes.contentAddress,
    source_name: basename(srcPath),
    source_path: srcPath,
    size_bytes: st.size,
    hashes,
    chunk_graph: {
      root: `ak://${chunkGraph.chunkGraphRoot}`,
      chunk_count: chunkGraph.chunks.length,
      chunk_bytes: chunkGraph.chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      reused_chunks: chunkGraph.reusedChunks,
      target_chunk_size_bytes: 1024 * 1024,
      chunks: chunkGraph.chunks,
    },
    imported_at: now(),
    storage: {
      blob_path: blobPath,
      manifest_path: join(d.manifests, `${sha}.json`),
      ref_path: join(d.refs, `${refName}.json`),
      chunk_index_path: indexPathForBlake3(chunkGraph.chunkGraphRoot),
    },
  };

  writeFileSync(join(d.manifests, `${sha}.json`), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(indexPathForBlake3(chunkGraph.chunkGraphRoot), JSON.stringify({
    schema_version: "aurekai.cas.chunk_index.v1",
    chunk_graph_root: `ak://${chunkGraph.chunkGraphRoot}`,
    artifact_id: hashes.contentAddress,
    manifest_path: join(d.manifests, `${sha}.json`),
    updated_at: now(),
  }, null, 2) + "\n");
  writeFileSync(join(d.refs, `${refName}.json`), JSON.stringify({
    schema_version: "aurekai.cas.ref.v1",
    ref: refName,
    artifact_id: hashes.contentAddress,
    updated_at: now(),
  }, null, 2) + "\n");

  printJson({
    schema_version: "aurekai.cas.result.v1",
    command: "cas.import",
    status: "PASS",
    payload: {
      ref: refName,
      artifact_id: hashes.contentAddress,
      size_bytes: st.size,
      blob_written: true,
      hash_sha256: hashes.sha256,
      hash_blake2b: hashes.blake2b,
      hash_blake3: hashes.blake3,
      chunk_graph_root: manifest.chunk_graph.root,
      chunk_count: manifest.chunk_graph.chunk_count,
      reused_chunks: manifest.chunk_graph.reused_chunks,
    },
  });
}

async function cmdVerify(args) {
  const input = args[0];
  if (!input) throw new Error("cas verify requires <ref|ak://sha256:...>");

  const d = ensureCasDirs();

  if (existsSync(resolve(input))) {
    const st = statSync(resolve(input));
    const hashes = await hashFile(resolve(input));
    const sha = hashes.sha256.replace("sha256:", "");
    const blobExists = existsSync(join(d.blobs, sha));
    printJson({
      schema_version: "aurekai.cas.result.v1",
      command: "cas.verify",
      status: blobExists ? "PASS" : "WARN",
      payload: {
        mode: "file",
        source_path: resolve(input),
        size_bytes: st.size,
        hash_sha256: hashes.sha256,
        hash_blake2b: hashes.blake2b,
        hash_blake3: hashes.blake3,
        blob_exists: blobExists,
      },
    });
    return;
  }

  const { manifest, refName } = resolveRef(input);
  const sha = String(manifest.hashes.sha256 || "").replace("sha256:", "");
  const blobPath = join(d.blobs, sha);
  if (!existsSync(blobPath)) throw new Error(`blob missing for ${manifest.artifact_id}`);

  const sha256 = createHash("sha256");
  const blake3 = new Blake3Hasher();
  let actualSize = 0;
  let missingChunks = 0;
  let chunkHashMismatches = 0;

  for (const chunk of manifest.chunk_graph?.chunks || []) {
    const chunkId = String(chunk.hashes?.blake3 || "").replace("blake3:", "");
    const chunkPath = join(d.chunks, chunkId);
    if (!existsSync(chunkPath)) {
      missingChunks += 1;
      continue;
    }
    const data = readFileSync(chunkPath);
    const actualChunkSha = createHash("sha256").update(data).digest("hex");
    const expectedChunkSha = String(chunk.hashes.sha256 || "").replace("sha256:", "");
    if (actualChunkSha !== expectedChunkSha) chunkHashMismatches += 1;
    sha256.update(data);
    blake3.update(data);
    actualSize += data.length;
  }

  const actualSha256 = `sha256:${sha256.digest("hex")}`;
  const actualBlake3 = `blake3:${blake3.digest("hex")}`;
  const hashMatch = actualSha256 === manifest.hashes.sha256 && actualBlake3 === manifest.hashes.blake3;
  const sizeMatch = actualSize === manifest.size_bytes;
  const pass = hashMatch && sizeMatch;

  printJson({
    schema_version: "aurekai.cas.result.v1",
    command: "cas.verify",
    status: pass ? "PASS" : "FAIL",
    payload: {
      mode: "cas",
      ref: refName,
      artifact_id: manifest.artifact_id,
      expected_sha256: manifest.hashes.sha256,
      actual_sha256: actualSha256,
      expected_blake3: manifest.hashes.blake3,
      actual_blake3: actualBlake3,
      expected_size_bytes: manifest.size_bytes,
      actual_size_bytes: actualSize,
      hash_match: hashMatch,
      size_match: sizeMatch,
      missing_chunks: missingChunks,
      chunk_hash_mismatches: chunkHashMismatches,
    },
  });

  if (!pass) process.exitCode = 2;
}

async function cmdMaterialize(args) {
  const input = args[0];
  if (!input) throw new Error("cas materialize requires <ref|ak://sha256:...>");

  const out = flag(args, "--out");
  if (!out) throw new Error("cas materialize requires --out <path>");

  const d = ensureCasDirs();
  const { manifest, refName } = resolveRef(input);

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  const fd = openSync(outPath, "w");
  try {
    for (const chunk of manifest.chunk_graph?.chunks || []) {
      const chunkId = String(chunk.hashes?.blake3 || "").replace("blake3:", "");
      const chunkPath = join(d.chunks, chunkId);
      if (!existsSync(chunkPath)) throw new Error(`chunk missing for materialize: ${chunk.hashes.blake3}`);
      writeSync(fd, readFileSync(chunkPath));
    }
  } finally {
    closeSync(fd);
  }

  const st = statSync(outPath);
  printJson({
    schema_version: "aurekai.cas.result.v1",
    command: "cas.materialize",
    status: "PASS",
    payload: {
      ref: refName,
      artifact_id: manifest.artifact_id,
      out_path: outPath,
      size_bytes: st.size,
      hash_sha256: manifest.hashes.sha256,
      hash_blake3: manifest.hashes.blake3,
      chunk_count: manifest.chunk_graph?.chunk_count || 0,
    },
  });
}

async function cmdStats() {
  const d = ensureCasDirs();

  const blobs = readdirSync(d.blobs, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name);
  const manifests = readdirSync(d.manifests, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name);
  const refs = readdirSync(d.refs, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name);
  const chunks = readdirSync(d.chunks, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name);

  const totalBlobBytes = blobs.reduce((sum, name) => sum + statSync(join(d.blobs, name)).size, 0);
  const totalChunkBytes = chunks.reduce((sum, name) => sum + statSync(join(d.chunks, name)).size, 0);
  const manifestDocs = manifests.map(name => JSON.parse(readFileSync(join(d.manifests, name), "utf8")));
  const logicalBytes = manifestDocs.reduce((sum, doc) => sum + (doc.size_bytes || 0), 0);
  const logicalChunkRefs = manifestDocs.reduce((sum, doc) => sum + (doc.chunk_graph?.chunk_count || 0), 0);
  const dedupeRatio = totalChunkBytes > 0 ? Number((logicalBytes / totalChunkBytes).toFixed(4)) : 1;

  printJson({
    schema_version: "aurekai.cas.result.v1",
    command: "cas.stats",
    status: "PASS",
    payload: {
      root: d.root,
      blob_count: blobs.length,
      chunk_count: chunks.length,
      manifest_count: manifests.length,
      ref_count: refs.length,
      total_blob_bytes: totalBlobBytes,
      total_chunk_bytes: totalChunkBytes,
      total_blob_gb: parseFloat((totalBlobBytes / (1024 * 1024 * 1024)).toFixed(6)),
      total_chunk_gb: parseFloat((totalChunkBytes / (1024 * 1024 * 1024)).toFixed(6)),
      logical_artifact_bytes: logicalBytes,
      logical_chunk_references: logicalChunkRefs,
      dedupe_ratio: dedupeRatio,
    },
  });
}

async function cmdGc(args) {
  const dryRun = hasFlag(args, "--dry-run");
  const d = ensureCasDirs();

  const live = new Set();
  for (const entry of readdirSync(d.refs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const doc = JSON.parse(readFileSync(join(d.refs, entry.name), "utf8"));
    const id = String(doc.artifact_id || "");
    if (id.startsWith("ak://sha256:")) live.add(id.replace("ak://sha256:", ""));
  }

  const removed = { blobs: [], manifests: [] };
  const liveChunkIds = new Set();
  const liveChunkRoots = new Set();

  for (const sha of live) {
    const manifestPath = join(d.manifests, `${sha}.json`);
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.chunk_graph?.root) {
      liveChunkRoots.add(String(manifest.chunk_graph.root).replace("ak://", ""));
    }
    for (const chunk of manifest.chunk_graph?.chunks || []) {
      liveChunkIds.add(String(chunk.hashes?.blake3 || "").replace("blake3:", ""));
    }
  }

  for (const entry of readdirSync(d.blobs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const sha = entry.name;
    if (!live.has(sha)) {
      const p = join(d.blobs, sha);
      if (!dryRun) rmSync(p, { force: true });
      removed.blobs.push({ sha256: `sha256:${sha}` });
    }
  }

  for (const entry of readdirSync(d.manifests, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const sha = entry.name.replace(/\.json$/, "");
    if (!live.has(sha)) {
      const p = join(d.manifests, entry.name);
      if (!dryRun) rmSync(p, { force: true });
      removed.manifests.push({ sha256: `sha256:${sha}` });
    }
  }

  removed.chunks = [];
  for (const entry of readdirSync(d.chunks, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const chunkId = entry.name;
    if (!liveChunkIds.has(chunkId)) {
      const p = join(d.chunks, entry.name);
      if (!dryRun) rmSync(p, { force: true });
      removed.chunks.push({ blake3: `blake3:${chunkId}` });
    }
  }

  removed.indexes = [];
  for (const entry of readdirSync(d.indexes, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const idxDoc = JSON.parse(readFileSync(join(d.indexes, entry.name), "utf8"));
    const root = String(idxDoc.chunk_graph_root || "").replace("ak://", "");
    if (!liveChunkRoots.has(root)) {
      const p = join(d.indexes, entry.name);
      if (!dryRun) rmSync(p, { force: true });
      removed.indexes.push({ root: idxDoc.chunk_graph_root });
    }
  }

  printJson({
    schema_version: "aurekai.cas.result.v1",
    command: "cas.gc",
    status: "PASS",
    payload: {
      dry_run: dryRun,
      live_ref_count: live.size,
      removed_blob_count: removed.blobs.length,
      removed_manifest_count: removed.manifests.length,
      removed_chunk_count: removed.chunks.length,
      removed_index_count: removed.indexes.length,
      removed,
    },
  });
}

function printCasHelp() {
  console.log("Usage:");
  console.log("  akai cas import <artifact-path> [--ref <name>]");
  console.log("  akai cas verify <ref|ak://sha256:...|file>");
  console.log("  akai cas materialize <ref|ak://sha256:...> --out <path>");
  console.log("  akai cas stats");
  console.log("  akai cas gc [--dry-run]");
}

export async function casCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printCasHelp();
    return;
  }

  if (sub === "import") return cmdImport(rest);
  if (sub === "verify") return cmdVerify(rest);
  if (sub === "materialize") return cmdMaterialize(rest);
  if (sub === "stats") return cmdStats();
  if (sub === "gc") return cmdGc(rest);

  throw new Error(`unknown cas subcommand '${sub}'`);
}
