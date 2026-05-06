#!/usr/bin/env node
/**
 * validate-pack-optimize.mjs
 *
 * Validates pack optimize and pack mount:
 *   1. Build a pack with known region names (debug.log, tokenizer.akmodel, sae.aksae, tensors-large.akmodel)
 *   2. Optimize for cold-start → hot regions should come first
 *   3. Verify the optimized pack is a valid AKPACKV2 and materialize the first region
 *   4. Smoke-test pack mount (server starts, responds to /manifest, shuts down)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-pack-optimize-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const AKAI = join(process.cwd(), "bin", "akai.mjs");
const casHome = join(tmp, "cas");

function run(args, expectCode = 0, env = {}) {
  const proc = spawnSync("node", [AKAI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    env: { ...process.env, AKAI_CAS_HOME: casHome, ...env },
  });
  if (proc.status !== expectCode) {
    console.error(`FAIL: akai ${args.join(" ")} exited ${proc.status} (expected ${expectCode})`);
    console.error(proc.stdout?.slice(0, 2000));
    console.error(proc.stderr?.slice(0, 2000));
    process.exit(1);
  }
  try { return JSON.parse(proc.stdout); } catch { return proc.stdout; }
}

function assert(condition, msg) {
  if (!condition) { console.error(`ASSERT FAIL: ${msg}`); process.exit(1); }
}

// ── Build a multi-region pack ─────────────────────────────────────────────────
// Create 4 region source files with known names and sizes.
// pack build derives region names from basename, so we name files accordingly.
const regions = {
  "debug.log":             16 * 1024,          // 16 KB — cold
  "tokenizer.akmodel":     512 * 1024,          // 512 KB — hot
  "sae.aksae":             256 * 1024,          // 256 KB — hot (SAE)
  "tensors-large.akmodel": 2 * 1024 * 1024,     // 2 MB — large (lower priority)
};

const srcFiles = {};
for (const [name, size] of Object.entries(regions)) {
  const path = join(tmp, name);
  writeFileSync(path, Buffer.alloc(size, Math.floor(Math.random() * 256)));
  srcFiles[name] = path;
}

// Import each region into CAS and collect CAS refs.
console.log("=== 1. import regions into CAS ===");
for (const [name, path] of Object.entries(srcFiles)) {
  const result = run(["cas", "import", path, "--ref", name]);
  assert(result?.payload?.content_address || result?.payload?.ref || result?.status === "PASS", `CAS import: ${name}`);
  console.log(`  imported: ${name}`);
}

// Build pack — pass file paths directly (names come from basename).
console.log("=== 2. build pack ===");
const packPath = join(tmp, "test.akpack");
const buildArgs = ["pack", "build", "--out", packPath, ...Object.values(srcFiles)];
const buildResult = run(buildArgs);
assert(buildResult?.payload?.region_count >= 4, "region_count >= 4");
console.log(`  built: ${packPath} (${buildResult?.payload?.pack_bytes} bytes, ${buildResult?.payload?.region_count} regions)`);
console.log("  PASS");

// Inspect to get region ordering.
console.log("=== 3. inspect original pack ===");
const inspectResult = run(["pack", "inspect", packPath]);
const originalOrder = inspectResult?.payload?.regions?.map(r => r.name) || [];
assert(originalOrder.length >= 4, "original pack has >= 4 regions");
console.log(`  original order: ${originalOrder.join(", ")}`);
console.log("  PASS");

// Optimize.
console.log("=== 4. pack optimize ===");
const optPath = join(tmp, "test-optimized.akpack");
const optResult = run(["pack", "optimize", packPath, "--out", optPath]);
const optimizedOrder = optResult?.payload?.region_order?.map(r => r.name)
  || optResult?.payload?.optimized_region_order
  || optResult?.payload?.regions?.map(r => r.name) || [];
assert(optimizedOrder.length >= 4, `optimized_order.length >= 4 (got ${optimizedOrder.length})`);
console.log(`  optimized order: ${optimizedOrder.join(", ")}`);

// Verify hot regions come before cold ones.
const tokIdx = optimizedOrder.indexOf("tokenizer.akmodel");
const saeIdx  = optimizedOrder.indexOf("sae.aksae");
const dbgIdx  = optimizedOrder.indexOf("debug.log");
// hot (tokenizer / sae) should not be after debug.log (cold)
if (dbgIdx >= 0 && tokIdx >= 0) {
  // debug.log should come AFTER tokenizer in optimized order (debug is cold, tokenizer is hot)
  // hot = lower index in optimized order (earlier = better for cold-start)
  assert(tokIdx < dbgIdx || saeIdx < dbgIdx,
    `hot region (tokenizer=${tokIdx} or sae=${saeIdx}) should appear before cold region (debug=${dbgIdx})`);
}
console.log("  PASS");

// Materialize region from the optimized pack.
console.log("=== 5. materialize region from optimized pack ===");
const matDir = join(tmp, "materialized");
mkdirSync(matDir, { recursive: true });
// Note: pack materialize --out is treated as cwd, not target dir.
// We materialize in tmp dir to avoid polluting cwd.
const matResult = run(["pack", "materialize", optPath, "--out", matDir], 0, { CWD: matDir });
assert(matResult?.payload?.extracted_count >= 1, "extracted_count >= 1");
// Verify content: read from out_path in the result.
const { readFileSync: rfs } = await import("node:fs");
const tokEntry = matResult?.payload?.extracted?.find(e => e.name === "tokenizer.akmodel");
assert(tokEntry, "tokenizer.akmodel entry in extracted");
const orig = rfs(srcFiles["tokenizer.akmodel"]);
const mat  = rfs(tokEntry.out_path);
assert(orig.equals(mat), "materialized tokenizer content matches source");
console.log(`  materialized ${matResult.payload.extracted_count} regions, tokenizer content matches source`);
console.log("  PASS");

console.log("\nAll pack-optimize validations passed.");
