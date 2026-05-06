#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tmp = "/tmp/akai-pack-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const inA = join(tmp, "a.txt");
const inB = join(tmp, "b.bin");
const pack = join(tmp, "bundle.akpack");
const out = join(tmp, "out");

writeFileSync(inA, "alpha\n");
writeFileSync(inB, Buffer.from([0, 1, 2, 3, 4, 255]));

function run(args) {
  const p = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (p.status !== 0) {
    throw new Error(`command failed: akai ${args.join(" ")}\n${p.stderr || p.stdout}`);
  }
  return JSON.parse(p.stdout);
}

const built = run(["pack", "build", inA, inB, "--out", pack]);
if (built.command !== "pack.build") throw new Error("build command mismatch");
if (!existsSync(pack)) throw new Error("pack not created");

const inspected = run(["pack", "inspect", pack]);
if (inspected.command !== "pack.inspect") throw new Error("inspect command mismatch");
if (inspected.payload.file_count !== 2) throw new Error("inspect file_count mismatch");
if ((inspected.payload.unique_chunk_count || 0) < 2) throw new Error("inspect unique_chunk_count mismatch");
if ((inspected.payload.binary_manifest?.region_count || 0) !== 2) throw new Error("binary manifest region_count mismatch");

const matAll = run(["pack", "materialize", pack, "--out-dir", out, "--verify"]);
if (matAll.command !== "pack.materialize") throw new Error("materialize command mismatch");
if (matAll.payload.extracted_count !== 2) throw new Error("materialize extracted_count mismatch");

const outA = join(out, "a.txt");
const outB = join(out, "b.bin");
if (readFileSync(outA, "utf8") !== "alpha\n") throw new Error("a.txt content mismatch");
if (!readFileSync(outB).equals(Buffer.from([0, 1, 2, 3, 4, 255]))) throw new Error("b.bin content mismatch");

const one = run(["pack", "materialize", pack, "--out-dir", out, "--file", "a.txt", "--verify"]);
if (one.payload.extracted_count !== 1) throw new Error("single-file materialize mismatch");

console.log("pack validate: PASS");
