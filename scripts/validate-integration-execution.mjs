#!/usr/bin/env node
/**
 * scripts/validate-integration-execution.mjs
 *
 * Extends validate-capability-bindings.mjs with execution-plausibility checks.
 * Where the binding validator checks naming consistency, this validator checks
 * whether claimed native_commands are actually executable.
 *
 * Checks:
 *   1. All checks from validate-capability-bindings.mjs (re-executed here).
 *   2. Every native_command has a known execution_state in the truth matrix.
 *   3. native_commands with execution_state === "declared-only" are flagged
 *      as execution gaps — they're claimed by integrations but not runnable.
 *   4. Summary: how many integration × command pairs are native vs blocked.
 *
 * Exit 0 = all plausibility checks pass (gaps are warnings, not failures by default).
 * Exit 1 = hard failures (naming errors, missing entries).
 * Exit 2 = execution gaps found and --strict was passed.
 *
 * Usage:
 *   node scripts/validate-integration-execution.mjs
 *   node scripts/validate-integration-execution.mjs --verbose
 *   node scripts/validate-integration-execution.mjs --strict   # gaps = failures
 *   node scripts/validate-integration-execution.mjs --json     # machine-readable output
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const verbose = process.argv.includes("--verbose");
const strict = process.argv.includes("--strict");
const asJson = process.argv.includes("--json");

function load(rel) {
  try {
    return JSON.parse(readFileSync(resolve(root, rel), "utf8"));
  } catch (e) {
    console.error(`ERROR: Failed to read ${rel}: ${e.message}`);
    process.exit(1);
  }
}

// Import truth matrix builder (builds live, not from cached file)
const { buildTruthMatrix } = await import("../src/truth-matrix.mjs");
const matrix = buildTruthMatrix();
const truthByCommand = new Map(matrix.commands.map(e => [e.command, e]));

const capabilities = load("registry/aurekai.capabilities.json");
const integrations = load("registry/integrations.json");

const knownFamilyIds = new Set(capabilities.families.map(f => f.id));
const knownCommands = new Set(capabilities.families.flatMap(f => f.commands));
if (capabilities.experimental_tracks) {
  for (const t of capabilities.experimental_tracks) for (const c of t.commands) knownCommands.add(c);
}

// ── Results collection ──────────────────────────────────────────────────────
let hardFailures = 0;
let executionGaps = 0;
const gapDetails = [];
const names = new Map();
const results = [];

function fail(msg) {
  if (!asJson) console.error(`  FAIL  ${msg}`);
  hardFailures++;
}
function gap(integration, command, state) {
  if (!asJson && verbose) {
    console.warn(`  GAP   ${integration}: '${command}' is ${state}`);
  }
  executionGaps++;
  gapDetails.push({ integration, command, execution_state: state });
}
function ok(msg) {
  if (!asJson && verbose) console.log(`  OK    ${msg}`);
}

if (!asJson) {
  console.log("\nAurekai Integration Execution Validator");
  console.log(`Truth matrix: ${matrix.totals.native ?? 0} native, ${matrix.totals["declared-only"] ?? 0} declared-only of ${matrix.totals.commands} commands`);
  console.log(`Integrations: ${integrations.integrations.length} entries\n`);
}

for (const integration of integrations.integrations) {
  const name = integration.name || "(unnamed)";
  const intResult = { name, binding_errors: [], execution_gaps: [], execution_ok: [] };

  // Duplicate check
  if (names.has(name)) {
    fail(`${name}: duplicate integration name`);
    intResult.binding_errors.push("duplicate integration name");
  } else {
    names.set(name, true);
  }

  // runtime_target
  if (integration.runtime_target !== "akai") {
    fail(`${name}: runtime_target must be "akai", got "${integration.runtime_target}"`);
    intResult.binding_errors.push(`runtime_target: ${integration.runtime_target}`);
  }

  // capability_families
  for (const fam of integration.capability_families ?? []) {
    if (!knownFamilyIds.has(fam)) {
      fail(`${name}: family "${fam}" not in registry`);
      intResult.binding_errors.push(`unknown family: ${fam}`);
    }
  }

  // native_commands — binding check
  for (const cmd of integration.native_commands ?? []) {
    if (!knownCommands.has(cmd)) {
      fail(`${name}: native_command "${cmd}" not in registry`);
      intResult.binding_errors.push(`unknown command: ${cmd}`);
      continue;
    }

    // Execution plausibility check
    const entry = truthByCommand.get(cmd);
    if (!entry) {
      fail(`${name}: "${cmd}" is in registry but missing from truth matrix`);
      intResult.binding_errors.push(`missing from truth matrix: ${cmd}`);
    } else if (entry.execution_state === "declared-only") {
      gap(name, cmd, "declared-only");
      intResult.execution_gaps.push({ command: cmd, execution_state: "declared-only" });
    } else if (entry.execution_state === "hyper-delegated") {
      gap(name, cmd, "hyper-delegated");
      intResult.execution_gaps.push({ command: cmd, execution_state: "hyper-delegated" });
    } else {
      ok(`${name}: ${cmd} [${entry.execution_state}] → ${entry.cli_surface}`);
      intResult.execution_ok.push({ command: cmd, execution_state: entry.execution_state, cli_surface: entry.cli_surface });
    }
  }

  // host_native_surfaces
  if (!Array.isArray(integration.host_native_surfaces) || integration.host_native_surfaces.length === 0) {
    fail(`${name}: host_native_surfaces is empty or missing`);
    intResult.binding_errors.push("host_native_surfaces missing");
  }

  // generated_artifacts
  if (!Array.isArray(integration.generated_artifacts) || integration.generated_artifacts.length === 0) {
    fail(`${name}: generated_artifacts is empty or missing`);
    intResult.binding_errors.push("generated_artifacts missing");
  }

  results.push(intResult);
}

// ── Summary ─────────────────────────────────────────────────────────────────
const totalCommandPairs = results.reduce(
  (s, r) => s + r.execution_ok.length + r.execution_gaps.length, 0
);
const nativePairs = results.reduce((s, r) => s + r.execution_ok.length, 0);

const summary = {
  schema_version: "aurekai.integration-execution-validator.v1",
  validated_at: new Date().toISOString(),
  integrations_checked: integrations.integrations.length,
  hard_failures: hardFailures,
  execution_gaps: executionGaps,
  command_pairs_total: totalCommandPairs,
  command_pairs_native: nativePairs,
  command_pairs_blocked: executionGaps,
  native_coverage_pct: totalCommandPairs > 0
    ? parseFloat(((nativePairs / totalCommandPairs) * 100).toFixed(1))
    : 0,
  gap_details: gapDetails,
  results,
};

if (asJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} else {
  console.log(`${"─".repeat(60)}`);
  console.log(`Integrations checked : ${summary.integrations_checked}`);
  console.log(`Hard failures        : ${hardFailures}`);
  console.log(`Execution gaps       : ${executionGaps}  (declared-only or hyper-delegated)`);
  console.log(`Native coverage      : ${nativePairs}/${totalCommandPairs} command×integration pairs (${summary.native_coverage_pct}%)`);

  if (hardFailures === 0 && executionGaps === 0) {
    console.log(`\n✓  All integrations passed binding and execution validation.`);
  } else if (hardFailures === 0) {
    console.log(`\n⚠  Bindings valid but ${executionGaps} execution gap(s) found.`);
    console.log(`   Run with --verbose to see details, --strict to treat gaps as failures.`);
  } else {
    console.error(`\n✗  ${hardFailures} hard failure(s).`);
  }
}

if (hardFailures > 0) process.exit(1);
if (strict && executionGaps > 0) process.exit(2);
process.exit(0);
