#!/usr/bin/env node
/**
 * scripts/validate-capability-bindings.mjs
 *
 * Validates that registry/integrations.json is consistent with
 * registry/aurekai.capabilities.json.
 *
 * Checks:
 *   1. Every capability_family listed in each integration exists in the
 *      capability registry's family ids.
 *   2. Every native_command listed in each integration exists in at least
 *      one family's command list.
 *   3. Every integration has a non-empty host_native_surfaces array.
 *   4. Every integration has a non-empty generated_artifacts array.
 *   5. No integration is missing runtime_target.
 *   6. No duplicate integration names.
 *
 * Exit 0 = all checks pass.
 * Exit 1 = validation failures.
 *
 * Usage:
 *   node scripts/validate-capability-bindings.mjs
 *   node scripts/validate-capability-bindings.mjs --verbose
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose');

function load(rel) {
  try {
    return JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to read ${rel}: ${e.message}`);
    process.exit(1);
  }
}

const capabilities = load('registry/aurekai.capabilities.json');
const integrations = load('registry/integrations.json');

// Build known sets from capability registry
const knownFamilyIds = new Set(capabilities.families.map(f => f.id));
const knownCommands = new Set(
  capabilities.families.flatMap(f => f.commands)
);
// Also include experimental track commands
if (capabilities.experimental_tracks) {
  for (const track of capabilities.experimental_tracks) {
    for (const cmd of track.commands) knownCommands.add(cmd);
  }
}

let failures = 0;
const names = new Map();

function fail(msg) {
  console.error(`  FAIL  ${msg}`);
  failures++;
}

function ok(msg) {
  if (verbose) console.log(`  OK    ${msg}`);
}

console.log(`\nAurekai Capability Binding Validator`);
console.log(`Capabilities: ${knownFamilyIds.size} families, ${knownCommands.size} commands`);
console.log(`Integrations: ${integrations.integrations.length} entries\n`);

for (const integration of integrations.integrations) {
  const name = integration.name || '(unnamed)';
  if (verbose) console.log(`Checking: ${name}`);

  // 1. Duplicate check
  if (names.has(name)) {
    fail(`${name}: duplicate integration name (first seen at index ${names.get(name)})`);
  } else {
    names.set(name, integrations.integrations.indexOf(integration));
  }

  // 2. runtime_target
  if (!integration.runtime_target) {
    fail(`${name}: missing runtime_target`);
  } else if (integration.runtime_target !== 'akai') {
    fail(`${name}: runtime_target must be "akai", got "${integration.runtime_target}"`);
  } else {
    ok(`${name}: runtime_target = akai`);
  }

  // 3. capability_families — must exist and reference known families
  if (!Array.isArray(integration.capability_families) || integration.capability_families.length === 0) {
    fail(`${name}: capability_families is empty or missing`);
  } else {
    for (const fam of integration.capability_families) {
      if (!knownFamilyIds.has(fam)) {
        fail(`${name}: capability_family "${fam}" not found in capabilities registry`);
      } else {
        ok(`${name}: family ${fam} OK`);
      }
    }
  }

  // 4. native_commands — must exist and reference known commands
  if (!Array.isArray(integration.native_commands) || integration.native_commands.length === 0) {
    fail(`${name}: native_commands is empty or missing`);
  } else {
    for (const cmd of integration.native_commands) {
      if (!knownCommands.has(cmd)) {
        fail(`${name}: native_command "${cmd}" not found in any capability family`);
      } else {
        ok(`${name}: command ${cmd} OK`);
      }
    }
  }

  // 5. host_native_surfaces
  if (!Array.isArray(integration.host_native_surfaces) || integration.host_native_surfaces.length === 0) {
    fail(`${name}: host_native_surfaces is empty or missing`);
  } else {
    ok(`${name}: ${integration.host_native_surfaces.length} host_native_surfaces`);
  }

  // 6. generated_artifacts
  if (!Array.isArray(integration.generated_artifacts) || integration.generated_artifacts.length === 0) {
    fail(`${name}: generated_artifacts is empty or missing`);
  } else {
    ok(`${name}: ${integration.generated_artifacts.length} generated_artifacts`);
  }
}

// Summary
console.log(`\n${'─'.repeat(50)}`);
if (failures === 0) {
  console.log(`✓  All ${integrations.integrations.length} integrations passed capability binding validation.`);
  process.exit(0);
} else {
  console.error(`✗  ${failures} validation failure(s) across ${integrations.integrations.length} integrations.`);
  process.exit(1);
}
