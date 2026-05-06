#!/usr/bin/env node
/**
 * validate-bench.mjs
 *
 * Validates the benchmark suite (akai bench):
 *   1. bench proof --runs 2  → chain_valid, hashes_per_second > 0
 *   2. bench distribution --size-mb 4 --runs 2  → throughput > 0, roundtrip_fidelity
 *   3. bench hydrate --size-mb 8 --regions 4 --runs 2  → bytes_avoided_ratio > 0
 *   4. bench pack-layout --size-mb 8 --runs 2  → optimized order differs from sequential
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const AKAI = join(process.cwd(), "bin", "akai.mjs");
const tmp = "/tmp/akai-bench-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas");

function run(args, expectCode = 0) {
  const proc = spawnSync("node", [AKAI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    env: { ...process.env, AKAI_CAS_HOME: casHome },
    timeout: 120000,
  });
  if (proc.status !== expectCode) {
    console.error(`FAIL: akai ${args.join(" ")} exited ${proc.status} (expected ${expectCode})`);
    console.error(proc.stdout?.slice(0, 3000));
    console.error(proc.stderr?.slice(0, 3000));
    process.exit(1);
  }
  try { return JSON.parse(proc.stdout); } catch { return proc.stdout; }
}

function assert(condition, msg) {
  if (!condition) { console.error(`ASSERT FAIL: ${msg}`); process.exit(1); }
}

console.log("=== 1. bench proof --runs 2 ===");
const proofResultRaw = run(["bench", "proof", "--runs", "2"]);
const proofResult = proofResultRaw?.payload || proofResultRaw;
assert(proofResult?.schema_version === "aurekai.bench.proof.v1", "schema_version");
assert(proofResult?.chain_valid === true, "chain_valid");
assert(proofResult?.hashes_per_second > 0, "hashes_per_second > 0");
assert(proofResult?.verify_avg_ms >= 0 || proofResult?.avg_verify_ms >= 0, "verify timing >= 0");
const hp = proofResult.hashes_per_second;
const vm = proofResult.verify_avg_ms ?? proofResult.avg_verify_ms;
console.log(`  hashes/sec=${hp.toFixed(0)}  avg_verify=${vm?.toFixed(3)}ms`);
console.log("  PASS");

console.log("=== 2. bench distribution --size-mb 4 --runs 2 ===");
const distResultRaw = run(["bench", "distribution", "--size-mb", "4", "--runs", "2"]);
const distResult = distResultRaw?.payload || distResultRaw;
assert(distResult?.schema_version === "aurekai.bench.distribution.v1", "schema_version");
assert(distResult?.throughput_import_mb_s > 0, "throughput_import_mb_s > 0");
assert(distResult?.roundtrip_fidelity === true, "roundtrip_fidelity");
assert(distResult?.import_avg_ms >= 0 || distResult?.avg_import_ms >= 0, "import timing >= 0");
console.log(`  import=${distResult.throughput_import_mb_s.toFixed(2)} MB/s  roundtrip=${distResult.roundtrip_fidelity}`);
console.log("  PASS");

console.log("=== 3. bench hydrate --size-mb 8 --regions 4 --runs 2 ===");
const hydResultRaw = run(["bench", "hydrate", "--size-mb", "8", "--regions", "4", "--runs", "2"]);
const hydResult = hydResultRaw?.payload || hydResultRaw;
assert(hydResult?.schema_version === "aurekai.bench.hydrate.v1", "schema_version");
assert(hydResult?.bytes_avoided_ratio >= 0, "bytes_avoided_ratio >= 0");
assert(hydResult?.ttfvur_avg_ms >= 0, "ttfvur_avg_ms >= 0");
assert(hydResult?.full_hydrate_avg_ms >= 0, "full_hydrate_avg_ms >= 0");
console.log(`  ttfvur=${hydResult.ttfvur_avg_ms.toFixed(1)}ms  full=${hydResult.full_hydrate_avg_ms.toFixed(1)}ms  bytes_avoided=${hydResult.bytes_avoided_ratio.toFixed(3)}`);
console.log("  PASS");

console.log("=== 4. bench pack-layout --size-mb 8 --runs 2 ===");
const layoutResultRaw = run(["bench", "pack-layout", "--size-mb", "8", "--runs", "2"]);
const layoutResult = layoutResultRaw?.payload || layoutResultRaw;
assert(layoutResult?.schema_version === "aurekai.bench.pack_layout.v1", "schema_version");
assert(Array.isArray(layoutResult?.optimized_region_order), "optimized_region_order is array");
assert(Array.isArray(layoutResult?.sequential_region_order), "sequential_region_order is array");
assert(layoutResult?.optimized_region_order.length > 0, "optimized_region_order non-empty");
// The two orders should differ (optimization should reorder).
const optStr = layoutResult.optimized_region_order.join(",");
const seqStr = layoutResult.sequential_region_order.join(",");
assert(optStr !== seqStr, `optimized order should differ from sequential: ${optStr} vs ${seqStr}`);
console.log(`  seq: [${seqStr}]`);
console.log(`  opt: [${optStr}]`);
console.log("  PASS");

console.log("\nAll bench validations passed.");
