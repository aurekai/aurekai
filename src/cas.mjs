import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

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

  const stream = createReadStream(filePath);
  await new Promise((resolveP, rejectP) => {
    stream.on("data", chunk => {
      sha256.update(chunk);
      blake2b.update(chunk);
    });
    stream.on("error", rejectP);
    stream.on("end", resolveP);
  });

  const sha = sha256.digest("hex");
  const b2 = blake2b.digest("hex");
  return {
    sha256: `sha256:${sha}`,
    blake2b: `blake2b512:${b2}`,
    contentAddress: `ak://sha256:${sha}`,
  };
}

function resolveRef(input) {
  const d = ensureCasDirs();

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
    imported_at: now(),
    storage: {
      blob_path: blobPath,
      manifest_path: join(d.manifests, `${sha}.json`),
      ref_path: join(d.refs, `${refName}.json`),
    },
  };

  writeFileSync(join(d.manifests, `${sha}.json`), JSON.stringify(manifest, null, 2) + "\n");
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
        blob_exists: blobExists,
      },
    });
    return;
  }

  const { manifest, refName } = resolveRef(input);
  const sha = String(manifest.hashes.sha256 || "").replace("sha256:", "");
  const blobPath = join(d.blobs, sha);
  if (!existsSync(blobPath)) throw new Error(`blob missing for ${manifest.artifact_id}`);

  const st = statSync(blobPath);
  const blobHashes = await hashFile(blobPath);
  const hashMatch = blobHashes.sha256 === manifest.hashes.sha256;
  const sizeMatch = st.size === manifest.size_bytes;
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
      actual_sha256: blobHashes.sha256,
      expected_size_bytes: manifest.size_bytes,
      actual_size_bytes: st.size,
      hash_match: hashMatch,
      size_match: sizeMatch,
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
  const sha = String(manifest.hashes.sha256 || "").replace("sha256:", "");
  const blobPath = join(d.blobs, sha);
  if (!existsSync(blobPath)) throw new Error(`blob missing for ${manifest.artifact_id}`);

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  copyFileSync(blobPath, outPath);

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
    },
  });
}

async function cmdStats() {
  const d = ensureCasDirs();

  const blobs = readdirSync(d.blobs, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name);
  const manifests = readdirSync(d.manifests, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name);
  const refs = readdirSync(d.refs, { withFileTypes: true }).filter(x => x.isFile()).map(x => x.name);

  const totalBlobBytes = blobs.reduce((sum, name) => sum + statSync(join(d.blobs, name)).size, 0);

  printJson({
    schema_version: "aurekai.cas.result.v1",
    command: "cas.stats",
    status: "PASS",
    payload: {
      root: d.root,
      blob_count: blobs.length,
      manifest_count: manifests.length,
      ref_count: refs.length,
      total_blob_bytes: totalBlobBytes,
      total_blob_gb: parseFloat((totalBlobBytes / (1024 * 1024 * 1024)).toFixed(6)),
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

  printJson({
    schema_version: "aurekai.cas.result.v1",
    command: "cas.gc",
    status: "PASS",
    payload: {
      dry_run: dryRun,
      live_ref_count: live.size,
      removed_blob_count: removed.blobs.length,
      removed_manifest_count: removed.manifests.length,
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
