#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-delta-planner-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const oldFile = join(tmp, "old.bin");
const newFile = join(tmp, "new.bin");
const deltaFile = join(tmp, "delta.json");
const appliedFile = join(tmp, "applied.bin");

writeFileSync(oldFile, Buffer.concat([
  Buffer.alloc(1024 * 1024, 65),
  Buffer.alloc(1024 * 1024, 66),
  Buffer.alloc(1024 * 1024, 67),
]));

writeFileSync(newFile, Buffer.concat([
  Buffer.alloc(1024 * 1024, 65),
  Buffer.from("AUREKAI-DELTA-INSERT"),
  Buffer.alloc(1024 * 1024, 66),
  Buffer.alloc(1024 * 1024, 67),
]));

function run(args) {
  const proc = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(`command failed: akai ${args.join(" ")}\n${proc.stderr || proc.stdout}`);
  }
  return JSON.parse((proc.stdout || "").trim());
}

const plan = run(["delta", "plan", "--old", oldFile, "--new", newFile, "--out", deltaFile]);
if (plan.command !== "delta.plan") throw new Error("delta plan command mismatch");
if (plan.payload.chosen_strategy !== "chunk_graph_delta") throw new Error("expected chunk_graph_delta strategy");
if ((plan.payload.reused_bytes || 0) <= 0) throw new Error("expected reused bytes > 0");
if ((plan.payload.savings_ratio || 0) <= 0) throw new Error("expected positive savings ratio");

const applied = run(["delta", "apply", "--old", oldFile, "--delta", deltaFile, "--out", appliedFile]);
if (applied.command !== "delta.apply") throw new Error("delta apply command mismatch");
if (readFileSync(appliedFile).equals(readFileSync(newFile)) !== true) throw new Error("applied artifact does not match new file");

const bench = run(["delta", "bench", "--old", oldFile, "--new", newFile]);
if (bench.command !== "delta.bench") throw new Error("delta bench command mismatch");
if ((bench.payload.metrics?.total_ms || 0) <= 0) throw new Error("expected benchmark timing");

console.log("delta planner validate: PASS");
