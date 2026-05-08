import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function now() {
  return new Date().toISOString();
}

function collectContinuityFails(node, path = "$", out = []) {
  if (node == null) return out;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectContinuityFails(item, `${path}[${idx}]`, out));
    return out;
  }

  if (typeof node === "object") {
    const verdict = node.continuity_verdict || node.continuity_class || null;
    if (verdict === "CONTINUITY_FAIL") {
      out.push({ path, node });
    }

    for (const [key, value] of Object.entries(node)) {
      collectContinuityFails(value, `${path}.${key}`, out);
    }
  }

  return out;
}

function validateFailVector(vector) {
  const issues = [];
  const triggered = vector.node?.triggered_fail_conditions;
  const fields = vector.node?.fail_condition_fields;
  const riskScore = vector.node?.risk_score;

  if (!Array.isArray(triggered) || triggered.length === 0) {
    issues.push("missing_triggered_fail_conditions");
  }

  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    issues.push("missing_fail_condition_fields");
  } else {
    const expected = [
      "failed_invariants",
      "missing_invariants",
      "missing_witnesses",
      "residual_delta_exceeded",
      "boundary_crossing_disallowed",
      "chart_transition_disallowed",
    ];
    for (const key of expected) {
      if (!(key in fields)) issues.push(`missing_fail_condition_field:${key}`);
    }
  }

  if (typeof riskScore !== "number" || !Number.isFinite(riskScore)) {
    issues.push("missing_risk_score");
  }

  return {
    path: vector.path,
    ok: issues.length === 0,
    issues,
  };
}

export async function continuityCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub !== "validate-fail-vectors") {
    console.error(`  error: unknown continuity subcommand '${sub ?? "(none)"}'.`);
    console.error("  available: validate-fail-vectors");
    process.exitCode = 1;
    return;
  }

  const inPath = flag(rest, "--in") || flag(rest, "--input");
  const strict = hasFlag(rest, "--strict") || !hasFlag(rest, "--no-strict");
  const asJson = hasFlag(rest, "--json");

  if (!inPath) {
    console.error("  error: continuity validate-fail-vectors requires --in <file.json>");
    process.exitCode = 1;
    return;
  }

  const absIn = resolve(process.cwd(), inPath);
  if (!existsSync(absIn)) {
    console.error(`  error: input file not found: ${absIn}`);
    process.exitCode = 1;
    return;
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(absIn, "utf8"));
  } catch (err) {
    console.error(`  error: invalid JSON at ${absIn}: ${err?.message || err}`);
    process.exitCode = 1;
    return;
  }

  const failVectors = collectContinuityFails(doc);
  const checks = failVectors.map(validateFailVector);
  const failedChecks = checks.filter(item => !item.ok);

  const result = {
    schema_version: "aurekai.continuity.fail_vector_validation.v1",
    validated_at: now(),
    input: absIn,
    strict,
    continuity_fail_vectors: failVectors.length,
    valid_vectors: checks.length - failedChecks.length,
    invalid_vectors: failedChecks.length,
    checks,
    verdict: failedChecks.length === 0 ? "PASS" : "FAIL",
  };

  if (asJson) {
    printJson(result);
  } else {
    process.stdout.write(
      `continuity.validate-fail-vectors  verdict:${result.verdict}  vectors:${result.continuity_fail_vectors}  invalid:${result.invalid_vectors}\n`,
    );
    for (const item of failedChecks.slice(0, 20)) {
      process.stdout.write(`  - ${item.path}  issues: ${item.issues.join(",")}\n`);
    }
  }

  if (strict && failedChecks.length > 0) {
    process.exitCode = 2;
  }

  return result;
}
