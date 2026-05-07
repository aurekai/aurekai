import { createHash } from "node:crypto";
import { compile as compileChart, detectChart } from "./chart-compiler.mjs";
import { e8SquaredDist } from "./e8-lattice.mjs";

const COMMITMENT_SCHEMA = "aurekai.state.commitment.v1";
const TRANSITION_SCHEMA = "aurekai.state.transition.v1";

const CONTINUITY_POLICY_REGISTRY = {
  default: {
    id: "default",
    description: "Default continuity policy",
    max_residual_delta: 1.1,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
  },
  strict: {
    id: "strict",
    description: "Strict continuity policy",
    max_residual_delta: 0.8,
    allow_boundary_crossing: false,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded", "neighborhood_preserved"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "residual_bounded", "neighborhood_preserved", "prior_commitment_present"],
  },
  handoff: {
    id: "handoff",
    description: "Relaxed chart crossing, strict witness continuity",
    max_residual_delta: 1.2,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded", "prior_commitment_present"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
  },
};

const RESIDUAL_THRESHOLDS = {
  default:     { stable: 0.45, boundary: 0.8, novel: 1.1 },
  text_proof:  { stable: 0.4,  boundary: 0.75, novel: 1.05 },
  geo_runtime: { stable: 0.55, boundary: 0.9,  novel: 1.2 },
  memory:      { stable: 0.5,  boundary: 0.85, novel: 1.15 },
  model_block: { stable: 0.35, boundary: 0.7,  novel: 1.0 },
  generic:     { stable: 0.45, boundary: 0.8,  novel: 1.1 },
};

