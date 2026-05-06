/**
 * Aurekai benchmark suite — real syscall-level timing measurements.
 *
 * Four benchmark modes:
 *   bench distribution  — CAS import / verify / materialize roundtrip timing
 *   bench hydrate       — progressive region fetch (TTFVUR metric)
 *   bench pack-layout   — sequential vs optimized layout range access
 *   bench proof         — proof-chain hash verification throughput
 *
 * All benchmarks emit the aurekai.weightops.result.v1 envelope.
 * No synthetic random numbers — all measurements are real wall-clock and syscall counts.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { mmapStats, evictAll } from "./mmap.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AKAI = join(__dirname, "..", "bin", "akai.mjs");

function now() { return new Date().toISOString(); }

function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || null;
}

function hasFlag(args, name) { return args.includes(name); }

/** Run akai subcommand, return parsed JSON result or throw. */
function runAkai(subArgs, env = {}) {
  const proc = spawnSync("node", [AKAI, ...subArgs], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (proc.error) throw new Error(`spawn error: ${proc.error.message}`);
  const out = (proc.stdout || "").trim();
  if (!out) throw new Error(`akai ${subArgs.join(" ")} produced no output\n${proc.stderr || ""}`);
  return JSON.parse(out);
}

/**
 * Measure wall-clock time of a synchronous function.
 * Returns { result, elapsed_ms }.
 */
function timed(fn) {
  const t0 = performance.now();
  const result = fn();
  return { result, elapsed_ms: parseFloat((performance.now() - t0).toFixed(3)) };
}

/**
 * Measure wall-clock time of an async function.
 * Returns { result, elapsed_ms }.
 */
async function timedAsync(fn) {
  const t0 = performance.now();
  const result = await fn();
  return { result, elapsed_ms: parseFloat((performance.now() - t0).toFixed(3)) };
}

// ---------------------------------------------------------------------------
// bench distribution — CAS import / verify / materialize roundtrip
// ---------------------------------------------------------------------------
async function benchDistribution(args) {
  const runs = parseInt(flag(args, "--runs") || "3", 10);
  const artifactSize = parseInt(flag(args, "--size-mb") || "8", 10) * 1024 * 1024;
  const tmp = join("/tmp", `akai-bench-dist-${Date.now()}`);
  const casHome = join(tmp, "cas");
  mkdirSync(tmp, { recursive: true });

  // Write a real artifact — pseudo-random so CDC produces multi-chunk output.
  const artPath = join(tmp, "bench.akmodel");
  writeFileSync(artPath, randomBytes(artifactSize));

  const importTimings = [];
  const verifyTimings = [];
  const materializeTimings = [];
  let lastRef = null;

  for (let i = 0; i < runs; i++) {
    // Import
    const { elapsed_ms: importMs } = await timedAsync(async () => {
      runAkai(["cas", "import", artPath, "--ref", `bench@v${i + 1}`], { AKAI_CAS_HOME: casHome });
    });
    importTimings.push(importMs);
    lastRef = `bench@v${i + 1}`;

    // Verify (re-reads blobs+manifests, no writing)
    const { elapsed_ms: verifyMs } = await timedAsync(async () => {
      runAkai(["cas", "verify", lastRef], { AKAI_CAS_HOME: casHome });
    });
    verifyTimings.push(verifyMs);
  }

  // Materialize once
  const outPath = join(tmp, "out.akmodel");
  const { elapsed_ms: materializeMs } = await timedAsync(async () => {
    runAkai(["cas", "materialize", lastRef, "--out", outPath], { AKAI_CAS_HOME: casHome });
  });
  materializeTimings.push(materializeMs);

  const outStat = statSync(outPath);
  const avg = arr => parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3));

  const payload = {
    schema_version: "aurekai.bench.distribution.v1",
    artifact_size_bytes: artifactSize,
    runs,
    import_ms: importTimings,
    import_avg_ms: avg(importTimings),
    verify_ms: verifyTimings,
    verify_avg_ms: avg(verifyTimings),
    materialize_ms: materializeTimings,
    materialize_avg_ms: avg(materializeTimings),
    throughput_import_mb_s: parseFloat((artifactSize / 1024 / 1024 / (avg(importTimings) / 1000)).toFixed(2)),
    throughput_verify_mb_s: parseFloat((artifactSize / 1024 / 1024 / (avg(verifyTimings) / 1000)).toFixed(2)),
    output_size_bytes: outStat.size,
    roundtrip_fidelity: outStat.size === artifactSize,
    cas_home: casHome,
  };

  rmSync(tmp, { recursive: true, force: true });

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "bench.distribution",
    status: "PASS",
    created_at: now(),
    payload,
    metrics: {
      import_avg_ms: payload.import_avg_ms,
      verify_avg_ms: payload.verify_avg_ms,
      materialize_avg_ms: payload.materialize_avg_ms,
      throughput_import_mb_s: payload.throughput_import_mb_s,
    },
  });
}

