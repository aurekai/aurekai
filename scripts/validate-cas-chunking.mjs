#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-cas-chunking-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas-home");
const inputA = join(tmp, "artifact-a.bin");
const inputB = join(tmp, "artifact-b.bin");
const outB = join(tmp, "materialized-b.bin");

const segA = Buffer.alloc(1024 * 1024, 65);
const segB = Buffer.alloc(1024 * 1024, 66);
const segC = Buffer.alloc(1024 * 1024, 67);
writeFileSync(inputA, Buffer.concat([segA, segB, segC]));
writeFileSync(inputB, Buffer.concat([segA, Buffer.from("AUREKAI-CDC-SHIFT"), segB, segC]));

function run(args) {
  const proc = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      AKAI_CAS_HOME: casHome,
    },
  });

  if (proc.status !== 0) {
    throw new Error(`command failed: akai ${args.join(" ")}\n${proc.stderr || proc.stdout}`);
  }

  return JSON.parse((proc.stdout || "").trim());
}

const importA = run(["cas", "import", inputA, "--ref", "artifact-a"]);
const importB = run(["cas", "import", inputB, "--ref", "artifact-b"]);

if ((importA.payload.chunk_count || 0) < 2) throw new Error("artifact-a chunk count too small");
if ((importB.payload.reused_chunks || 0) < 1) throw new Error("artifact-b did not reuse chunks");

const verifyB = run(["cas", "verify", "artifact-b"]);
if (verifyB.status !== "PASS") throw new Error("cas verify failed for artifact-b");

const materialized = run(["cas", "materialize", "artifact-b", "--out", outB]);
if (!existsSync(outB)) throw new Error("materialized file missing");
if (!readFileSync(outB).equals(readFileSync(inputB))) throw new Error("materialized bytes do not match source");
if ((materialized.payload.chunk_count || 0) < 2) throw new Error("materialize did not report chunk graph");

const stats = run(["cas", "stats"]);
if ((stats.payload.chunk_count || 0) < 2) throw new Error("chunk_count missing in stats");
if ((stats.payload.dedupe_ratio || 0) <= 1) throw new Error("dedupe ratio did not improve above 1");

console.log("cas chunking validate: PASS");
