#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = "/tmp/akai-manifest-signing-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas-home");
const inA = join(tmp, "a.txt");
const inB = join(tmp, "b.bin");
const pack = join(tmp, "bundle.akpack");
const binManifest = join(tmp, "bundle.manifest.bin");
const privateKey = join(tmp, "ed25519-private.pem");
const publicKey = join(tmp, "ed25519-public.pem");
const signature = join(tmp, "bundle.sig.json");
const tampered = join(tmp, "bundle-tampered.akpack");

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

const compiled = run(["manifest", "bin-compile", "--pack", pack, "--out", binManifest]);
if (compiled.command !== "manifest.bin-compile") throw new Error("bin-compile command mismatch");
if (!existsSync(binManifest)) throw new Error("binary manifest missing");

const verifiedManifest = run(["manifest", "bin-verify", "--bin", binManifest, "--pack", pack]);
if (verifiedManifest.status !== "PASS") throw new Error("binary manifest verify failed");

run(["manifest", "keygen", "--out-private", privateKey, "--out-public", publicKey]);
const signed = run(["manifest", "sign", "--file", pack, "--private-key", privateKey, "--public-key", publicKey, "--cas-ref", "pack-bundle", "--out", signature]);
if (signed.command !== "manifest.sign") throw new Error("sign command mismatch");

const verifiedSig = run(["manifest", "verify-signature", "--file", pack, "--signature", signature, "--public-key", publicKey, "--cas-ref", "pack-bundle"]);
if (verifiedSig.status !== "PASS") throw new Error("signature verify failed");

writeFileSync(tampered, Buffer.concat([readFileSync(pack), Buffer.from([1])]));
const failedSig = run(["manifest", "verify-signature", "--file", tampered, "--signature", signature, "--public-key", publicKey, "--cas-ref", "pack-bundle"], 2);
if (failedSig.status !== "FAIL") throw new Error("tampered verification should fail");

console.log("manifest signing validate: PASS");
