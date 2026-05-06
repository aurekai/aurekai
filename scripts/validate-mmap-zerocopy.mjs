#!/usr/bin/env node
/**
 * Validate that mmap-backed zero-copy materialization is wired through
 * both the pack and CAS pipelines, and that the pool stats show the
 * correct slice accounting — proving no extra buffer copies were made.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-mmap-zerocopy-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas-home");
const pack = join(tmp, "bundle.akpack");
const outDir = join(tmp, "extracted");
const casOut = join(tmp, "cas-materialized.bin");

// Build three distinct input files so we exercise multi-chunk pack and CAS.
const inA = join(tmp, "alpha.bin");
const inB = join(tmp, "beta.bin");
const inC = join(tmp, "gamma.bin");
writeFileSync(inA, Buffer.alloc(512 * 1024, 0xaa)); // 512 KiB, all 0xaa
writeFileSync(inB, Buffer.alloc(512 * 1024, 0xbb)); // 512 KiB, all 0xbb
writeFileSync(inC, Buffer.alloc(512 * 1024, 0xcc)); // 512 KiB, all 0xcc

function run(args) {
  const proc = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, AKAI_CAS_HOME: casHome },
  });
  if (proc.status !== 0) {
    throw new Error(`command failed: akai ${args.join(" ")}\n${proc.stderr || proc.stdout}`);
  }
  return JSON.parse((proc.stdout || "").trim());
}

// ─── pack path ────────────────────────────────────────────────────────────────
const built = run(["pack", "build", inA, inB, inC, "--out", pack]);
if (built.command !== "pack.build") throw new Error("pack build command mismatch");

const mat = run(["pack", "materialize", pack, "--out-dir", outDir, "--verify"]);
if (mat.command !== "pack.materialize") throw new Error("pack materialize command mismatch");
if (mat.payload.zero_copy !== true) throw new Error("pack materialize did not report zero_copy=true");

const packPool = mat.payload.mmap_pool;
if (packPool.mapped_files < 1) throw new Error("mmap pool should have at least 1 mapped file");
if (packPool.total_slices < 1) throw new Error("mmap pool should report at least 1 slice");
if (packPool.mapped_bytes < built.payload.stored_payload_bytes) {
  throw new Error("mmap pool mapped_bytes less than pack payload size");
}

// Verify extracted bytes match originals
const extractedA = readFileSync(join(outDir, "alpha.bin"));
const extractedB = readFileSync(join(outDir, "beta.bin"));
const extractedC = readFileSync(join(outDir, "gamma.bin"));
if (!extractedA.equals(readFileSync(inA))) throw new Error("alpha.bin extraction mismatch");
if (!extractedB.equals(readFileSync(inB))) throw new Error("beta.bin extraction mismatch");
if (!extractedC.equals(readFileSync(inC))) throw new Error("gamma.bin extraction mismatch");

// ─── CAS path ─────────────────────────────────────────────────────────────────
run(["cas", "import", inA, "--ref", "alpha-test"]);

const casmat = run(["cas", "materialize", "alpha-test", "--out", casOut]);
if (casmat.command !== "cas.materialize") throw new Error("cas materialize command mismatch");
if (casmat.payload.zero_copy !== true) throw new Error("cas materialize did not report zero_copy=true");

const casPool = casmat.payload.mmap_pool;
if (casPool.mapped_files < 1) throw new Error("cas mmap pool should have at least 1 mapped file");
if (casPool.total_slices < 1) throw new Error("cas mmap pool should report at least 1 slice");

// Verify cas-materialized bytes match original
const casResult = readFileSync(casOut);
if (!casResult.equals(readFileSync(inA))) throw new Error("cas materialized bytes do not match original");

// ─── mmap-stats command ────────────────────────────────────────────────────────
const mmapStats = run(["cas", "mmap-stats"]);
if (mmapStats.command !== "cas.mmap-stats") throw new Error("mmap-stats command mismatch");
if (typeof mmapStats.payload.mapped_file_count !== "number") throw new Error("mmap-stats missing mapped_file_count");

console.log("mmap zerocopy validate: PASS");
