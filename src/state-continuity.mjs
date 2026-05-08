import { createHash } from "node:crypto";
import { compile as compileChart, detectChart } from "./chart-compiler.mjs";
import { e8SquaredDist } from "./e8-lattice.mjs";

const COMMITMENT_SCHEMA = "aurekai.state.commitment.v1";
const TRANSITION_SCHEMA = "aurekai.state.transition.v1";
const COMMITTED_STATE_SCHEMA = "akai.committed_state.v1";
const TRANSITION_OBJECT_SCHEMA = "akai.transition.v1";
const TRAJECTORY_SCHEMA = "akai.trajectory.v1";
const LINEAGE_EDGE_SCHEMA = "akai.lineage_edge.v1";

const CHART_FAMILY_REGISTRY = {
  generic: { id: "generic", domain: "general" },
  text_proof: { id: "text_proof", domain: "proof" },
  geo_runtime: { id: "geo_runtime", domain: "runtime" },
  memory: { id: "memory", domain: "memory" },
  model_block: { id: "model_block", domain: "model" },
  liquidity_topology: { id: "liquidity_topology", domain: "finance" },
  collateral_graph: { id: "collateral_graph", domain: "finance" },
  oracle_round: { id: "oracle_round", domain: "oracle" },
  bridge_packet: { id: "bridge_packet", domain: "transport" },
  execution_batch: { id: "execution_batch", domain: "execution" },
  availability_root: { id: "availability_root", domain: "data-availability" },
  trust_topology: { id: "trust_topology", domain: "trust" },
  governance_state: { id: "governance_state", domain: "governance" },
  identity_claim: { id: "identity_claim", domain: "identity" },
  media_pipeline: { id: "media_pipeline", domain: "media" },
  workflow_state: { id: "workflow_state", domain: "workflow" },
};

const LINEAGE_EDGE_TYPES = [
  "transport-edge",
  "execution-edge",
  "settlement-edge",
  "liquidity-edge",
  "collateral-edge",
  "oracle-edge",
  "availability-edge",
  "trust-edge",
  "identity-edge",
  "fulfillment-edge",
  "generic-edge",
];

const ALL_CHARTS = Object.keys(CHART_FAMILY_REGISTRY);

