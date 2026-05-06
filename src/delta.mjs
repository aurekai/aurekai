import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
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

function cmdPlan(args) {
  const oldFile = flag(args, "--old") || args[0];
  const newFile = flag(args, "--new") || args[1];
  if (!oldFile || !newFile) throw new Error("delta plan requires --old <file> and --new <file>");

  const oldGraph = loadChunkGraph(oldFile);
  const newGraph = loadChunkGraph(newFile);
  const plan = planDelta(oldGraph, newGraph);

  printJson({
    schema_version: "aurekai.delta.result.v1",
    command: "delta.plan",
    status: "PASS",
    created_at: now(),
    payload: {
      old: { path: oldGraph.path, size_bytes: oldGraph.size_bytes, chunk_count: oldGraph.chunks.length, sha256: oldGraph.sha256 },
      new: { path: newGraph.path, size_bytes: newGraph.size_bytes, chunk_count: newGraph.chunks.length, sha256: newGraph.sha256 },
      ...plan,
    },
  });
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
  console.log("  akai delta plan --old <file> --new <file>");
  console.log("  akai delta bench --old <file> --new <file>");
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

  throw new Error(`unknown delta subcommand '${sub}'`);
}
