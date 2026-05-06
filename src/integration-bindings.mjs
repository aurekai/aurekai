import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AKAI_BIN = join(__dirname, "..", "bin", "akai.mjs");

function runAkai(args, env = {}) {
  const proc = spawnSync("node", [AKAI_BIN, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });

  let parsed;
  try {
    parsed = JSON.parse(proc.stdout || "{}");
  } catch {
    parsed = { raw_stdout: proc.stdout || "" };
  }

  return {
    ok: proc.status === 0,
    exit_code: proc.status,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    parsed,
  };
}

// MCP binding: resolve + materialize + status via the local MCP-backed CLI surface.
export function mcpDistributionResolve(ref, env = {}) {
  if (!ref) throw new Error("mcpDistributionResolve requires ref");
  return runAkai(["cas", "verify", String(ref)], env);
}

export function mcpDistributionMaterialize(ref, outPath, env = {}) {
  if (!ref || !outPath) throw new Error("mcpDistributionMaterialize requires ref and outPath");
  return runAkai(["cas", "materialize", String(ref), "--out", resolve(outPath)], env);
}

export function mcpDistributionStatus(env = {}) {
  return runAkai(["cas", "stats"], env);
}

// GitHub Actions binding: deterministic CAS import/materialize wrappers.
export function githubActionCasImport(artifactPath, refName = null, env = {}) {
  if (!artifactPath) throw new Error("githubActionCasImport requires artifactPath");
  const args = ["cas", "import", resolve(artifactPath)];
  if (refName) args.push("--ref", String(refName));
  return runAkai(args, env);
}

export function githubActionCasMaterialize(refOrId, outPath, env = {}) {
  if (!refOrId || !outPath) throw new Error("githubActionCasMaterialize requires refOrId and outPath");
  return runAkai(["cas", "materialize", String(refOrId), "--out", resolve(outPath)], env);
}

// VS Code binding: wrappers meant to be called from extension commands/tasks.
export function vscodeFetchRange(source, outPath, start, end, env = {}) {
  return runAkai([
    "fetch", "range",
    "--url", String(source),
    "--out", resolve(outPath),
    "--start", String(start),
    "--end", String(end),
  ], env);
}

export function vscodePackMaterialize(packPath, outDir, env = {}) {
  return runAkai(["pack", "materialize", resolve(packPath), "--out", resolve(outDir)], env);
}

export function vscodeCasVerify(refOrFile, env = {}) {
  return runAkai(["cas", "verify", String(refOrFile)], env);
}

export { runAkai };