const CONTINUITY_POLICY_REGISTRY = {
  default: {
    id: "default",
    description: "Default continuity policy",
    max_residual_delta: 1.1,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    required_witnesses: ["next_state_witness"],
    chart_transition_map: Object.fromEntries(ALL_CHARTS.map(chart => [chart, ALL_CHARTS])),
  },
  strict: {
    id: "strict",
    description: "Strict continuity policy",
    max_residual_delta: 0.9,
    allow_boundary_crossing: false,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded", "neighborhood_preserved"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "residual_bounded", "neighborhood_preserved", "prior_commitment_present"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: Object.fromEntries(ALL_CHARTS.map(chart => [chart, [chart]])),
  },
  handoff: {
    id: "handoff",
    description: "Relaxed chart crossing, strict witness continuity",
    max_residual_delta: 1.2,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded", "prior_commitment_present"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: {
      generic: ["generic", "geo_runtime", "memory"],
      geo_runtime: ["geo_runtime", "memory", "generic"],
      memory: ["memory", "geo_runtime", "generic"],
      text_proof: ["text_proof", "generic"],
      model_block: ["model_block", "generic", "memory"],
      bridge_packet: ["bridge_packet", "geo_runtime", "execution_batch", "trust_topology"],
      execution_batch: ["execution_batch", "bridge_packet", "availability_root", "generic"],
      availability_root: ["availability_root", "execution_batch", "generic"],
      trust_topology: ["trust_topology", "bridge_packet", "identity_claim", "generic"],
      identity_claim: ["identity_claim", "trust_topology", "generic"],
    },
  },
  finality: {
    id: "finality",
    description: "Finality-sensitive continuity policy",
    max_residual_delta: 0.55,
    allow_boundary_crossing: false,
    require_invariants: ["commitment_bound", "witness_bound", "prior_commitment_present", "neighborhood_preserved"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present", "neighborhood_preserved"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: {
      execution_batch: ["execution_batch"],
      availability_root: ["availability_root"],
      generic: ["generic", "execution_batch", "availability_root"],
    },
  },
  settlement: {
    id: "settlement",
    description: "Settlement continuity with conservative drift budget",
    max_residual_delta: 0.7,
    allow_boundary_crossing: false,
    require_invariants: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: {
      liquidity_topology: ["liquidity_topology", "collateral_graph"],
      collateral_graph: ["collateral_graph", "liquidity_topology"],
      generic: ["generic", "liquidity_topology", "collateral_graph"],
    },
  },
  liquidity: {
    id: "liquidity",
    description: "Liquidity topology continuity policy",
    max_residual_delta: 1.0,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded"],
    fail_on_invariant: ["commitment_bound", "witness_bound"],
    required_witnesses: ["next_state_witness"],
    chart_transition_map: {
      liquidity_topology: ["liquidity_topology", "collateral_graph", "generic"],
      collateral_graph: ["collateral_graph", "liquidity_topology", "generic"],
      generic: ["generic", "liquidity_topology", "collateral_graph"],
    },
  },
  collateral: {
    id: "collateral",
    description: "Collateral continuity policy",
    max_residual_delta: 0.85,
    allow_boundary_crossing: false,
    require_invariants: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: {
      collateral_graph: ["collateral_graph"],
      generic: ["generic", "collateral_graph"],
    },
  },
  oracle: {
    id: "oracle",
    description: "Oracle round continuity policy",
    max_residual_delta: 0.95,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: {
      oracle_round: ["oracle_round", "generic"],
      generic: ["generic", "oracle_round"],
    },
  },
  availability: {
    id: "availability",
    description: "Availability root continuity policy",
    max_residual_delta: 0.9,
    allow_boundary_crossing: false,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "residual_bounded"],
    required_witnesses: ["next_state_witness"],
    chart_transition_map: {
      availability_root: ["availability_root"],
      generic: ["generic", "availability_root"],
    },
  },
  privacy: {
    id: "privacy",
    description: "Privacy-preserving continuity policy",
    max_residual_delta: 1.05,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound"],
    fail_on_invariant: ["commitment_bound", "witness_bound"],
    required_witnesses: ["next_state_witness"],
    chart_transition_map: {
      identity_claim: ["identity_claim", "trust_topology", "generic"],
      trust_topology: ["trust_topology", "identity_claim", "generic"],
      generic: ["generic", "identity_claim", "trust_topology"],
    },
  },
  restaking: {
    id: "restaking",
    description: "Trust export/restaking continuity policy",
    max_residual_delta: 0.75,
    allow_boundary_crossing: false,
    require_invariants: ["commitment_bound", "witness_bound", "prior_commitment_present", "neighborhood_preserved"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present", "neighborhood_preserved"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: {
      trust_topology: ["trust_topology", "collateral_graph"],
      collateral_graph: ["collateral_graph", "trust_topology"],
      generic: ["generic", "trust_topology", "collateral_graph"],
    },
  },
  execution_pipeline: {
    id: "execution_pipeline",
    description: "Execution pipeline continuity policy",
    max_residual_delta: 0.82,
    allow_boundary_crossing: true,
    require_invariants: ["commitment_bound", "witness_bound", "residual_bounded", "prior_commitment_present"],
    fail_on_invariant: ["commitment_bound", "witness_bound", "prior_commitment_present"],
    required_witnesses: ["next_state_witness", "prior_state_witness"],
    chart_transition_map: {
      execution_batch: ["execution_batch", "bridge_packet", "availability_root", "generic"],
      bridge_packet: ["bridge_packet", "execution_batch", "generic"],
      availability_root: ["availability_root", "execution_batch", "generic"],
      workflow_state: ["workflow_state", "execution_batch", "generic"],
      generic: ["generic", "execution_batch", "bridge_packet", "availability_root", "workflow_state"],
    },
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
  const witnesses = [
    { name: "next_state_witness", hash: nextState?.witness_hash ?? null },
    { name: "prior_state_witness", hash: previousState?.witness_hash ?? null },
  ].filter(w => w.hash);
  const transitionWitness = hashValue({
    transition_type: transitionType,
    prior_commitment: previousState?.state_commitment ?? null,
    next_commitment: nextState?.state_commitment ?? null,
    residual_delta: residualDelta,
    continuity_class: continuityClass,
    witnesses,
  });

  return {
    schema_version: TRANSITION_SCHEMA,
    transition_type: transitionType,
    continuity_relation: `${previousState?.chart_id ?? "null"}->${nextState?.chart_id ?? "null"}`,
    prior_commitment: previousState?.state_commitment ?? null,
    next_commitment: nextState?.state_commitment ?? null,
    chart_transition: {
      from: previousState?.chart_id ?? null,
      to: nextState?.chart_id ?? null,
    },
    residual_delta: residualDelta,
    transition_witness: transitionWitness,
    witnesses,
    invariants_checked: invariantsChecked,
    continuity_class: continuityClass,
    opening_policy: openingPolicy,
    metadata,
  };
}

