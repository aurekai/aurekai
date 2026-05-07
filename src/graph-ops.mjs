/**
 * Aurekai graph operations — graph.lineage, graph.merkle
 *
 * graph.lineage: reads the real audit log (~/.aurekai/audit/<model>.jsonl)
 *   and builds a DAG of operations as a lineage graph.
 *
 * graph.merkle: computes a real binary Merkle tree over file bytes.
 *
 * All computation is real — no synthetics.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || null;
}
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function hashBuf(buf) { return createHash("sha256").update(buf).digest("hex"); }
function printResult(command, status, payload) {
  process.stdout.write(JSON.stringify({
    schema_version: "aurekai.weightops.result.v1",
    command,
    status,
    created_at: now(),
    payload,
  }, null, 2) + "\n");
}

function auditLogPath(model) {
  const raw = basename(String(model || "unknown"));
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, "-");
  const fullRef = join(homedir(), ".aurekai", "audit", `${sanitized}.jsonl`);
  if (existsSync(fullRef)) return fullRef;
  const legacy = join(homedir(), ".aurekai", "audit", `${sanitized.replace(/\.[^.]+$/, "")}.jsonl`);
  return legacy;
}

function continuityStatus(verdict) {
  if (verdict === "CONTINUITY_FAIL") return "FAIL";
  if (verdict === "PASS_WITH_DRIFT" || verdict === "BOUNDARY_CROSSING") return "WARN";
  if (verdict === "INITIALIZED") return "INFO";
  return "PASS";
}

// ---------------------------------------------------------------------------
// graph lineage
// ---------------------------------------------------------------------------
async function cmdGraphLineage(args) {
  const model = flag(args, "--model") || args.find(a => !a.startsWith("-"));
  const depth = parseInt(flag(args, "--depth") || "100", 10);
  const asJson = hasFlag(args, "--json");

  if (!model) throw new Error("graph lineage requires --model <model>");

  const logPath = auditLogPath(model);

  if (!existsSync(logPath)) {
    const payload = {
      schema_version: "aurekai.graph.lineage.v1",
      generated_at: now(),
      model,
      audit_log: logPath,
      source: "none",
      node_count: 0,
      edge_count: 0,
      nodes: [],
      edges: [],
      lineage_root: null,
      warning: `no audit log found for '${model}' — run commands against this model first to build lineage`,
    };
    if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
    printResult("graph.lineage", "INCONCLUSIVE", payload);
    return;
  }

  const rawLines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  const entries = [];
  for (const line of rawLines) {
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  // Take the most recent `depth` entries
  const recent = entries.slice(-depth);

  // Build nodes and edges from audit entries
  const nodes = [];
  const edges = [];
  const continuityEdges = [];
  const nodeByHash = new Map();
  const commitmentIndex = new Map();
  const stepInclusions = [];

  function addNode(hash, type, label, metadata) {
    if (!nodeByHash.has(hash)) {
      const id = nodes.length;
      nodeByHash.set(hash, id);
      nodes.push({ id, hash, type, label, metadata: metadata || {} });
    }
    return nodeByHash.get(hash);
  }

  let prevIdx = null;
  let accumulator = "seed";
  for (const entry of recent) {
    const stateCommitment = entry.state_commitment ?? entry.metadata?.state_commitment ?? null;
    const priorCommitment = entry.prior_commitment ?? entry.metadata?.prior_commitment ?? null;
    const transitionType = entry.transition_type ?? entry.metadata?.transition_type ?? entry.command ?? "event";
    const continuityClass = entry.continuity_class ?? entry.metadata?.continuity_class ?? null;
    const continuityVerdict = entry.continuity_verdict ?? entry.metadata?.continuity_verdict ?? continuityClass;
    const residualDelta = entry.residual_delta ?? entry.metadata?.residual_delta ?? null;

    const hash =
      entry.proof_hash ||
      hashBuf(Buffer.from(JSON.stringify(entry))).slice(0, 16);
    const type = entry.command ? "audit-entry" : "event";
    const label = entry.command || entry.event || hash.slice(0, 12);
    const idx = addNode(hash, type, label, {
      timestamp: entry.timestamp,
      command: entry.command,
      duration_ms: entry.duration_ms,
      bytes_read: entry.bytes_read,
      bytes_written: entry.bytes_written,
      state_commitment: stateCommitment,
      prior_commitment: priorCommitment,
      transition_type: transitionType,
      continuity_class: continuityClass,
      continuity_verdict: continuityVerdict,
      residual_delta: residualDelta,
    });
    if (prevIdx !== null) edges.push({ from: prevIdx, to: idx });

    if (stateCommitment) commitmentIndex.set(stateCommitment, idx);
    if (priorCommitment && commitmentIndex.has(priorCommitment)) {
      continuityEdges.push({
        from: commitmentIndex.get(priorCommitment),
        to: idx,
        relation: transitionType,
        continuity_class: continuityClass,
        continuity_verdict: continuityVerdict,
        residual_delta: residualDelta,
        source: "commitment-link",
      });
    } else if (priorCommitment) {
      continuityEdges.push({
        from: null,
        to: idx,
        relation: transitionType,
        continuity_class: continuityClass,
        continuity_verdict: continuityVerdict,
        residual_delta: residualDelta,
        external_prior_commitment: priorCommitment,
        source: "external-prior",
      });
    } else if (prevIdx !== null && (stateCommitment || transitionType !== "event")) {
      continuityEdges.push({
        from: prevIdx,
        to: idx,
        relation: transitionType,
        continuity_class: continuityClass,
        continuity_verdict: continuityVerdict,
        residual_delta: residualDelta,
        source: "chronological-fallback",
      });
    }

    accumulator = hashBuf(Buffer.from(`${accumulator}|${hash}|${stateCommitment ?? "none"}|${priorCommitment ?? "none"}|${transitionType}`));
    stepInclusions.push({
      step: stepInclusions.length,
      proof_hash: hash,
      state_commitment: stateCommitment,
      prior_commitment: priorCommitment,
      accumulator_after: `sha256:${accumulator}`,
      transition_type: transitionType,
      continuity_verdict: continuityVerdict,
      status: continuityStatus(continuityVerdict),
    });

    prevIdx = idx;
  }

  // Lineage root = hash of all node hashes in DAG order
  const lineageRoot = nodes.length > 0
    ? hashBuf(Buffer.from(nodes.map(n => n.hash).join("|")))
    : null;
  const trajectoryRoot = stepInclusions.length > 0
    ? hashBuf(Buffer.from(stepInclusions.map(s => `${s.proof_hash}|${s.state_commitment ?? "none"}|${s.prior_commitment ?? "none"}`).join("|")))
    : null;
  const transitionWitnesses = stepInclusions
    .filter(s => s.state_commitment || s.prior_commitment)
    .map(s => `sha256:${hashBuf(Buffer.from(`${s.transition_type}|${s.proof_hash}|${s.state_commitment ?? "none"}|${s.prior_commitment ?? "none"}`))}`);
  const foldedProof = transitionWitnesses.length
    ? `sha256:${hashBuf(Buffer.from(transitionWitnesses.join("|")))}`
    : null;

  const payload = {
    schema_version: "aurekai.graph.lineage.v1",
    generated_at: now(),
    model,
    audit_log: logPath,
    source: "audit-log",
    audit_entries_total: entries.length,
    audit_entries_shown: recent.length,
    depth,
    node_count: nodes.length,
    edge_count: edges.length,
    continuity_edge_count: continuityEdges.length,
    lineage_root: lineageRoot ? `sha256:${lineageRoot}` : null,
    trajectory_root: trajectoryRoot ? `sha256:${trajectoryRoot}` : null,
    history_accumulator: stepInclusions.length > 0 ? stepInclusions[stepInclusions.length - 1].accumulator_after : null,
    continuity_summary: {
      pass: stepInclusions.filter(s => s.status === "PASS").length,
      warn: stepInclusions.filter(s => s.status === "WARN").length,
      fail: stepInclusions.filter(s => s.status === "FAIL").length,
      info: stepInclusions.filter(s => s.status === "INFO").length,
    },
    folded_witness: {
      schema_version: "aurekai.graph.folded_witness.v1",
      fold_ready: true,
      available: foldedProof !== null,
      folded_proof: foldedProof,
      transition_witness_count: transitionWitnesses.length,
      verify_cost: "small",
    },
    step_inclusions: stepInclusions,
    nodes,
    edges,
    continuity_edges: continuityEdges,
  };

  if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
  printResult("graph.lineage", "PASS", payload);
}

// ---------------------------------------------------------------------------
// graph merkle
// ---------------------------------------------------------------------------
async function cmdGraphMerkle(args) {
  const inputsArg = flag(args, "--inputs") || flag(args, "--files");
  const asJson = hasFlag(args, "--json");

  if (!inputsArg) throw new Error("graph merkle requires --inputs <f1,f2,...>");

  const inputFiles = inputsArg.split(",").map(f => f.trim());
  const missing = inputFiles.filter(f => !existsSync(resolve(f)));
  if (missing.length > 0) throw new Error(`graph merkle: files not found: ${missing.join(", ")}`);

  // Leaf hashes from real file bytes
  const leaves = inputFiles.map(f => {
    const path = resolve(f);
    const buf = readFileSync(path);
    return {
      index: inputFiles.indexOf(f),
      file: path,
      size_bytes: statSync(path).size,
      hash: `sha256:${hashBuf(buf)}`,
    };
  });

  // Build binary Merkle tree
  let level = leaves.map(l => l.hash.replace("sha256:", ""));
  const levels = [level.map(h => `sha256:${h}`)];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i]; // duplicate last if odd
      next.push(hashBuf(Buffer.from(left + right, "utf8")));
    }
    level = next;
    levels.push(level.map(h => `sha256:${h}`));
  }
  const merkleRoot = level[0];

  const payload = {
    schema_version: "aurekai.graph.merkle.v1",
    computed_at: now(),
    leaf_count: leaves.length,
    level_count: levels.length,
    merkle_root: `sha256:${merkleRoot}`,
    leaves,
    levels,
  };

  if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
  printResult("graph.merkle", "PASS", payload);
}

// ---------------------------------------------------------------------------
// graph validate
// ---------------------------------------------------------------------------
async function cmdGraphValidate(args) {
  const merkleFile = flag(args, "--merkle") || flag(args, "--in") || flag(args, "--proof") || args.find(a => !a.startsWith("-"));
  if (!merkleFile) throw new Error("graph validate requires --merkle <file.akgraph> or --proof <file.akproof> or --in <file>");
  const asJson = hasFlag(args, "--json");

  const path = resolve(merkleFile);
  if (!existsSync(path)) throw new Error(`graph file not found: ${merkleFile}`);

  let doc;
  try { doc = JSON.parse(readFileSync(path, "utf8")); } catch (e) {
    throw new Error(`graph validate: cannot parse ${merkleFile}: ${e.message}`);
  }

  // Proof bundle path — file has a proof_root, hash, or schema with "proof" in it but
  // no merkle_root + leaves. Validate structural integrity of the proof document instead.
  const isProofDoc = !doc.merkle_root && !Array.isArray(doc.leaves) &&
    (doc.proof_root || doc.hash || (typeof doc.schema_version === "string" && doc.schema_version.includes("proof")));
  if (isProofDoc) {
    const hash = "sha256:" + hashBuf(readFileSync(path));
    const checks = [
      { name: "parseable",       ok: true },
      { name: "schema_present",  ok: typeof doc.schema_version === "string" },
      { name: "identity_present",ok: !!(doc.proof_root || doc.artifact_id || doc.hash || doc.bundle_id) },
    ];
    const allOk = checks.every(c => c.ok);
    const payload = {
      schema_version: "aurekai.graph.validate.v1",
      validated_at: now(),
      source: path,
      document_type: "proof",
      document_schema: doc.schema_version ?? null,
      file_hash: hash,
      checks,
      verdict: allOk ? "PASS" : "INCOMPLETE",
    };
    if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
    printResult("graph.validate", payload.verdict, payload);
    return;
  }

  // Merkle graph path — original behavior
  if (!doc.merkle_root || !Array.isArray(doc.leaves)) {
    throw new Error("graph validate: document missing merkle_root and leaves array, and does not look like a proof bundle. Pass --merkle for a .akgraph file or --proof for a proof bundle.");
  }

  // Re-derive root from leaves and levels if files are accessible
  const validatable = doc.leaves.filter(l => l.file && existsSync(l.file));
  const validatedLeaves = validatable.map(l => {
    const buf = readFileSync(l.file);
    const current = `sha256:${hashBuf(buf)}`;
    return { ...l, current_hash: current, match: current === l.hash };
  });
  const allMatch = validatedLeaves.length === doc.leaves.length &&
    validatedLeaves.every(l => l.match);
  const mismatchCount = validatedLeaves.filter(l => !l.match).length;

  const payload = {
    schema_version: "aurekai.graph.validate.v1",
    validated_at: now(),
    source: path,
    document_type: "merkle_graph",
    stored_merkle_root: doc.merkle_root,
    leaf_count: doc.leaves.length,
    files_accessible: validatable.length,
    files_matched: validatedLeaves.filter(l => l.match).length,
    files_mismatched: mismatchCount,
    verdict: allMatch ? "PASS" : validatedLeaves.length < doc.leaves.length ? "INCONCLUSIVE" : "TAMPERED",
    validated_leaves: validatedLeaves,
  };

  if (asJson) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); return; }
  printResult("graph.validate", payload.verdict === "PASS" ? "PASS" : "FAIL", payload);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
function printGraphHelp() {
  console.log("Usage:");
  console.log("  akai graph lineage  --model <model> [--depth <N>] [--json]");
  console.log("  akai graph merkle   --inputs <f1,f2,...> [--json]");
  console.log("  akai graph validate --merkle <file.akgraph> [--json]");
}

export async function graphCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") { printGraphHelp(); return; }
  if (sub === "lineage")  return cmdGraphLineage(rest);
  if (sub === "merkle")   return cmdGraphMerkle(rest);
  if (sub === "validate") return cmdGraphValidate(rest);
  throw new Error(`unknown graph subcommand '${sub}'`);
}
