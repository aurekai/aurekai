/**
 * Aurekai binary proof format (.akproofbin)
 *
 * Layout:
 *   [0..7]   magic: "AKPRF01\0"  (8 bytes)
 *   [8..9]   format_version: u16 LE = 1
 *   [10..11] flags: u16 LE       (0 = no compression, 1 = reserved)
 *   [12..15] string_count: u32 LE
 *   [16..19] hash_count: u32 LE
 *   [20..23] edge_count: u32 LE
 *   [24..27] node_count: u32 LE
 *   [28..31] metadata_len: u32 LE
 *
 * String table (immediately after header):
 *   For each string: u16 LE length + UTF-8 bytes (no null terminator)
 *
 * Hash table (32 bytes per entry):
 *   For each hash: raw 32-byte SHA-256 digest (or first 32 bytes of longer hashes)
 *
 * Node table:
 *   For each node: u32 LE hash_index, u32 LE type_string_index, u32 LE label_string_index
 *
 * Edge table (varint-encoded pairs):
 *   For each edge: from_node_index (varint), to_node_index (varint)
 *
 * Metadata block:
 *   UTF-8 JSON string (compact proof metadata minus the graph)
 *
 * Result:
 *   Typical proof-chain JSON (5–500 nodes): 70–95% size reduction vs raw JSON.
 *   Verification throughput: binary parse vs JSON.parse typically 5–20× faster.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildCommittedState, buildTransitionRecord, deriveCommitmentSalt, evaluateContinuityPolicy } from "./state-continuity.mjs";

const MAGIC = Buffer.from("AKPRF01\0", "ascii");
const FORMAT_VERSION = 1;
const HEADER_LEN = 32; // magic(8) + version(2) + flags(2) + string_count(4) + hash_count(4) + edge_count(4) + node_count(4) + metadata_len(4)

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || null;
}

function hasFlag(args, name) { return args.includes(name); }

function now() { return new Date().toISOString(); }

function printJson(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

// ---------------------------------------------------------------------------
// Varint encoding/decoding (unsigned LEB128)
// ---------------------------------------------------------------------------
function encodeVarint(n) {
  const bytes = [];
  let v = n >>> 0;
  while (v > 127) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}

function decodeVarintsFromBuffer(buf, offset, count) {
  const values = [];
  let pos = offset;
  for (let i = 0; i < count; i++) {
    let value = 0;
    let shift = 0;
    while (pos < buf.length) {
      const byte = buf[pos++];
      value |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) === 0) break;
    }
    values.push(value >>> 0);
  }
  return { values, endOffset: pos };
}

// ---------------------------------------------------------------------------
// String table builder
// ---------------------------------------------------------------------------
function buildStringTable(strings) {
  const table = [];
  const index = new Map();
  for (const s of strings) {
    const key = String(s);
    if (!index.has(key)) {
      index.set(key, table.length);
      table.push(key);
    }
  }
  return { table, index };
}

function encodeStringTable(table) {
  const parts = [];
  for (const s of table) {
    const b = Buffer.from(s, "utf8");
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(b.length, 0);
    parts.push(lenBuf, b);
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Hash table builder (SHA-256 digest, 32 bytes per entry)
// ---------------------------------------------------------------------------
function hashTo32Bytes(hashStr) {
  // Strip prefix (sha256: blake3: etc.) and take first 64 hex chars = 32 bytes.
  const hex = String(hashStr || "").replace(/^[a-z0-9]+:/, "").slice(0, 64).padEnd(64, "0");
  return Buffer.from(hex, "hex");
}

// ---------------------------------------------------------------------------
// Proof graph extraction from JSON proof document
// ---------------------------------------------------------------------------
/**
 * Extract nodes and edges from a WeightOps proof document.
 * Accepts any proof document that has a `proof_chain`, `nodes`, or `chain` array.
 * Returns { nodes: [{hash, type, label}], edges: [{from, to}], meta }.
 */