export function verifyCommittedState({
  committedState,
  payload,
  chartType = null,
  chartAnnotation = null,
  commitmentSalt = "",
  publicFields = {},
  openingPolicy = null,
  stateType = null,
}) {
  if (!committedState || typeof committedState !== "object") {
    return { ok: false, reason: "missing_committed_state" };
  }

  const expected = buildCommittedState({
    stateType: stateType ?? committedState.state_type,
    payload,
    chartType,
    chartAnnotation,
    openingPolicy: openingPolicy ?? committedState.opening_policy ?? "commit-only",
    commitmentSalt,
    publicFields,
  });

  const checks = {
    state_commitment: expected.state_commitment === committedState.state_commitment,
    cell_commitment: expected.cell_commitment === committedState.cell_commitment,
    witness_hash: expected.witness_hash === committedState.witness_hash,
    payload_hash: expected.payload_hash === committedState.payload_hash,
    chart_id: expected.chart_id === committedState.chart_id,
    cell_key: expected.cell_key === committedState.cell_key,
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    expected,
  };
}

export function verifyTransitionRecord({
  transition,
  previousState = null,
  nextState,
  openingPolicy = "commit-only",
  metadata = {},
}) {
  if (!transition || typeof transition !== "object") return { ok: false, reason: "missing_transition" };
  const expected = buildTransitionRecord({
    transitionType: transition.transition_type,
    previousState,
    nextState,
    openingPolicy,
    metadata,
  });
  const checks = {
    prior_commitment: expected.prior_commitment === transition.prior_commitment,
    next_commitment: expected.next_commitment === transition.next_commitment,
    residual_delta: expected.residual_delta === transition.residual_delta,
    continuity_class: expected.continuity_class === transition.continuity_class,
    transition_witness: expected.transition_witness === transition.transition_witness,
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    ok: failures.length === 0,
    checks,
    failures,
    expected,
  };
}

function isChartTransitionAllowed(chartMap, fromChart, toChart) {
  if (!fromChart || !toChart || fromChart === toChart) return true;
  const allowed = chartMap?.[fromChart];
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.includes(toChart);
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
    required_witnesses: Array.isArray(policy.required_witnesses) ? policy.required_witnesses : base.required_witnesses,
    chart_transition_map: policy.chart_transition_map ?? base.chart_transition_map,
  };
}

