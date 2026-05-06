import { createHash, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { compileManifestBinary, parseManifestBinary } from "./manifest-bin.mjs";
import { readPackIndex } from "./pack.mjs";
import { Blake3Hasher } from "@napi-rs/blake-hash";

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

function casRoot() {
  return process.env.AKAI_CAS_HOME || join(homedir(), ".aurekai", "cas");
}

function sanitizeRefName(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "-") || "artifact";
}

async function hashFile(filePath) {
  const sha256 = createHash("sha256");
  const blake3 = new Blake3Hasher();

  const stream = createReadStream(filePath);
  await new Promise((resolveP, rejectP) => {
    stream.on("data", chunk => {
      sha256.update(chunk);
      blake3.update(chunk);
    });
    stream.on("error", rejectP);
    stream.on("end", resolveP);
  });

  return {
    sha256: `sha256:${sha256.digest("hex")}`,
    blake3: `blake3:${blake3.digest("hex")}`,
  };
}

function loadJsonMaybe(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`file not found: ${path}`);
  return JSON.parse(readFileSync(abs, "utf8"));
}

function resolveCasBinding(refOrId) {
  if (!refOrId) return null;
  const root = casRoot();
  const manifestsDir = join(root, "manifests");
  const refsDir = join(root, "refs");

  let manifestPath = null;
  if (String(refOrId).startsWith("ak://sha256:")) {
    manifestPath = join(manifestsDir, `${String(refOrId).replace("ak://sha256:", "")}.json`);
  } else {
    const refPath = join(refsDir, `${sanitizeRefName(refOrId)}.json`);
    if (!existsSync(refPath)) throw new Error(`unknown CAS ref '${refOrId}'`);
    const refDoc = JSON.parse(readFileSync(refPath, "utf8"));
    manifestPath = join(manifestsDir, `${String(refDoc.artifact_id || "").replace("ak://sha256:", "")}.json`);
  }

  if (!existsSync(manifestPath)) throw new Error(`CAS manifest not found for '${refOrId}'`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return {
    artifact_id: manifest.artifact_id,
    chunk_graph_root: manifest.chunk_graph?.root || null,
    chunk_count: manifest.chunk_graph?.chunk_count || 0,
  };
}

function manifestSourceFromPack(packPath) {
  const idx = readPackIndex(packPath);
  return {
    packPath: idx.packPath,
    compiled: compileManifestBinary({
      regions: idx.metadata.regions.map(region => ({
        name: region.name,
        first_chunk_index: region.first_chunk_index,
        chunk_count: region.chunk_count,
        logical_size_bytes: region.logical_size_bytes,
      })),
      chunks: idx.metadata.chunks.map(chunk => ({
        blake3: chunk.blake3,
        pack_offset_bytes: chunk.pack_offset_bytes,
        size_bytes: chunk.size_bytes,
        logical_ref_count: chunk.logical_ref_count,
      })),
    }),
    expected: {
      region_count: idx.metadata.region_count,
      chunk_count: idx.metadata.unique_chunk_count,
      region_names: idx.metadata.regions.map(region => region.name),
      chunk_hashes: idx.metadata.chunks.map(chunk => chunk.blake3),
    },
  };
}

function manifestSourceFromJson(jsonPath) {
  const doc = loadJsonMaybe(jsonPath);
  if (!Array.isArray(doc.regions) || !Array.isArray(doc.chunks)) {
    throw new Error("manifest JSON must contain 'regions' and 'chunks' arrays");
  }

  return {
    jsonPath: resolve(jsonPath),
    compiled: compileManifestBinary({
      regions: doc.regions.map(region => ({
        name: region.name,
        first_chunk_index: region.first_chunk_index,
        chunk_count: region.chunk_count,
        logical_size_bytes: region.logical_size_bytes,
      })),
      chunks: doc.chunks.map(chunk => ({
        blake3: chunk.blake3,
        pack_offset_bytes: chunk.pack_offset_bytes,
        size_bytes: chunk.size_bytes,
        logical_ref_count: chunk.logical_ref_count,
      })),
    }),
    expected: {
      region_count: doc.regions.length,
      chunk_count: doc.chunks.length,
      region_names: doc.regions.map(region => region.name),
      chunk_hashes: doc.chunks.map(chunk => chunk.blake3),
    },
  };
}

function getManifestSource(args) {
  const packPath = flag(args, "--pack");
  const jsonPath = flag(args, "--json");
  if (packPath) return manifestSourceFromPack(packPath);
  if (jsonPath) return manifestSourceFromJson(jsonPath);
  throw new Error("manifest command requires --pack <bundle.akpack> or --json <manifest.json>");
}

function cmdBinCompile(args) {
  const out = flag(args, "--out");
  if (!out) throw new Error("manifest bin-compile requires --out <file.bin>");

  const source = getManifestSource(args);
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, source.compiled);

  printJson({
    schema_version: "aurekai.manifest.result.v1",
    command: "manifest.bin-compile",
    status: "PASS",
    created_at: now(),
    payload: {
      out_path: outPath,
      bytes_written: source.compiled.length,
      region_count: source.expected.region_count,
      chunk_count: source.expected.chunk_count,
      source_pack: source.packPath || null,
      source_json: source.jsonPath || null,
    },
  });
}

