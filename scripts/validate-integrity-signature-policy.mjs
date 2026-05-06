#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-integrity-signature-policy-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas-home");
const pack = join(tmp, "bundle.akpack");
const inA = join(tmp, "a.txt");
const inB = join(tmp, "b.bin");
const privateKey = join(tmp, "ed25519-private.pem");
const publicKey = join(tmp, "ed25519-public.pem");
const signature = join(tmp, "bundle.sig.json");

writeFileSync(inA, "alpha\n");
writeFileSync(inB, Buffer.from([0, 1, 2, 3, 4, 255]));

function run(args, expectExitCode = 0) {
  const proc = spawnSync("node", ["./bin/akai.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, AKAI_CAS_HOME: casHome },
  });
  if (proc.status !== expectExitCode) {
    throw new Error(`command failed: akai ${args.join(" ")}\n${proc.stderr || proc.stdout}`);
  }
  return JSON.parse((proc.stdout || "").trim());
}

run(["pack", "build", inA, inB, "--out", pack]);
run(["cas", "import", pack, "--ref", "pack-bundle"]);
run(["manifest", "keygen", "--out-private", privateKey, "--out-public", publicKey]);
run(["manifest", "sign", "--file", pack, "--private-key", privateKey, "--public-key", publicKey, "--cas-ref", "pack-bundle", "--out", signature]);

const fail = run(["weights", "integrity-gate", "--model", "llama-8b.q4.akmodel", "--signature-policy", "strict"], 3);
if (fail.status !== "FAIL") throw new Error("strict integrity-gate should fail without signature evidence");

const pass = run([
  "weights", "integrity-gate",
  "--model", "llama-8b.q4.akmodel",
  "--proof", pack,
  "--signature", signature,
  "--public-key", publicKey,
  "--cas-ref", "pack-bundle",
  "--signature-policy", "strict",
], 0);
if (pass.status !== "PASS") throw new Error("strict integrity-gate should pass with signature evidence");
if (pass.payload.signature_policy !== "strict") throw new Error("signature policy mismatch");
if (pass.payload.signature_verification?.pass !== true) throw new Error("signature verification payload missing");

console.log("integrity signature policy validate: PASS");
