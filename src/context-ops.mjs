import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function resolveBridgeCandidates() {
  const out = [];
  if (process.env.AKAI_CONTEXT_PLAN_BIN) out.push(process.env.AKAI_CONTEXT_PLAN_BIN);
  if (process.env.BONFYRE_KVCACHE_BIN) out.push(process.env.BONFYRE_KVCACHE_BIN);
  out.push("bonfyre-kvcache");

  const home = process.env.HOME || "/tmp";
  const bonfyreBuild = join(home, "Documents", "Bonfyre", "cmd", "BonfyreKVCache", "bonfyre-kvcache");
  if (existsSync(bonfyreBuild)) out.push(bonfyreBuild);

  return [...new Set(out)];
}

export async function contextCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub !== "plan") {
    console.error(`  error: unknown context subcommand '${sub ?? "(none)"}'.`);
    process.exitCode = 1;
    return;
  }

  const candidates = resolveBridgeCandidates();
  let lastError = null;

  for (const bridgeBin of candidates) {
    const child = spawnSync(bridgeBin, ["context-plan", ...rest], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });

    const stdout = typeof child.stdout === "string" ? child.stdout : "";
    const stderr = typeof child.stderr === "string" ? child.stderr : "";
    const combined = `${stdout}\n${stderr}`;

    if (child.error) {
      lastError = child.error;
      if (child.error.code === "ENOENT") continue;
      console.error(`  error: failed to run context planner bridge (${bridgeBin}): ${child.error.message}`);
      process.exitCode = 1;
      return;
    }

    if (child.status === 0) {
      if (stdout.length > 0) process.stdout.write(stdout);
      if (stderr.length > 0) process.stderr.write(stderr);
      process.exitCode = 0;
      return;
    }

    if (combined.includes("Unknown command: context-plan")) {
      lastError = new Error(`bridge binary does not support context-plan: ${bridgeBin}`);
      continue;
    }

    if (stdout.length > 0) process.stdout.write(stdout);
    if (stderr.length > 0) process.stderr.write(stderr);
    process.exitCode = child.status ?? 1;
    return;
  }

  const hint = lastError?.message ? ` (${lastError.message})` : "";
  console.error(
    `  error: no compatible bonfyre-kvcache with context-plan found${hint}. Set AKAI_CONTEXT_PLAN_BIN or BONFYRE_KVCACHE_BIN to a freshly built binary.`
  );
  process.exitCode = 1;
}
