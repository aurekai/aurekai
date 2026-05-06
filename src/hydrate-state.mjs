import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function loadJsonFile(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function latestHydrateStatePath(dirPath) {
  if (!existsSync(dirPath)) return null;

  const files = readdirSync(dirPath)
    .filter(name => name.endsWith(".hydrate-state.json"))
    .map(name => join(dirPath, name));

  if (!files.length) return null;

  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

export function resolveHydrateState(hydrateStateArg, modelRef) {
  const explicit = hydrateStateArg ? resolve(hydrateStateArg) : null;
  const inferredDir = resolve(".aurekai/hydrated");
  const inferred = latestHydrateStatePath(inferredDir);

  const statePath = explicit || inferred;
  const state = loadJsonFile(statePath);
  if (!state) {
    return {
      available: false,
      required: true,
      state_path: statePath,
      model_match: false,
      hydrated_regions: 0,
      hydrated_bytes: 0,
      readiness_score: 0,
      notes: "No hydrate state found. Run: akai weights hydrate --plan ... --source ...",
    };
  }

  const regions = Array.isArray(state.regions) ? state.regions : [];
  const hydrated = regions.filter(r => r && r.state === "hydrated");
  const hydratedBytes = hydrated.reduce((sum, r) => sum + (Number(r.bytes) || 0), 0);
  const modelMatch = !modelRef || !state.model || state.model === modelRef;

  return {
    available: true,
    required: true,
    state_path: statePath,
    model_match: modelMatch,
    run_id: state.run_id || null,
    generated_at: state.generated_at || null,
    model: state.model || null,
    source: state.source || null,
    hydrated_regions: hydrated.length,
    total_regions: regions.length,
    hydrated_bytes: hydratedBytes,
    readiness_score: regions.length ? Number((hydrated.length / regions.length).toFixed(3)) : 0,
    region_names: hydrated.map(r => r.region),
  };
}