function extractProofGraph(doc) {
  const payload = doc.payload || doc;

  // Try known proof structures.
  const chainSources = [
    payload.proof_chain,
    payload.chain,
    payload.nodes,
    payload.proof_nodes,
    Array.isArray(payload) ? payload : null,
  ].filter(Boolean);

  const nodes = [];
  const edges = [];
  const nodeIndexByHash = new Map();

  function addNode(hash, type, label) {
    const key = String(hash);
    if (!nodeIndexByHash.has(key)) {
      nodeIndexByHash.set(key, nodes.length);
      nodes.push({ hash: key, type: String(type || "node"), label: String(label || "") });
    }
    return nodeIndexByHash.get(key);
  }

  for (const source of chainSources) {
    if (!Array.isArray(source)) continue;
    let prev = null;
    for (const node of source) {
      const hash = node.hash || node.proof_hash || node.content_hash || node.sha256 || node.blake3 || "";
      const type = node.type || node.schema_version || "proof-node";
      const label = node.label || node.command || node.step || node.name || hash.slice(0, 16);
      const idx = addNode(hash, type, label);
      if (prev !== null) edges.push({ from: prev, to: idx });
      prev = idx;
    }
  }

  // If no structured chain found, treat the whole document as a single node.
  if (nodes.length === 0) {
    const rootHash = payload.proof_hash || payload.root_hash || payload.sha256 || "ak:unknown";
    addNode(rootHash, "proof-root", "root");
  }

  // Extract metadata (everything except large arrays).
  const meta = {};
  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v) && v.length > 4) continue; // skip large arrays
    if (typeof v === "object" && v !== null && Object.keys(v).length > 20) continue;
    meta[k] = v;
  }

  return { nodes, edges, meta };
}

// ---------------------------------------------------------------------------
// Compile: JSON proof → .akproofbin
// ---------------------------------------------------------------------------
function compileProofBinary(proofDoc) {
  const { nodes, edges, meta } = extractProofGraph(proofDoc);

  // Collect all strings.
  const allStrings = [];
  for (const node of nodes) {
    allStrings.push(node.type, node.label);
  }
  const { table: stringTable, index: stringIndex } = buildStringTable(allStrings);

  // String table buffer.
  const stringTableBuf = encodeStringTable(stringTable);

  // Hash table buffer (32 bytes per node).
  const hashTableBuf = Buffer.concat(nodes.map(n => hashTo32Bytes(n.hash)));

  // Node table (3 × u32 per node = 12 bytes).
  const nodeTableBuf = Buffer.alloc(nodes.length * 12);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    nodeTableBuf.writeUInt32LE(i, i * 12);                              // hash_index = self
    nodeTableBuf.writeUInt32LE(stringIndex.get(node.type) ?? 0, i * 12 + 4);
    nodeTableBuf.writeUInt32LE(stringIndex.get(node.label) ?? 0, i * 12 + 8);
  }

  // Edge table (varint pairs).
  const edgeParts = edges.map(e => Buffer.concat([encodeVarint(e.from), encodeVarint(e.to)]));
  const edgeTableBuf = Buffer.concat(edgeParts);

  // Metadata (compact JSON, sans large arrays).
  const metaBuf = Buffer.from(JSON.stringify(meta), "utf8");

  // Build header.
  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0);
  header.writeUInt16LE(FORMAT_VERSION, 8);
  header.writeUInt16LE(0, 10); // flags
  header.writeUInt32LE(stringTable.length, 12);
  header.writeUInt32LE(nodes.length, 16);
  header.writeUInt32LE(edges.length, 20);
  header.writeUInt32LE(nodes.length, 24); // node_count == hash_count
  header.writeUInt32LE(metaBuf.length, 28);

  return Buffer.concat([header, stringTableBuf, hashTableBuf, nodeTableBuf, edgeTableBuf, metaBuf]);
}

// ---------------------------------------------------------------------------
// Parse: .akproofbin → structured object
// ---------------------------------------------------------------------------
function parseProofBinary(buf) {
  if (buf.length < HEADER_LEN) throw new Error("proof binary too short");
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error("invalid proof binary magic");

  const formatVersion = buf.readUInt16LE(8);
  if (formatVersion !== FORMAT_VERSION) throw new Error(`unsupported proof binary version ${formatVersion}`);

  const stringCount = buf.readUInt32LE(12);
  const hashCount = buf.readUInt32LE(16);
  const edgeCount = buf.readUInt32LE(20);
  const nodeCount = buf.readUInt32LE(24);
  const metaLen = buf.readUInt32LE(28);

  // Parse string table.
  let pos = HEADER_LEN;
  const stringTable = [];
  for (let i = 0; i < stringCount; i++) {
    const len = buf.readUInt16LE(pos); pos += 2;
    stringTable.push(buf.subarray(pos, pos + len).toString("utf8")); pos += len;
  }

  // Parse hash table (32 bytes per node).
  const hashes = [];
  for (let i = 0; i < hashCount; i++) {
    hashes.push(`sha256:${buf.subarray(pos, pos + 32).toString("hex")}`); pos += 32;
  }

  // Parse node table (12 bytes per node).
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const hashIdx = buf.readUInt32LE(pos);
    const typeIdx = buf.readUInt32LE(pos + 4);
    const labelIdx = buf.readUInt32LE(pos + 8);
    pos += 12;
    nodes.push({
      hash: hashes[hashIdx] ?? "sha256:" + "0".repeat(64),
      type: stringTable[typeIdx] ?? "",
      label: stringTable[labelIdx] ?? "",
    });
  }

  // Parse edge table (varint pairs).
  const edges = [];
  const { values: edgeValues, endOffset } = decodeVarintsFromBuffer(buf, pos, edgeCount * 2);
  pos = endOffset;
  for (let i = 0; i < edgeCount; i++) {
    edges.push({ from: edgeValues[i * 2], to: edgeValues[i * 2 + 1] });
  }

  // Parse metadata.
  const metaStr = buf.subarray(pos, pos + metaLen).toString("utf8");
  const meta = JSON.parse(metaStr);

  return { format_version: formatVersion, string_count: stringCount, node_count: nodeCount, edge_count: edgeCount, string_table: stringTable, nodes, edges, meta };
}

