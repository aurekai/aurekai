#!/usr/bin/env node
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveAkai() {
  try {
    return execSync("command -v akai", { stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    return `node ${join(__dirname, "..", "bin", "akai.mjs")}`;
  }
}

const akai = resolveAkai();

const tools = {
  doctor: () => execSync(`${akai} doctor --deep`, { stdio: "pipe", encoding: "utf-8" }),
  manifest: () => execSync(`${akai} manifest:print`, { stdio: "pipe", encoding: "utf-8" }),
  help: () => execSync(`${akai} --help`, { stdio: "pipe", encoding: "utf-8" })
};

const command = process.argv[2] || "help";

if (!tools[command]) {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}

process.stdout.write(tools[command]());