function cmdBinVerify(args) {
  const bin = flag(args, "--bin") || args[0];
  if (!bin) throw new Error("manifest bin-verify requires --bin <file.bin>");
  const binPath = resolve(bin);
  if (!existsSync(binPath)) throw new Error(`binary manifest not found: ${bin}`);

  const parsed = parseManifestBinary(readFileSync(binPath));
  const source = getManifestSource(args);

  const regionNamesOk = JSON.stringify(parsed.regions.map(r => r.name)) === JSON.stringify(source.expected.region_names);
  const chunkHashesOk = JSON.stringify(parsed.chunks.map(c => c.blake3)) === JSON.stringify(source.expected.chunk_hashes);
  const countsOk = parsed.region_count === source.expected.region_count && parsed.chunk_count === source.expected.chunk_count;
  const pass = regionNamesOk && chunkHashesOk && countsOk;

  printJson({
    schema_version: "aurekai.manifest.result.v1",
    command: "manifest.bin-verify",
    status: pass ? "PASS" : "FAIL",
    created_at: now(),
    payload: {
      bin_path: binPath,
      region_count: parsed.region_count,
      chunk_count: parsed.chunk_count,
      region_names_match: regionNamesOk,
      chunk_hashes_match: chunkHashesOk,
      counts_match: countsOk,
      source_pack: source.packPath || null,
      source_json: source.jsonPath || null,
    },
  });

  if (!pass) process.exitCode = 2;
}

function cmdKeygen(args) {
  const outPrivate = flag(args, "--out-private");
  const outPublic = flag(args, "--out-public");
  if (!outPrivate || !outPublic) throw new Error("manifest keygen requires --out-private <pem> and --out-public <pem>");

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" });
  const pubPem = publicKey.export({ format: "pem", type: "spki" });
  const privPath = resolve(outPrivate);
  const pubPath = resolve(outPublic);
  mkdirSync(dirname(privPath), { recursive: true });
  mkdirSync(dirname(pubPath), { recursive: true });
  writeFileSync(privPath, privPem);
  writeFileSync(pubPath, pubPem);

  printJson({
    schema_version: "aurekai.manifest.result.v1",
    command: "manifest.keygen",
    status: "PASS",
    created_at: now(),
    payload: {
      private_key_path: privPath,
      public_key_path: pubPath,
      algorithm: "ed25519",
    },
  });
}