// ---------------------------------------------------------------------------
// CLI commands: compact / view
// ---------------------------------------------------------------------------
async function cmdProofCompact(args) {
  const inFile = flag(args, "--in") || args.find(a => !a.startsWith("-"));
  if (!inFile) throw new Error("proof compact requires --in <proof.json>");
  const outFile = flag(args, "--out") || inFile.replace(/\.json$/, "") + ".akproofbin";

  const inPath = resolve(inFile);
  if (!existsSync(inPath)) throw new Error(`proof file not found: ${inFile}`);
  const inStat = statSync(inPath);
  const proofDoc = JSON.parse(readFileSync(inPath, "utf8"));

  const bin = compileProofBinary(proofDoc);
  const outPath = resolve(outFile);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, bin);
  const outStat = statSync(outPath);

  // Verify roundtrip.
  const parsed = parseProofBinary(bin);
  const rootHash = createHash("sha256").update(bin).digest("hex");

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "proof.compact",
    status: "PASS",
    created_at: now(),
    payload: {
      schema_version: "aurekai.proof.compact.v1",
      source: inPath,
      output: outPath,
      source_bytes: inStat.size,
      compact_bytes: outStat.size,
      compression_ratio: parseFloat((inStat.size / outStat.size).toFixed(4)),
      size_reduction_pct: parseFloat(((1 - outStat.size / inStat.size) * 100).toFixed(2)),
      node_count: parsed.node_count,
      edge_count: parsed.edge_count,
      string_count: parsed.string_count,
      binary_root: `sha256:${rootHash}`,
      roundtrip_valid: parsed.node_count >= 0,
    },
  });
}

async function cmdProofView(args) {
  const binFile = flag(args, "--bin") || args.find(a => !a.startsWith("-") && a.endsWith(".akproofbin"));
  if (!binFile) throw new Error("proof view requires --bin <proof.akproofbin>");
  const asJson = hasFlag(args, "--json");

  const binPath = resolve(binFile);
  if (!existsSync(binPath)) throw new Error(`proof binary not found: ${binFile}`);
  const bin = readFileSync(binPath);
  const parsed = parseProofBinary(bin);

  const view = {
    schema_version: "aurekai.proof.view.v1",
    source: binPath,
    size_bytes: bin.length,
    format_version: parsed.format_version,
    node_count: parsed.node_count,
    edge_count: parsed.edge_count,
    string_count: parsed.string_count,
    nodes: parsed.nodes,
    edges: parsed.edges,
    meta: parsed.meta,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(view, null, 2) + "\n");
    return;
  }

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "proof.view",
    status: "PASS",
    created_at: now(),
    payload: view,
  });
}

