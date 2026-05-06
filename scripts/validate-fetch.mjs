#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-fetch-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const src = join(tmp, "source.bin");
const bytes = Buffer.alloc(1024 * 32);
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
writeFileSync(src, bytes);

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

const rangeOut = join(tmp, "range.bin");
const r = run(["fetch", "range", "--url", src, "--start", "100", "--end", "1000", "--out", rangeOut]);
if (r.command !== "fetch.range") throw new Error("range command mismatch");
if (readFileSync(rangeOut).length !== 900) throw new Error("range length mismatch");

const mpOut = join(tmp, "multipart.bin");
const m = run(["fetch", "multipart", "--url", src, "--parts", "7", "--out", mpOut]);
if (m.command !== "fetch.multipart") throw new Error("multipart command mismatch");
if (!readFileSync(mpOut).equals(readFileSync(src))) throw new Error("multipart content mismatch");

const resumeOut = join(tmp, "resume.bin");
writeFileSync(resumeOut, readFileSync(src).subarray(0, 4096));
const rs = run(["fetch", "resume", "--url", src, "--out", resumeOut]);
if (rs.command !== "fetch.resume") throw new Error("resume command mismatch");
if (!readFileSync(resumeOut).equals(readFileSync(src))) throw new Error("resume content mismatch");

const h = createHash("sha256").update(readFileSync(src)).digest("hex");
const expected = `sha256:${h}`;
const v = run(["fetch", "verify", "--file", src, "--sha256", expected]);
if (v.command !== "fetch.verify") throw new Error("verify command mismatch");
if (!v.payload.hash_match) throw new Error("verify mismatch");

if (!existsSync(rangeOut) || !existsSync(mpOut) || !existsSync(resumeOut)) {
  throw new Error("expected outputs missing");
}

console.log("fetch validate: PASS");