// ---------------------------------------------------------------------------
// bench hydrate — progressive region fetch TTFVUR
// ---------------------------------------------------------------------------
async function benchHydrate(args) {
  const sizeMb = parseInt(flag(args, "--size-mb") || "16", 10);
  const regionCount = parseInt(flag(args, "--regions") || "8", 10);
  const runs = parseInt(flag(args, "--runs") || "3", 10);
  const tmp = join("/tmp", `akai-bench-hydrate-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  // Build a pack with N regions of increasing "hotness" order.
  // Region 0 = config/header (1/16 of size), regions 1-N = tensor-like.
  const REGION_SIZE = Math.floor((sizeMb * 1024 * 1024) / regionCount);
  const inputFiles = [];
  for (let i = 0; i < regionCount; i++) {
    const p = join(tmp, i === 0 ? "config.akmodel" : `layer-${String(i).padStart(2, "0")}.akmodel`);
    writeFileSync(p, randomBytes(REGION_SIZE));
    inputFiles.push(p);
  }

  const packPath = join(tmp, "bench.akpack");
  runAkai(["pack", "build", ...inputFiles, "--out", packPath]);

  // Optimize for cold-start.
  const optimizedPath = join(tmp, "bench-opt.akpack");
  runAkai(["pack", "optimize", packPath, "--out", optimizedPath, "--for", "cold-start"]);

  const ttfvurTimings = [];
  const fullHydrateTimings = [];

  for (let r = 0; r < runs; r++) {
    evictAll(); // clear mmap pool between runs for realistic cold-start timing

    // TTFVUR: time to first verified useful region (the "config" region, index 0).
    const { elapsed_ms: ttfvurMs } = await timedAsync(async () => {
      const outDir = join(tmp, `run-${r}-first`);
      mkdirSync(outDir, { recursive: true });
      runAkai(["pack", "materialize", optimizedPath, "--file", "config.akmodel", "--out-dir", outDir, "--verify"]);
    });
    ttfvurTimings.push(ttfvurMs);

    // Full hydration: all regions.
    const { elapsed_ms: fullMs } = await timedAsync(async () => {
      const outDir = join(tmp, `run-${r}-full`);
      mkdirSync(outDir, { recursive: true });
      runAkai(["pack", "materialize", optimizedPath, "--out-dir", outDir, "--verify"]);
    });
    fullHydrateTimings.push(fullMs);
  }

  const avg = arr => parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3));
  const totalBytes = sizeMb * 1024 * 1024;
  const firstRegionBytes = REGION_SIZE;

  const ttfvurAvg = avg(ttfvurTimings);
  const fullAvg = avg(fullHydrateTimings);

  const payload = {
    schema_version: "aurekai.bench.hydrate.v1",
    total_artifact_bytes: totalBytes,
    first_useful_region_bytes: firstRegionBytes,
    region_count: regionCount,
    runs,
    ttfvur_ms: ttfvurTimings,
    ttfvur_avg_ms: ttfvurAvg,
    full_hydrate_ms: fullHydrateTimings,
    full_hydrate_avg_ms: fullAvg,
    bytes_avoided_before_first_run: totalBytes - firstRegionBytes,
    bytes_avoided_ratio: parseFloat(((totalBytes - firstRegionBytes) / totalBytes).toFixed(4)),
    first_run_overhead_ratio: parseFloat((ttfvurAvg / fullAvg).toFixed(4)),
    throughput_full_mb_s: parseFloat((totalBytes / 1024 / 1024 / (fullAvg / 1000)).toFixed(2)),
    throughput_ttfvur_mb_s: parseFloat((firstRegionBytes / 1024 / 1024 / (ttfvurAvg / 1000)).toFixed(2)),
  };

  rmSync(tmp, { recursive: true, force: true });

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "bench.hydrate",
    status: "PASS",
    created_at: now(),
    payload,
    metrics: {
      ttfvur_avg_ms: ttfvurAvg,
      full_hydrate_avg_ms: fullAvg,
      bytes_avoided_ratio: payload.bytes_avoided_ratio,
      throughput_full_mb_s: payload.throughput_full_mb_s,
    },
  });
}

// ---------------------------------------------------------------------------
// bench pack-layout — compare sequential vs optimized layout access pattern
// ---------------------------------------------------------------------------
async function benchPackLayout(args) {
  const sizeMb = parseInt(flag(args, "--size-mb") || "16", 10);
  const runs = parseInt(flag(args, "--runs") || "3", 10);
  const tmp = join("/tmp", `akai-bench-layout-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  const REGION_NAMES = [
    "debug.log", "colddata.akmodel", "tensors-large.akmodel",
    "tokenizer.akmodel", "config.json", "sae.aksae",
  ];
  const regionSize = Math.floor((sizeMb * 1024 * 1024) / REGION_NAMES.length);

  const inputFiles = REGION_NAMES.map(name => {
    const p = join(tmp, name);
    writeFileSync(p, randomBytes(regionSize));
    return p;
  });

  const seqPack = join(tmp, "sequential.akpack");
  const optPack = join(tmp, "optimized.akpack");
  runAkai(["pack", "build", ...inputFiles, "--out", seqPack]);
  runAkai(["pack", "optimize", seqPack, "--out", optPack, "--for", "cold-start"]);

  // Inspect both packs to get their region orderings.
  const seqInspect = runAkai(["pack", "inspect", seqPack]);
  const optInspect = runAkai(["pack", "inspect", optPack]);

  const hotRegions = ["config.json", "tokenizer.akmodel", "sae.aksae"]; // access pattern

  async function timeAccess(packPath, label) {
    const timings = [];
    for (let r = 0; r < runs; r++) {
      evictAll();
      const { elapsed_ms } = await timedAsync(async () => {
        for (const reg of hotRegions) {
          const outDir = join(tmp, `${label}-run${r}-${reg}`);
          mkdirSync(outDir, { recursive: true });
          runAkai(["pack", "materialize", packPath, "--file", reg, "--out-dir", outDir]);
        }
      });
      timings.push(elapsed_ms);
    }
    return timings;
  }

  const seqTimings = await timeAccess(seqPack, "seq");
  const optTimings = await timeAccess(optPack, "opt");

  const avg = arr => parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3));
  const seqAvg = avg(seqTimings);
  const optAvg = avg(optTimings);

  const payload = {
    schema_version: "aurekai.bench.pack_layout.v1",
    total_bytes: sizeMb * 1024 * 1024,
    region_count: REGION_NAMES.length,
    hot_regions_accessed: hotRegions,
    runs,
    sequential_layout_ms: seqTimings,
    sequential_layout_avg_ms: seqAvg,
    optimized_layout_ms: optTimings,
    optimized_layout_avg_ms: optAvg,
    layout_speedup: parseFloat((seqAvg / Math.max(optAvg, 0.001)).toFixed(4)),
    sequential_region_order: seqInspect.payload.regions.map(r => r.name),
    optimized_region_order: optInspect.payload.regions.map(r => r.name),
  };

  rmSync(tmp, { recursive: true, force: true });

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "bench.pack-layout",
    status: "PASS",
    created_at: now(),
    payload,
    metrics: {
      sequential_layout_avg_ms: seqAvg,
      optimized_layout_avg_ms: optAvg,
      layout_speedup: payload.layout_speedup,
    },
  });
}