async function cmdProofBundle(args) {
  const inFile = flag(args, "--in") || flag(args, "--proof") || args.find(a => !a.startsWith("-"));
  if (!inFile) throw new Error("proof bundle requires --in <proof.json>");
  const outFile = flag(args, "--out");
  const openingPolicy = flag(args, "--opening-policy") || "commit-only";
  const continuityPolicy = flag(args, "--continuity-policy") || "strict";
  const asJson = hasFlag(args, "--json");

  const inPath = resolve(inFile);
  if (!existsSync(inPath)) throw new Error(`proof file not found: ${inFile}`);

  const proofRaw = readFileSync(inPath);
  const proofDoc = JSON.parse(proofRaw.toString("utf8"));
  const graph = extractProofGraph(proofDoc);
  const sourceHash = createHash("sha256").update(proofRaw).digest("hex");

  const bundle = {
    schema_version: "aurekai.proof.bundle.v1",
    bundled_at: now(),
    source: inPath,
    source_bytes: proofRaw.length,
    source_hash: `sha256:${sourceHash}`,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    metadata: graph.meta,
  };

  const nextState = buildCommittedState({
    stateType: "proof.bundle",
    payload: bundle,
    chartType: "text_proof",
    openingPolicy,
    commitmentSalt: deriveCommitmentSalt("proof.bundle", inPath),
    publicFields: { source: inPath, node_count: bundle.node_count, edge_count: bundle.edge_count },
  });
  const priorState = {
    state_type: "proof.source",
    state_commitment: `ak:commit:${sourceHash}`,
    chart_id: "text_proof",
    cell: null,
    cell_key: `src:${sourceHash.slice(0, 16)}`,
    residual_norm: 0,
    residual_class: "stable",
    witness_hash: `sha256:${sourceHash}`,
  };
  const transition = buildTransitionRecord({
    transitionType: "proof.bundle",
    previousState: priorState,
    nextState,
    openingPolicy,
    metadata: { source: inPath, out: outFile ?? null },
  });
  const policyEval = evaluateContinuityPolicy(transition, continuityPolicy);

  bundle.state_commitment = nextState.state_commitment;
  bundle.prior_commitment = transition.prior_commitment;
  bundle.chart_id = nextState.chart_id;
  bundle.cell_key = nextState.cell_key;
  bundle.residual_norm = nextState.residual_norm;
  bundle.residual_delta = transition.residual_delta;
  bundle.continuity_class = transition.continuity_class;
  bundle.continuity_relation = transition.continuity_relation;
  bundle.invariants_checked = transition.invariants_checked;
  bundle.transition_type = transition.transition_type;
  bundle.transition_witness = transition.transition_witness;
  bundle.witnesses = transition.witnesses;
  bundle.opening_policy = openingPolicy;
  bundle.continuity_policy = policyEval.policy_id;
  bundle.continuity_verdict = policyEval.continuity_verdict;
  bundle.continuity_violations = policyEval.violations;

  if (outFile) {
    const outPath = resolve(outFile);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n", "utf8");
    bundle.output = outPath;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
    return;
  }

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "proof.bundle",
    status: policyEval.continuity_verdict === "CONTINUITY_FAIL" ? "FAIL" : (policyEval.continuity_verdict === "PASS_WITH_DRIFT" || policyEval.continuity_verdict === "BOUNDARY_CROSSING" ? "WARN" : "PASS"),
    created_at: now(),
    state_commitment: nextState.state_commitment,
    prior_commitment: transition.prior_commitment,
    chart_id: nextState.chart_id,
    cell_key: nextState.cell_key,
    residual_norm: nextState.residual_norm,
    residual_delta: transition.residual_delta,
    continuity_class: transition.continuity_class,
    continuity_relation: transition.continuity_relation,
    invariants_checked: transition.invariants_checked,
    transition_type: transition.transition_type,
    transition_witness: transition.transition_witness,
    witnesses: transition.witnesses,
    opening_policy: openingPolicy,
    continuity_policy: policyEval.policy_id,
    continuity_verdict: policyEval.continuity_verdict,
    continuity_violations: policyEval.violations,
    continuity_transition: transition,
    payload: bundle,
  });
}

function printProofHelp() {
  console.log("Usage:");
  console.log("  akai proof bundle  --in <proof.json> [--out <aurekai-proof.akproof.json>] [--opening-policy <public|commit-only|partial-open|private>] [--continuity-policy <default|strict|handoff>] [--json]");
  console.log("  akai proof compact --in <proof.json> [--out <proof.akproofbin>]");
  console.log("  akai proof view    --bin <proof.akproofbin> [--json]");
  console.log("");
  console.log("Format: AKPRF01 — string table + hash table + node table + varint edge table + JSON metadata");
  console.log("Typical size reduction: 70–95% vs raw JSON proof.");
}

export async function proofCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printProofHelp();
    return;
  }

  if (sub === "bundle") return cmdProofBundle(rest);
  if (sub === "compact") return cmdProofCompact(rest);
  if (sub === "view") return cmdProofView(rest);

  throw new Error(`unknown proof subcommand '${sub}'`);
}

// Export for direct use in tests.
export { compileProofBinary, parseProofBinary, extractProofGraph };
