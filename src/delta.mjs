import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkBufferCdc } from "./chunking.mjs";

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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function shannonEntropy(buffer) {
  if (!buffer.length) return 0;
  const counts = new Uint32Array(256);
  for (const b of buffer) counts[b] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / buffer.length;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(4));
}

function loadChunkGraph(filePath) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`file not found: ${filePath}`);
  const bytes = readFileSync(abs);
  const chunks = chunkBufferCdc(bytes);
  return {
    path: abs,
    size_bytes: bytes.length,
    sha256: `sha256:${sha256(bytes)}`,
    entropy: shannonEntropy(bytes),
    chunks: chunks.map(chunk => ({
      index: chunk.index,
      offset: chunk.offset,
      length: chunk.length,
      blake3: chunk.hashes.blake3,
      sha256: chunk.hashes.sha256,
    })),
  };
}

function planDelta(oldGraph, newGraph) {
  const oldByHash = new Map(oldGraph.chunks.map(chunk => [chunk.blake3, chunk]));
  let reusedBytes = 0;
  let reusedChunks = 0;

  for (const chunk of newGraph.chunks) {
    if (oldByHash.has(chunk.blake3)) {
      reusedBytes += chunk.length;
      reusedChunks += 1;
    }
  }

  const changedBytes = Math.max(0, newGraph.size_bytes - reusedBytes);
  const overlapRatio = newGraph.size_bytes > 0 ? reusedBytes / newGraph.size_bytes : 0;
  const sizeRatio = oldGraph.size_bytes > 0 ? newGraph.size_bytes / oldGraph.size_bytes : 1;

  const strategies = [
    {
      name: "chunk_graph_delta",
      estimated_download_bytes: changedBytes,
      zero_copy_capable: true,
      score: overlapRatio * 100 - Math.abs(1 - sizeRatio) * 10,
    },
    {
      name: "range_fetch",
      estimated_download_bytes: Math.round(changedBytes * 1.15),
      zero_copy_capable: true,
      score: overlapRatio * 80 - Math.max(0, newGraph.entropy - 6) * 2,
    },
    {
      name: "bsdiff",
      estimated_download_bytes: Math.round(newGraph.size_bytes * 0.6),
      zero_copy_capable: false,
      score: newGraph.size_bytes < 32 * 1024 * 1024 ? 35 : 10,
    },
    {
      name: "full_download",
      estimated_download_bytes: newGraph.size_bytes,
      zero_copy_capable: false,
      score: 0,
    },
  ].sort((a, b) => a.estimated_download_bytes - b.estimated_download_bytes || b.score - a.score);

  const chosen = overlapRatio >= 0.25 && reusedBytes > 0
    ? strategies.find(s => s.name === "chunk_graph_delta")
    : strategies[0];
  const chosenStrategy = chosen || strategies[0];

  return {
    overlap_ratio: Number(overlapRatio.toFixed(4)),
    reused_chunks: reusedChunks,
    reused_bytes: reusedBytes,
    changed_bytes: changedBytes,
    old_entropy: oldGraph.entropy,
    new_entropy: newGraph.entropy,
    chosen_strategy: chosenStrategy.name,
    estimated_download_bytes: chosenStrategy.estimated_download_bytes,
    full_size_bytes: newGraph.size_bytes,
    savings_ratio: Number((1 - chosenStrategy.estimated_download_bytes / Math.max(1, newGraph.size_bytes)).toFixed(4)),
    strategies,
  };
}

function buildDeltaArtifact(oldGraph, newGraph) {
  const oldByHash = new Map(oldGraph.chunks.map(chunk => [chunk.blake3, chunk]));
  const newBytes = readFileSync(newGraph.path);
  const operations = newGraph.chunks.map(chunk => {
    if (oldByHash.has(chunk.blake3)) {
      return {
        op: "reuse",
        blake3: chunk.blake3,
        length: chunk.length,
      };
    }

    return {
      op: "inline",
      blake3: chunk.blake3,
      length: chunk.length,
      data_base64: newBytes.subarray(chunk.offset, chunk.offset + chunk.length).toString("base64"),
    };
  });

  return {
    schema_version: "aurekai.delta.artifact.v1",
    created_at: now(),
    old: {
      path: oldGraph.path,
      sha256: oldGraph.sha256,
      size_bytes: oldGraph.size_bytes,
    },
    target: {
      sha256: newGraph.sha256,
      size_bytes: newGraph.size_bytes,
      chunk_count: newGraph.chunks.length,
    },
    operations,
  };
}