export function evaluateContinuityPolicy(transition, policy = "default") {
  const resolved = resolveContinuityPolicy(policy);
  const isInitializedTransition = transition?.continuity_class === "INITIALIZED" || !transition?.prior_commitment;
  const skipForInitialized = new Set(["prior_commitment_present", "neighborhood_preserved", "prior_state_witness"]);
  const requiredInvariants = (resolved.require_invariants ?? []).filter(name => !isInitializedTransition || !skipForInitialized.has(name));
  const failOnInvariants = (resolved.fail_on_invariant ?? []).filter(name => !isInitializedTransition || !skipForInitialized.has(name));
  const requiredWitnesses = (resolved.required_witnesses ?? []).filter(name => !isInitializedTransition || !skipForInitialized.has(name));
  const invMap = new Map((transition?.invariants_checked ?? []).map(item => [item.name, item.ok]));
  const violations = [];

  for (const name of requiredInvariants) {
    if (!invMap.has(name)) violations.push({ type: "missing_invariant", name });
  }

  for (const name of failOnInvariants) {
    if (invMap.get(name) === false) violations.push({ type: "failed_invariant", name });
  }

  const witnessSet = new Set((transition?.witnesses ?? []).map(w => w.name));
  for (const required of requiredWitnesses) {
    if (!witnessSet.has(required)) violations.push({ type: "missing_witness", name: required });
  }

  if (typeof transition?.residual_delta === "number" && transition.residual_delta > resolved.max_residual_delta) {
    violations.push({ type: "residual_delta_exceeded", value: transition.residual_delta, max: resolved.max_residual_delta });
  }

  if (!resolved.allow_boundary_crossing && transition?.continuity_class === "BOUNDARY_CROSSING") {
    violations.push({ type: "boundary_crossing_disallowed" });
  }

  const fromChart = transition?.chart_transition?.from ?? null;
  const toChart = transition?.chart_transition?.to ?? null;
  if (!isChartTransitionAllowed(resolved.chart_transition_map, fromChart, toChart)) {
    violations.push({ type: "chart_transition_disallowed", from: fromChart, to: toChart });
  }

  let verdict = "PASS";
  if (violations.length) verdict = "CONTINUITY_FAIL";
  else if (transition?.continuity_class === "PASS_WITH_DRIFT") verdict = "PASS_WITH_DRIFT";
  else if (transition?.continuity_class === "BOUNDARY_CROSSING") verdict = "BOUNDARY_CROSSING";
  else if (transition?.continuity_class === "INITIALIZED") verdict = "INITIALIZED";

  const failConditionFields = {
    failed_invariants: violations.filter(v => v.type === "failed_invariant").map(v => v.name),
    missing_invariants: violations.filter(v => v.type === "missing_invariant").map(v => v.name),
    missing_witnesses: violations.filter(v => v.type === "missing_witness").map(v => v.name),
    residual_delta_exceeded: violations.some(v => v.type === "residual_delta_exceeded"),
    boundary_crossing_disallowed: violations.some(v => v.type === "boundary_crossing_disallowed"),
    chart_transition_disallowed: violations.some(v => v.type === "chart_transition_disallowed"),
  };

  const triggeredFailConditions = [
    ...failConditionFields.failed_invariants,
    ...failConditionFields.missing_invariants.map(name => `missing_invariant:${name}`),
    ...failConditionFields.missing_witnesses.map(name => `missing_witness:${name}`),
    ...(failConditionFields.residual_delta_exceeded ? ["residual_delta_exceeded"] : []),
    ...(failConditionFields.boundary_crossing_disallowed ? ["boundary_crossing_disallowed"] : []),
    ...(failConditionFields.chart_transition_disallowed ? ["chart_transition_disallowed"] : []),
  ];

  let riskScore = 0;
  if (failConditionFields.failed_invariants.length) riskScore += 0.35;
  if (failConditionFields.missing_witnesses.length) riskScore += 0.25;
  if (failConditionFields.residual_delta_exceeded) riskScore += 0.2;
  if (failConditionFields.boundary_crossing_disallowed) riskScore += 0.15;
  if (failConditionFields.chart_transition_disallowed) riskScore += 0.15;
  if (failConditionFields.missing_invariants.length) riskScore += 0.1;
  if (transition?.continuity_class === "PASS_WITH_DRIFT") riskScore = Math.max(riskScore, 0.25);
  if (transition?.continuity_class === "BOUNDARY_CROSSING") riskScore = Math.max(riskScore, 0.3);
  if (verdict === "PASS" || verdict === "INITIALIZED") riskScore = Math.min(riskScore, 0.1);
  riskScore = round(Math.max(0, Math.min(1, riskScore)));

  return {
    policy_id: resolved.id,
    continuity_verdict: verdict,
    violations,
    fail_condition_fields: failConditionFields,
    triggered_fail_conditions: triggeredFailConditions,
    risk_score: riskScore,
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

export function buildCommittedStateObject(committedState, publicProjection = null) {
  return {
    schema_version: COMMITTED_STATE_SCHEMA,
    state_type: committedState?.state_type ?? null,
    chart_id: committedState?.chart_id ?? null,
    cell: committedState?.cell ?? null,
    cell_key: committedState?.cell_key ?? null,
    residual_norm: committedState?.residual_norm ?? null,
    residual_class: committedState?.residual_class ?? null,
    payload_hash: committedState?.payload_hash ?? null,
    witness_hash: committedState?.witness_hash ?? null,
    cell_commitment: committedState?.cell_commitment ?? null,
    state_commitment: committedState?.state_commitment ?? null,
    opening_policy: committedState?.opening_policy ?? null,
    public_projection: publicProjection,
  };
}

export function buildTransitionObject(transition, deformationScore = null) {
  return {
    schema_version: TRANSITION_OBJECT_SCHEMA,
    transition_type: transition?.transition_type ?? null,
    continuity_relation: transition?.continuity_relation ?? null,
    prior_commitment: transition?.prior_commitment ?? null,
    next_commitment: transition?.next_commitment ?? null,
    chart_transition: transition?.chart_transition ?? null,
    residual_delta: transition?.residual_delta ?? null,
    transition_witness: transition?.transition_witness ?? null,
    continuity_class: transition?.continuity_class ?? null,
    continuity_verdict: transition?.continuity_verdict ?? null,
    invariants_checked: transition?.invariants_checked ?? [],
    continuity_policy: transition?.continuity_policy ?? null,
    witnesses: transition?.witnesses ?? [],
    deformation_score: deformationScore ?? transition?.residual_delta ?? null,
  };
}

export function buildTrajectoryObject({
  trajectoryRoot = null,
  historyAccumulator = null,
  foldedWitness = null,
  stepCount = 0,
  continuityEdgeCount = 0,
  continuitySummary = null,
  openingPolicy = null,
  projectionMode = "public",
}) {
  return {
    schema_version: TRAJECTORY_SCHEMA,
    trajectory_root: trajectoryRoot,
    history_accumulator: historyAccumulator,
    folded_witness: foldedWitness,
    step_count: stepCount,
    continuity_edge_count: continuityEdgeCount,
    continuity_summary: continuitySummary,
    opening_policy: openingPolicy,
    projection_mode: projectionMode,
  };
}

export function buildLineageEdgeObject({
  edgeType = "generic-edge",
  fromCommitment = null,
  toCommitment = null,
  transitionType = null,
  relation = null,
  residualDelta = null,
  continuityVerdict = null,
  witnessRef = null,
}) {
  return {
    schema_version: LINEAGE_EDGE_SCHEMA,
    edge_type: LINEAGE_EDGE_TYPES.includes(edgeType) ? edgeType : "generic-edge",
    from_commitment: fromCommitment,
    to_commitment: toCommitment,
    transition_type: transitionType,
    relation,
    residual_delta: residualDelta,
    continuity_verdict: continuityVerdict,
    witness_ref: witnessRef,
  };
}

export {
  COMMITTED_STATE_SCHEMA,
  TRANSITION_OBJECT_SCHEMA,
  TRAJECTORY_SCHEMA,
  LINEAGE_EDGE_SCHEMA,
  CHART_FAMILY_REGISTRY,
  LINEAGE_EDGE_TYPES,
  CONTINUITY_POLICY_REGISTRY,
};