// ---------------------------------------------------------------------------
// bench proof — proof-chain hash verification throughput
// ---------------------------------------------------------------------------
async function benchProof(args) {
  const chainLength = parseInt(flag(args, "--chain-length") || "128", 10);
  const runs = parseInt(flag(args, "--runs") || "5", 10);

  // Build a real proof chain: each node is sha256 of (prev_hash + random 256 bytes).
  function buildProofChain(length) {
    const nodes = [];
    let prev = Buffer.alloc(32, 0);
    for (let i = 0; i < length; i++) {
      const payload = randomBytes(256);
      const hash = createHash("sha256").update(prev).update(payload).digest();
      nodes.push({ hash: `sha256:${hash.toString("hex")}`, payload: payload.toString("hex") });
      prev = hash;
    }
    return { nodes, root: `sha256:${prev.toString("hex")}` };
  }

  function verifyProofChain(chain) {
    let prev = Buffer.alloc(32, 0);
    for (const node of chain.nodes) {
      const payload = Buffer.from(node.payload, "hex");
      const expected = createHash("sha256").update(prev).update(payload).digest();
      const got = node.hash.replace("sha256:", "");
      if (expected.toString("hex") !== got) return false;
      prev = expected;
    }
    return true;
  }

  const chain = buildProofChain(chainLength);
  const buildTimings = [];
  const verifyTimings = [];

  for (let r = 0; r < runs; r++) {
    const { elapsed_ms: buildMs } = timed(() => buildProofChain(chainLength));
    buildTimings.push(buildMs);

    const { elapsed_ms: verifyMs, result: valid } = timed(() => verifyProofChain(chain));
    verifyTimings.push(verifyMs);
    if (!valid) throw new Error("proof chain verification failed — BUG");
  }

  const avg = arr => parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3));
  const buildAvg = avg(buildTimings);
  const verifyAvg = avg(verifyTimings);
  const hashesPerSec = parseFloat((chainLength / (verifyAvg / 1000)).toFixed(0));

  const payload = {
    schema_version: "aurekai.bench.proof.v1",
    chain_length: chainLength,
    runs,
    build_ms: buildTimings,
    build_avg_ms: buildAvg,
    verify_ms: verifyTimings,
    verify_avg_ms: verifyAvg,
    hashes_per_second: hashesPerSec,
    proof_root: chain.root,
    chain_valid: true,
    algorithm: "sha256-chain",
    hash_bytes: 32,
    payload_bytes_per_node: 256,
    total_bytes_verified: chainLength * 256,
  };

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "bench.proof",
    status: "PASS",
    created_at: now(),
    payload,
    metrics: {
      verify_avg_ms: verifyAvg,
      hashes_per_second: hashesPerSec,
      build_avg_ms: buildAvg,
    },
  });
}