function cmdPlan(args) {
  const oldFile = flag(args, "--old") || args[0];
  const newFile = flag(args, "--new") || args[1];
  if (!oldFile || !newFile) throw new Error("delta plan requires --old <file> and --new <file>");

  const oldGraph = loadChunkGraph(oldFile);
  const newGraph = loadChunkGraph(newFile);
  const plan = planDelta(oldGraph, newGraph);
  const out = flag(args, "--out");
  let artifactOut = null;
  if (out) {
    artifactOut = resolve(out);
    mkdirSync(resolve(artifactOut, ".."), { recursive: true });
    writeFileSync(artifactOut, JSON.stringify(buildDeltaArtifact(oldGraph, newGraph), null, 2) + "\n");
  }

  printJson({
    schema_version: "aurekai.delta.result.v1",
    command: "delta.plan",
    status: "PASS",
    created_at: now(),
    payload: {
      old: { path: oldGraph.path, size_bytes: oldGraph.size_bytes, chunk_count: oldGraph.chunks.length, sha256: oldGraph.sha256 },
      new: { path: newGraph.path, size_bytes: newGraph.size_bytes, chunk_count: newGraph.chunks.length, sha256: newGraph.sha256 },
      delta_artifact_out: artifactOut,
      ...plan,
    },
  });
}

function cmdApply(args) {
  const oldFile = flag(args, "--old") || args[0];
  const deltaFile = flag(args, "--delta");
  const out = flag(args, "--out");
  if (!oldFile || !deltaFile || !out) {
    throw new Error("delta apply requires --old <file> --delta <file.akdelta.json> --out <file>");
  }

  const oldGraph = loadChunkGraph(oldFile);
  const oldBytes = readFileSync(oldGraph.path);
  const oldByHash = new Map(oldGraph.chunks.map(chunk => [chunk.blake3, oldBytes.subarray(chunk.offset, chunk.offset + chunk.length)]));
  const deltaDoc = JSON.parse(readFileSync(resolve(deltaFile), "utf8"));
  if (deltaDoc.schema_version !== "aurekai.delta.artifact.v1") {
    throw new Error("invalid delta artifact schema");
  }

  const reconstructed = [];
  for (const op of deltaDoc.operations || []) {
    if (op.op === "reuse") {
      const buf = oldByHash.get(op.blake3);
      if (!buf) throw new Error(`missing reusable chunk in old artifact: ${op.blake3}`);
      reconstructed.push(buf);
      continue;
    }
    if (op.op === "inline") {
      reconstructed.push(Buffer.from(op.data_base64, "base64"));
      continue;
    }
    throw new Error(`unknown delta op '${op.op}'`);
  }

  const outBytes = Buffer.concat(reconstructed);
  const actualSha = `sha256:${sha256(outBytes)}`;
  const pass = actualSha === deltaDoc.target.sha256;
  const outPath = resolve(out);
  writeFileSync(outPath, outBytes);

  printJson({
    schema_version: "aurekai.delta.result.v1",
    command: "delta.apply",
    status: pass ? "PASS" : "FAIL",
    created_at: now(),
    payload: {
      old_path: oldGraph.path,
      delta_path: resolve(deltaFile),
      out_path: outPath,
      bytes_written: outBytes.length,
      expected_sha256: deltaDoc.target.sha256,
      actual_sha256: actualSha,
      reused_chunks: (deltaDoc.operations || []).filter(op => op.op === "reuse").length,
      inline_chunks: (deltaDoc.operations || []).filter(op => op.op === "inline").length,
    },
  });

  if (!pass) process.exitCode = 2;
}

function cmdBench(args) {
  const oldFile = flag(args, "--old") || args[0];
  const newFile = flag(args, "--new") || args[1];
  if (!oldFile || !newFile) throw new Error("delta bench requires --old <file> and --new <file>");

  const started = Date.now();
  const oldGraph = loadChunkGraph(oldFile);
  const mid = Date.now();
  const newGraph = loadChunkGraph(newFile);
  const afterLoad = Date.now();
  const plan = planDelta(oldGraph, newGraph);
  const finished = Date.now();

  printJson({
    schema_version: "aurekai.delta.result.v1",
    command: "delta.bench",
    status: "PASS",
    created_at: now(),
    payload: {
      old_path: oldGraph.path,
      new_path: newGraph.path,
      chosen_strategy: plan.chosen_strategy,
      estimated_download_bytes: plan.estimated_download_bytes,
      delta_savings_ratio: plan.savings_ratio,
      overlap_ratio: plan.overlap_ratio,
      metrics: {
        old_chunk_graph_ms: mid - started,
        new_chunk_graph_ms: afterLoad - mid,
        plan_ms: finished - afterLoad,
        total_ms: finished - started,
      },
    },
  });
}

function printDeltaHelp() {
  console.log("Usage:");
  console.log("  akai delta plan --old <file> --new <file> [--out <delta.json>]");
  console.log("  akai delta bench --old <file> --new <file>");
  console.log("  akai delta apply --old <file> --delta <delta.json> --out <file>");
}

export async function deltaCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printDeltaHelp();
    return;
  }

  if (sub === "plan") return cmdPlan(rest);
  if (sub === "bench") return cmdBench(rest);
  if (sub === "apply") return cmdApply(rest);

  throw new Error(`unknown delta subcommand '${sub}'`);
}
