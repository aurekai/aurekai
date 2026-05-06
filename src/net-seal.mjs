/**
 * Aurekai net.seal / net.eval_sealed — tamper-evident netlist sealing.
 *
 * Sealed netlist format (.aknetlist):
 *   A JSON document containing the canonical hash of the input netlist file,
 *   plus metadata. Stored to ~/.aurekai/netlists/<seal_id>.aknetlist so that
 *   eval-sealed can be called with just --id <seal_id>.
 *
 * All computation is real: real SHA-256 over real file bytes, real wall-clock
 * timestamps. No synthetics.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || null;
}
function hasFlag(args, name) { return args.includes(name); }
function now() { return new Date().toISOString(); }
function printResult(command, status, payload) {
  process.stdout.write(JSON.stringify({
    schema_version: "aurekai.weightops.result.v1",
    command,
    status,
    created_at: now(),
    payload,
  }, null, 2) + "\n");
}

function netlistsDir() {
  const d = join(homedir(), ".aurekai", "netlists");
  mkdirSync(d, { recursive: true });
  return d;
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashBuf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// net seal
// ---------------------------------------------------------------------------
async function cmdNetSeal(args) {
  const netlistFile = flag(args, "--netlist") || flag(args, "--in") || args.find(a => !a.startsWith("-"));
  if (!netlistFile) throw new Error("net seal requires --netlist <file>");

  const explicitOut = flag(args, "--out");
  const label = flag(args, "--label") || basename(netlistFile, ".json");
  const asJson = hasFlag(args, "--json");
  const dryRun = hasFlag(args, "--dry-run");

  const netlistPath = resolve(netlistFile);
  if (!existsSync(netlistPath)) throw new Error(`netlist file not found: ${netlistFile}`);

  const raw = readFileSync(netlistPath);
  const stat = statSync(netlistPath);
  const fileHash = hashBuf(raw);

  // Parse as JSON to get a canonical hash as well.
  let docHash = fileHash;
  let docValid = false;
  let docKeys = 0;
  try {
    const doc = JSON.parse(raw.toString("utf8"));
    const canonical = JSON.stringify(
      Object.fromEntries(Object.keys(doc).sort().map(k => [k, doc[k]])),
    );
    docHash = hashBuf(Buffer.from(canonical, "utf8"));
    docValid = true;
    docKeys = Object.keys(doc).length;
  } catch {
    // treat as raw bytes
  }

  // seal_id = canonical hash of the document (or file hash if not JSON)
  const sealId = docValid ? docHash : fileHash;

  const sealedAt = now();
  const artifact = {
    schema_version: "aurekai.netlist.sealed.v1",
    sealed_at: sealedAt,
    label,
    seal_id: sealId,
    artifact_id: sealId,           // alias used by existing demo scripts
    source: netlistPath,
    source_bytes: stat.size,
    file_hash: `sha256:${fileHash}`,
    canonical_hash: `sha256:${docHash}`,
    doc_valid_json: docValid,
    doc_keys: docKeys,
    verdict: "SEALED",
  };

  // Determine output path
  const defaultOut = join(netlistsDir(), `${sealId}.aknetlist`);
  const outPath = explicitOut ? resolve(explicitOut) : defaultOut;

  if (!dryRun) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
    artifact.output = outPath;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
    return;
  }
  printResult("net.seal", "PASS", artifact);
}

// ---------------------------------------------------------------------------
// net eval-sealed
// ---------------------------------------------------------------------------
async function cmdNetEvalSealed(args) {
  const netlistFile = flag(args, "--netlist") || flag(args, "--in");
  const sealId = flag(args, "--id");
  const asJson = hasFlag(args, "--json");

  if (!netlistFile && !sealId) {
    throw new Error("net eval-sealed requires --netlist <file.aknetlist> or --id <seal_id>");
  }

  let artifactPath;
  if (netlistFile) {
    artifactPath = resolve(netlistFile);
  } else {
    // Look up by seal_id in ~/.aurekai/netlists/
    const candidate = join(netlistsDir(), `${sealId}.aknetlist`);
    if (!existsSync(candidate)) {
      throw new Error(`sealed netlist not found for id '${sealId}' — expected at ${candidate}`);
    }
    artifactPath = candidate;
  }

  if (!existsSync(artifactPath)) throw new Error(`sealed netlist file not found: ${artifactPath}`);

  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (e) {
    throw new Error(`net eval-sealed: cannot parse sealed netlist: ${e.message}`);
  }

  if (!artifact.seal_id) throw new Error("net eval-sealed: sealed artifact missing seal_id");

  const evalAt = now();

  // Re-verify: re-read the original source file and recompute hashes.
  const sourcePath = artifact.source;
  let sourceExists = false;
  let currentFileHash = null;
  let currentDocHash = null;
  let verdict = "UNKNOWN";
  let tampered = false;
  const verificationErrors = [];

  if (sourcePath && existsSync(sourcePath)) {
    sourceExists = true;
    const currentRaw = readFileSync(sourcePath);
    currentFileHash = hashBuf(currentRaw);

    try {
      const doc = JSON.parse(currentRaw.toString("utf8"));
      const canonical = JSON.stringify(
        Object.fromEntries(Object.keys(doc).sort().map(k => [k, doc[k]])),
      );
      currentDocHash = hashBuf(Buffer.from(canonical, "utf8"));
    } catch {
      currentDocHash = currentFileHash;
    }

    const expectedFileHash = artifact.file_hash?.replace("sha256:", "");
    const expectedCanonHash = artifact.canonical_hash?.replace("sha256:", "");

    if (expectedFileHash && currentFileHash !== expectedFileHash) {
      tampered = true;
      verificationErrors.push(`file_hash mismatch: expected sha256:${expectedFileHash}, got sha256:${currentFileHash}`);
    }
    if (expectedCanonHash && currentDocHash !== expectedCanonHash) {
      tampered = true;
      verificationErrors.push(`canonical_hash mismatch: expected sha256:${expectedCanonHash}, got sha256:${currentDocHash}`);
    }

    verdict = tampered ? "TAMPERED" : "PASS";
  } else {
    verdict = sourcePath ? "SOURCE_MISSING" : "NO_SOURCE";
    if (sourcePath) verificationErrors.push(`source file no longer exists: ${sourcePath}`);
  }

  const payload = {
    schema_version: "aurekai.netlist.eval.v1",
    evaluated_at: evalAt,
    artifact_path: artifactPath,
    seal_id: artifact.seal_id,
    sealed_at: artifact.sealed_at,
    label: artifact.label,
    source_path: sourcePath || null,
    source_exists: sourceExists,
    current_file_hash: currentFileHash ? `sha256:${currentFileHash}` : null,
    current_canonical_hash: currentDocHash ? `sha256:${currentDocHash}` : null,
    expected_file_hash: artifact.file_hash || null,
    expected_canonical_hash: artifact.canonical_hash || null,
    tampered,
    verification_errors: verificationErrors,
    verdict,
    result: verdict,  // alias used by existing demo scripts
    status: verdict,  // alias
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  printResult("net.eval_sealed", verdict === "PASS" ? "PASS" : "FAIL", payload);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
function printNetHelp() {
  console.log("Usage:");
  console.log("  akai net seal       --netlist <file> [--out <file.aknetlist>] [--label <text>] [--json] [--dry-run]");
  console.log("  akai net eval-sealed --netlist <file.aknetlist> [--json]");
  console.log("  akai net eval-sealed --id <seal_id>             [--json]");
  console.log("");
  console.log("Sealed netlists stored at: ~/.aurekai/netlists/<seal_id>.aknetlist");
  console.log("Aliases: netlist.seal → net seal,  netlist.eval_sealed → net eval-sealed");
}

export async function netCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") { printNetHelp(); return; }
  if (sub === "seal")                          return cmdNetSeal(rest);
  if (sub === "eval-sealed" || sub === "eval_sealed") return cmdNetEvalSealed(rest);
  throw new Error(`unknown net subcommand '${sub}'`);
}