async function cmdSign(args) {
  const file = flag(args, "--file") || args[0];
  const privateKeyPath = flag(args, "--private-key");
  const publicKeyPath = flag(args, "--public-key") || null;
  const casRef = flag(args, "--cas-ref") || null;
  const out = flag(args, "--out");
  if (!file || !privateKeyPath || !out) {
    throw new Error("manifest sign requires --file <path> --private-key <pem> --out <sig.json>");
  }

  const filePath = resolve(file);
  if (!existsSync(filePath)) throw new Error(`file not found: ${file}`);

  const fileHashes = await hashFile(filePath);
  const binding = resolveCasBinding(casRef);
  const payload = {
    schema_version: "aurekai.signature.v1",
    created_at: now(),
    algorithm: "ed25519",
    file: {
      path: filePath,
      size_bytes: statSync(filePath).size,
      sha256: fileHashes.sha256,
      blake3: fileHashes.blake3,
    },
    cas_binding: binding,
  };

  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const privateKeyPem = readFileSync(resolve(privateKeyPath), "utf8");
  const signature = signBytes(null, payloadBytes, privateKeyPem).toString("base64");
  const publicKeyPem = publicKeyPath ? readFileSync(resolve(publicKeyPath), "utf8") : null;
  const doc = {
    ...payload,
    public_key_pem: publicKeyPem,
    signature_base64: signature,
  };

  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");

  printJson({
    schema_version: "aurekai.manifest.result.v1",
    command: "manifest.sign",
    status: "PASS",
    created_at: now(),
    payload: {
      out_path: outPath,
      file_path: filePath,
      cas_binding: binding,
      algorithm: "ed25519",
    },
  });
}

async function cmdVerifySignature(args) {
  const file = flag(args, "--file") || args[0];
  const signaturePath = flag(args, "--signature");
  const publicKeyPath = flag(args, "--public-key") || null;
  const casRef = flag(args, "--cas-ref") || null;
  if (!file || !signaturePath) {
    throw new Error("manifest verify-signature requires --file <path> --signature <sig.json>");
  }

  const filePath = resolve(file);
  const sigDoc = loadJsonMaybe(signaturePath);
  const actualHashes = await hashFile(filePath);
  const actualBinding = resolveCasBinding(casRef);
  const payload = {
    schema_version: sigDoc.schema_version,
    created_at: sigDoc.created_at,
    algorithm: sigDoc.algorithm,
    file: sigDoc.file,
    cas_binding: sigDoc.cas_binding,
  };

  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const publicKeyPem = publicKeyPath ? readFileSync(resolve(publicKeyPath), "utf8") : sigDoc.public_key_pem;
  if (!publicKeyPem) throw new Error("public key required via --public-key or embedded signature doc");

  const signatureOk = verifyBytes(null, payloadBytes, publicKeyPem, Buffer.from(sigDoc.signature_base64, "base64"));
  const fileOk = sigDoc.file.sha256 === actualHashes.sha256 && sigDoc.file.blake3 === actualHashes.blake3;
  const casOk = !sigDoc.cas_binding || JSON.stringify(sigDoc.cas_binding) === JSON.stringify(actualBinding);
  const pass = signatureOk && fileOk && casOk;

  printJson({
    schema_version: "aurekai.manifest.result.v1",
    command: "manifest.verify-signature",
    status: pass ? "PASS" : "FAIL",
    created_at: now(),
    payload: {
      file_path: filePath,
      signature_path: resolve(signaturePath),
      signature_valid: signatureOk,
      file_hash_match: fileOk,
      cas_binding_match: casOk,
      actual_sha256: actualHashes.sha256,
      actual_blake3: actualHashes.blake3,
    },
  });

  if (!pass) process.exitCode = 2;
}

function printManifestHelp() {
  console.log("Usage:");
  console.log("  akai manifest bin-compile --pack <bundle.akpack> --out <manifest.bin>");
  console.log("  akai manifest bin-compile --json <manifest.json> --out <manifest.bin>");
  console.log("  akai manifest bin-verify --bin <manifest.bin> --pack <bundle.akpack>");
  console.log("  akai manifest bin-verify --bin <manifest.bin> --json <manifest.json>");
  console.log("  akai manifest keygen --out-private <private.pem> --out-public <public.pem>");
  console.log("  akai manifest sign --file <path> --private-key <pem> [--public-key <pem>] [--cas-ref <ref>] --out <sig.json>");
  console.log("  akai manifest verify-signature --file <path> --signature <sig.json> [--public-key <pem>] [--cas-ref <ref>]");
}

export async function manifestCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printManifestHelp();
    return;
  }

  if (sub === "bin-compile") return cmdBinCompile(rest);
  if (sub === "bin-verify") return cmdBinVerify(rest);
  if (sub === "keygen") return cmdKeygen(rest);
  if (sub === "sign") return cmdSign(rest);
  if (sub === "verify-signature") return cmdVerifySignature(rest);

  throw new Error(`unknown manifest subcommand '${sub}'`);
}