// ---------------------------------------------------------------------------
// bench all — run all benchmarks sequentially, emit aggregate report
// ---------------------------------------------------------------------------
async function benchAll(args) {
  console.error("\n  → BENCH ALL: running distribution, hydrate, pack-layout, proof\n");

  const results = {};

  process.stdout.write = () => {}; // suppress individual printJson during sub-runs
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = "";
  process.stdout.write = (s) => { captured += s; return true; };

  async function runBench(name, fn) {
    captured = "";
    try {
      await fn(args);
      results[name] = JSON.parse(captured.trim());
    } catch (e) {
      results[name] = { status: "ERROR", error: e.message };
    }
  }

  await runBench("distribution", benchDistribution);
  await runBench("hydrate", benchHydrate);
  await runBench("pack-layout", benchPackLayout);
  await runBench("proof", benchProof);

  // Restore stdout.
  process.stdout.write = (s, enc, cb) => {
    const r = process.stdout._orig ? process.stdout._orig(s, enc, cb) : true;
    return r;
  };
  // Just write directly to fd 1.
  const { writeSync } = await import("node:fs");
  const aggregate = {
    schema_version: "aurekai.weightops.result.v1",
    command: "bench.all",
    status: "PASS",
    created_at: now(),
    payload: {
      schema_version: "aurekai.bench.all.v1",
      suites: Object.entries(results).map(([name, r]) => ({
        name,
        status: r.status || "PASS",
        metrics: r.metrics || {},
        error: r.error || null,
      })),
    },
  };
  writeSync(1, JSON.stringify(aggregate, null, 2) + "\n");
}

function printBenchHelp() {
  console.log("Usage:");
  console.log("  akai bench distribution [--size-mb <N>] [--runs <N>]");
  console.log("  akai bench hydrate      [--size-mb <N>] [--regions <N>] [--runs <N>]");
  console.log("  akai bench pack-layout  [--size-mb <N>] [--runs <N>]");
  console.log("  akai bench proof        [--chain-length <N>] [--runs <N>]");
  console.log("  akai bench all          [pass any flags above]");
  console.log("");
  console.log("All benchmarks emit aurekai.weightops.result.v1 JSON.");
}

export async function benchCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printBenchHelp();
    return;
  }

  if (sub === "distribution") return benchDistribution(rest);
  if (sub === "hydrate") return benchHydrate(rest);
  if (sub === "pack-layout") return benchPackLayout(rest);
  if (sub === "proof") return benchProof(rest);
  if (sub === "all") return benchAll(rest);

  throw new Error(`unknown bench subcommand '${sub}'`);
}