function round(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return n ?? null;
  return parseFloat(n.toFixed(8));
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function hashValue(value, prefix = "sha256:") {
  return `${prefix}${sha256Hex(stableStringify(value))}`;
}

export function deriveCommitmentSalt(baseSalt, scope) {
  return sha256Hex(`${baseSalt}:${scope}`).slice(0, 32);
}

export function classifyResidual(chartId, residualNorm) {
  const bands = RESIDUAL_THRESHOLDS[chartId] ?? RESIDUAL_THRESHOLDS.default;
  if (residualNorm <= bands.stable) return "stable";
  if (residualNorm <= bands.boundary) return "boundary";
  if (residualNorm <= bands.novel) return "novel";
  return "degraded";
}

export function buildCommittedState({
  stateType,
  payload,
  chartType = null,
  chartAnnotation = null,
  openingPolicy = "commit-only",
  commitmentSalt = "",
  publicFields = {},
}) {
  const chart = chartAnnotation ?? compileChart(chartType ?? detectChart(payload), payload);
  const payloadHash = hashValue(payload);
  const residualNorm = round(chart.residual_norm);
  const residualClass = classifyResidual(chart.chart_id, residualNorm);

  const cellCommitment = `ak:cell:${sha256Hex(stableStringify({
    schema_version: COMMITMENT_SCHEMA,
    chart_id: chart.chart_id,
    cell_key: chart.cell_key,
    residual_norm: residualNorm,
    witness_hash: chart.witness_hash,
    opening_policy: openingPolicy,
    salt: commitmentSalt,
  }))}`;

  const stateCommitment = `ak:commit:${sha256Hex(stableStringify({
    schema_version: COMMITMENT_SCHEMA,
    state_type: stateType,
    chart_id: chart.chart_id,
    cell_key: chart.cell_key,
    residual_norm: residualNorm,
    payload_hash: payloadHash,
    witness_hash: chart.witness_hash,
    opening_policy: openingPolicy,
    salt: commitmentSalt,
    public_fields: publicFields,
  }))}`;

  return {
    commitment_schema: COMMITMENT_SCHEMA,
    state_type: stateType,
    chart_id: chart.chart_id,
    cell: chart.e8_cell ?? chart.cell ?? null,
    cell_key: chart.cell_key,
    residual_norm: residualNorm,
    residual_class: residualClass,
    witness_hash: chart.witness_hash,
    payload_hash: payloadHash,
    cell_commitment: cellCommitment,
    state_commitment: stateCommitment,
    opening_policy: openingPolicy,
  };
}

function invariant(name, ok, detail = null) {
  return detail === null ? { name, ok } : { name, ok, detail };
}

export function buildInvariantResults({ previousState = null, nextState }) {
  const residualOk = nextState?.residual_class !== "degraded";
  const sameChart = !previousState || previousState.chart_id === nextState.chart_id;
  const treatAsTopologyOnly = nextState?.chart_id === "generic"
    || previousState?.chart_id === "generic"
    || nextState?.state_type === "space.state"
    || previousState?.state_type === "space.state";
  const neighborhoodDistance = previousState && Array.isArray(previousState.cell) && Array.isArray(nextState.cell)
    ? round(e8SquaredDist(previousState.cell, nextState.cell))
    : null;
  const neighborhoodOk = !previousState || !sameChart || treatAsTopologyOnly || neighborhoodDistance === null
    ? true
    : neighborhoodDistance <= 4.05;

  const invariants = [
    invariant("commitment_bound", Boolean(nextState?.state_commitment)),
    invariant("witness_bound", Boolean(nextState?.witness_hash)),
    invariant("residual_bounded", residualOk, nextState?.residual_class ?? null),
    invariant("chart_supported", Boolean(nextState?.chart_id), nextState?.chart_id ?? null),
  ];

  if (previousState) {
    invariants.push(invariant("prior_commitment_present", Boolean(previousState.state_commitment)));
    invariants.push(invariant("neighborhood_preserved", neighborhoodOk, neighborhoodDistance));
  }

  return invariants;
}

export function classifyContinuity({ previousState = null, nextState, residualDelta = null, invariantsChecked = [] }) {
  if (!previousState) return "INITIALIZED";
  if (previousState.chart_id !== nextState.chart_id) return "BOUNDARY_CROSSING";
  if (invariantsChecked.some(item => item.ok === false)) return "CONTINUITY_FAIL";
  if ((residualDelta ?? 0) > 0.2 || nextState.residual_class !== "stable") return "PASS_WITH_DRIFT";
  return "PASS";
}

export function buildTransitionRecord({
  transitionType,
  previousState = null,
  nextState,
  openingPolicy = "commit-only",
  metadata = {},
}) {
  const residualDelta = previousState ? round((nextState?.residual_norm ?? 0) - (previousState?.residual_norm ?? 0)) : null;
  const invariantsChecked = buildInvariantResults({ previousState, nextState });
  const continuityClass = classifyContinuity({ previousState, nextState, residualDelta, invariantsChecked });

  return {
    schema_version: TRANSITION_SCHEMA,
    transition_type: transitionType,
    prior_commitment: previousState?.state_commitment ?? null,
    next_commitment: nextState?.state_commitment ?? null,
    chart_transition: {
      from: previousState?.chart_id ?? null,
      to: nextState?.chart_id ?? null,
    },
    residual_delta: residualDelta,
    invariants_checked: invariantsChecked,
    continuity_class: continuityClass,
    opening_policy: openingPolicy,
    metadata,
  };
}

export function resolveContinuityPolicy(policy = "default") {
  if (!policy) return CONTINUITY_POLICY_REGISTRY.default;
  if (typeof policy === "string") return CONTINUITY_POLICY_REGISTRY[policy] ?? CONTINUITY_POLICY_REGISTRY.default;

  const base = CONTINUITY_POLICY_REGISTRY.default;
  return {
    ...base,
    ...policy,
    id: policy.id ?? base.id,
    require_invariants: Array.isArray(policy.require_invariants) ? policy.require_invariants : base.require_invariants,
    fail_on_invariant: Array.isArray(policy.fail_on_invariant) ? policy.fail_on_invariant : base.fail_on_invariant,
  };
}

export function evaluateContinuityPolicy(transition, policy = "default") {
  const resolved = resolveContinuityPolicy(policy);
  const invMap = new Map((transition?.invariants_checked ?? []).map(item => [item.name, item.ok]));
  const violations = [];

  for (const name of resolved.require_invariants) {
    if (!invMap.has(name)) violations.push({ type: "missing_invariant", name });
  }

  for (const name of resolved.fail_on_invariant) {
    if (invMap.get(name) === false) violations.push({ type: "failed_invariant", name });
  }

  if (typeof transition?.residual_delta === "number" && transition.residual_delta > resolved.max_residual_delta) {
    violations.push({ type: "residual_delta_exceeded", value: transition.residual_delta, max: resolved.max_residual_delta });
  }

  if (!resolved.allow_boundary_crossing && transition?.continuity_class === "BOUNDARY_CROSSING") {
    violations.push({ type: "boundary_crossing_disallowed" });
  }

  let verdict = "PASS";
  if (violations.length) verdict = "CONTINUITY_FAIL";
  else if (transition?.continuity_class === "PASS_WITH_DRIFT") verdict = "PASS_WITH_DRIFT";
  else if (transition?.continuity_class === "BOUNDARY_CROSSING") verdict = "BOUNDARY_CROSSING";
  else if (transition?.continuity_class === "INITIALIZED") verdict = "INITIALIZED";

  return {
    policy_id: resolved.id,
    continuity_verdict: verdict,
    violations,
    enforced: true,
    policy: resolved,
  };
}

function stripStateSecrets(stateBlock = {}) {
  const { commitment_salt, ...rest } = stateBlock;
  return rest;
}

function projectKeyEntry(entry, projection) {
  if (!entry) return entry;
  const base = {
    set_at: entry.set_at,
    _e8: entry._e8,
    _continuity: entry._continuity ? stripStateSecrets(entry._continuity) : undefined,
  };

  if (projection === "private" || projection === "public") {
    return { ...base, value: entry.value };
  }
  if (projection === "witness") {
    return {
      set_at: entry.set_at,
      _e8: entry._e8,
      _continuity: entry._continuity ? {
        state_commitment: entry._continuity.state_commitment,
        cell_commitment: entry._continuity.cell_commitment,
        witness_hash: entry._continuity.witness_hash,
        payload_hash: entry._continuity.payload_hash,
        residual_class: entry._continuity.residual_class,
        opening_policy: entry._continuity.opening_policy,
      } : undefined,
    };
  }
  return {
    set_at: entry.set_at,
    _e8: entry._e8 ? {
      chart_id: entry._e8.chart_id,
      cell_key: entry._e8.cell_key,
      residual_norm: entry._e8.residual_norm,
    } : undefined,
    _continuity: entry._continuity ? {
      state_commitment: entry._continuity.state_commitment,
      cell_commitment: entry._continuity.cell_commitment,
      residual_class: entry._continuity.residual_class,
      opening_policy: entry._continuity.opening_policy,
    } : undefined,
  };
}

function projectAttachment(entry, projection) {
  if (!entry) return entry;
  const base = {
    label: entry.label,
    attached_at: entry.attached_at,
    exists_local: entry.exists_local,
    _e8: entry._e8,
    _continuity: entry._continuity ? stripStateSecrets(entry._continuity) : undefined,
  };

  if (projection === "private" || projection === "public") {
    return { ...base, resource: entry.resource };
  }
  if (projection === "witness") {
    return {
      label: entry.label,
      attached_at: entry.attached_at,
      exists_local: entry.exists_local,
      _e8: entry._e8,
      _continuity: entry._continuity ? {
        state_commitment: entry._continuity.state_commitment,
        cell_commitment: entry._continuity.cell_commitment,
        witness_hash: entry._continuity.witness_hash,
        payload_hash: entry._continuity.payload_hash,
        residual_class: entry._continuity.residual_class,
        opening_policy: entry._continuity.opening_policy,
      } : undefined,
    };
  }
  return {
    label: entry.label,
    attached_at: entry.attached_at,
    exists_local: entry.exists_local,
    _e8: entry._e8 ? {
      chart_id: entry._e8.chart_id,
      cell_key: entry._e8.cell_key,
      residual_norm: entry._e8.residual_norm,
    } : undefined,
    _continuity: entry._continuity ? {
      state_commitment: entry._continuity.state_commitment,
      cell_commitment: entry._continuity.cell_commitment,
      residual_class: entry._continuity.residual_class,
      opening_policy: entry._continuity.opening_policy,
    } : undefined,
  };
}

export function projectSpaceDocument(space, projection = "public") {
  const view = projection === "private"
    ? JSON.parse(JSON.stringify(space))
    : {
        ...space,
        _state: stripStateSecrets(space?._state ?? {}),
      };

  const keys = Object.fromEntries(
    Object.entries(space?.keys ?? {}).map(([key, value]) => [key, projectKeyEntry(value, projection)])
  );
  const attachments = (space?.attachments ?? []).map(entry => projectAttachment(entry, projection));

  return {
    ...view,
    keys,
    attachments,
  };
}