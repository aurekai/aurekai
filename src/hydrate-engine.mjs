import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function now() {
  return new Date().toISOString();
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

function toSourcePath(urlOrPath) {
  if (urlOrPath.startsWith("file://")) return new URL(urlOrPath).pathname;
  return resolve(urlOrPath);
}

function toIntHash(input) {
  const hex = createHash("sha256").update(String(input)).digest("hex").slice(0, 12);
  return parseInt(hex, 16);
}

function normalizeRegionName(region, idx) {
  const base = String(region || `region-${idx}`);
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function loadJsonMaybe(input) {
  if (!input) return null;
  try {
    if (input.trim().startsWith("{")) return JSON.parse(input);
  } catch {}

  const p = resolve(input);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

async function totalBytes(urlOrPath) {
  if (isHttpUrl(urlOrPath)) {
    const head = await fetch(urlOrPath, { method: "HEAD" });
    if (!head.ok) throw new Error(`HEAD failed: HTTP ${head.status}`);
    const cl = head.headers.get("content-length");
    if (!cl) throw new Error("missing content-length header");
    return parseInt(cl, 10);
  }

  return statSync(toSourcePath(urlOrPath)).size;
}

async function readRange(urlOrPath, start, endExclusive) {
  if (start < 0 || endExclusive <= start) {
    throw new Error(`invalid range ${start}-${endExclusive}`);
  }

  if (isHttpUrl(urlOrPath)) {
    const res = await fetch(urlOrPath, {
      headers: { Range: `bytes=${start}-${endExclusive - 1}` },
    });
    if (!(res.status === 206 || res.status === 200)) {
      throw new Error(`range request failed: HTTP ${res.status}`);
    }
    return Buffer.from(new Uint8Array(await res.arrayBuffer()));
  }

  const data = readFileSync(toSourcePath(urlOrPath));
  return data.subarray(start, endExclusive);
}

function extractRegions(planObj) {
  if (!planObj || typeof planObj !== "object") return [];

  const payload = planObj.schema_version === "aurekai.weightops.result.v1" ? planObj.payload : planObj;
  const plan = payload?.plan || {};

  const phase1 = Array.isArray(plan.phase_1_hot_tensors) ? plan.phase_1_hot_tensors : [];
  const phase2 = Array.isArray(plan.phase_2_lazy_regions) ? plan.phase_2_lazy_regions : [];
  const direct = Array.isArray(payload?.regions) ? payload.regions : [];

  const uniq = [];
  for (const r of [...phase1, ...phase2, ...direct]) {
    if (r && !uniq.includes(r)) uniq.push(r);
  }
  return uniq;
}

export async function executeHydrationEngine({
  model,
  source,
  planInput,
  outDir,
  chunkBytes = 262144,
  runId,
}) {
  if (!source) throw new Error("hydrate engine requires --source <path|url>");

  const loadedPlan = loadJsonMaybe(planInput);
  const regions = extractRegions(loadedPlan);
  if (!regions.length) {
    throw new Error("hydrate engine requires a pull plan with regions (use --plan <file.akhydrate|json>)");
  }

  const total = await totalBytes(source);
  const outRoot = resolve(outDir || ".aurekai/hydrated");
  mkdirSync(outRoot, { recursive: true });

  const minimumWindow = Math.max(32768, chunkBytes);
  const window = Math.max(minimumWindow, Math.floor(total / Math.max(2, regions.length + 1)));

  const transitionLog = [];
  const regionStates = [];
  const outputs = [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const state = { region, state: "queued", updated_at: now() };
    transitionLog.push({ region, from: null, to: "queued", at: state.updated_at });

    const maxStart = Math.max(0, total - window);
    const start = maxStart === 0 ? 0 : toIntHash(`${model}:${region}:${i}`) % maxStart;
    const endExclusive = Math.min(total, start + window);

    state.state = "fetching";
    state.updated_at = now();
    transitionLog.push({ region, from: "queued", to: "fetching", at: state.updated_at, range: [start, endExclusive] });

    const bytes = await readRange(source, start, endExclusive);
    const outFile = join(outRoot, `${String(i).padStart(3, "0")}-${normalizeRegionName(region)}.akregion`);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, bytes);

    const digest = createHash("sha256").update(bytes).digest("hex");

    state.state = "hydrated";
    state.updated_at = now();
    transitionLog.push({ region, from: "fetching", to: "hydrated", at: state.updated_at, bytes: bytes.length, out_file: outFile });

    regionStates.push({
      region,
      state: "hydrated",
      byte_range: [start, endExclusive],
      bytes: bytes.length,
      output_file: outFile,
      chunk_hash: `sha256:${digest}`,
    });

    outputs.push({ type: "akregion", path: outFile, hash: `sha256:${digest}`, size_mb: Number((bytes.length / 1024 / 1024).toFixed(3)) });
  }

  const stateFile = join(outRoot, `${runId}.hydrate-state.json`);
  const statePayload = {
    schema_version: "aurekai.weightops.hydrate.state.v1",
    run_id: runId,
    model,
    source,
    generated_at: now(),
    regions: regionStates,
    transitions: transitionLog,
  };
  writeFileSync(stateFile, JSON.stringify(statePayload, null, 2));

  const planHash = createHash("sha256").update(JSON.stringify(loadedPlan || {})).digest("hex").slice(0, 32);
  const transferBytes = regionStates.reduce((sum, r) => sum + r.bytes, 0);

  return {
    schema_version: "aurekai.weightops.hydrate.v1",
    run_id: runId,
    model,
    source,
    plan_ref: planInput,
    plan_hash: `ak:sha256:${planHash}`,
    state_file: stateFile,
    region_count: regionStates.length,
    bytes_transferred: transferBytes,
    region_states: regionStates,
    transitions: transitionLog,
    generated_at: now(),
    output_artifacts: outputs,
  };
}
