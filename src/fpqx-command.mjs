/**
 * fpqx-command.mjs — FPQ-X operator family planning
 *
 * Real planning path (no synthetic layer templates):
 * - Requires a real .safetensors model file
 * - Reads tensor metadata and sample statistics
 * - Selects A/M/Pi/D/La/H per tensor from measured cost terms
 */

import { basename, extname } from "node:path";
import { parseSafeTensors, sampleTensor, vectorStats } from "./model-tensor.mjs";

const TARGETS = {
  edge:    { hw: "NEON_128",        bw_budget: 0.4, lat_budget: 0.3, ctx_budget: 0.8 },
  neon:    { hw: "NEON_128",        bw_budget: 0.5, lat_budget: 0.4, ctx_budget: 0.9 },
  metal:   { hw: "METAL_SIMDGROUP", bw_budget: 0.6, lat_budget: 0.2, ctx_budget: 1.0 },
  cuda:    { hw: "CUDA_WARP",       bw_budget: 0.8, lat_budget: 0.1, ctx_budget: 1.0 },
  cpu:     { hw: "AVX2_256",        bw_budget: 0.5, lat_budget: 0.5, ctx_budget: 0.7 },
  avx2:    { hw: "AVX2_256",        bw_budget: 0.5, lat_budget: 0.5, ctx_budget: 0.7 },
  avx512:  { hw: "AVX512_512",      bw_budget: 0.7, lat_budget: 0.3, ctx_budget: 0.8 },
  wasm:    { hw: "WASM_SIMD128",    bw_budget: 0.3, lat_budget: 0.6, ctx_budget: 0.5 },
};

const CONTEXT_SCALES = {
  "4k": 0.3, "8k": 0.4, "16k": 0.5, "32k": 0.6,
  "64k": 0.75, "128k": 1.0, "256k": 1.2, "512k": 1.5,
};

function now() { return new Date().toISOString(); }
function flag(args, name) { const i = args.indexOf(name); return i === -1 ? null : (args[i + 1] ?? true); }
function hasFlag(args, name) { return args.includes(name); }
function printJson(obj) { console.log(JSON.stringify(obj, null, 2)); }

function requireRealModel(path) {
  if (!path) throw new Error("Model path is required");
  const ext = extname(path).toLowerCase();
  if (ext !== ".safetensors") {
    throw new Error(`Unsupported model format '${ext || "(none)"}'. fpqx plan requires a real .safetensors model.`);
  }
}

function buildCandidates(kind, ctxScale) {
  if (kind === "kv_cache") return [["D", "La", "H"], ["D", "H"], ["D", "Pi", "H"]];
  if (kind === "embedding") return [["A", "La", "H"], ["A", "H"], ["A", "M", "H"]];
  if (kind === "norm") return [["A", "H"], ["A"]];
  if (kind === "self_attention" || kind === "cross_attention") {
    const base = [["A", "M", "Pi", "H"], ["A", "M", "H"], ["A", "Pi", "H"]];
    if (ctxScale >= 0.75) base.push(["A", "M", "Pi", "La", "H"]);
    return base;
  }
  if (kind === "ffn") return [["A", "M", "H"], ["A", "H"], ["A", "M", "La", "H"]];
  return [["A", "M", "H"], ["A", "H"]];
}

function lagrangianCost(families, tensor, stats, targetSpec, ctxScale) {
  const alpha = 0.3, beta = 0.25, gamma = 0.25, delta = 0.2;

  const outlierRatio = stats.p95Abs > 0 ? (stats.maxAbs / stats.p95Abs) : 1;
  const shapeAspect = tensor.shape.length >= 2
    ? Math.max(tensor.shape[tensor.shape.length - 1], tensor.shape[tensor.shape.length - 2]) /
      Math.max(1, Math.min(tensor.shape[tensor.shape.length - 1], tensor.shape[tensor.shape.length - 2]))
    : 1;
  const L_task = Math.min(1, (stats.stddev / Math.max(1e-8, stats.meanAbs + 1e-8)) * 0.08 + outlierRatio * 0.02 + shapeAspect * 0.002);

  const L_op = families.length * 0.015;

  const bwPressure = tensor.bytes / Math.max(1, tensor.elements);
  const C_bw = Math.max(0, bwPressure * 0.15 - (families.includes("H") ? 0.08 : 0) - targetSpec.bw_budget * 0.05);

  const flopsProxy = tensor.elements * Math.max(1, tensor.shape[tensor.shape.length - 1] || 1);
  const C_lat = (Math.log10(flopsProxy + 1) * 0.05) * (families.includes("La") ? 1.2 : 1.0) * (families.includes("H") ? 0.75 : 1.0) * targetSpec.lat_budget;

  const attentionFactor = (tensor.kind === "self_attention" || tensor.kind === "cross_attention") ? 1.4 : 0.6;
  const C_ctx = ctxScale * attentionFactor * (families.includes("Pi") ? 0.35 : 0.12) * (families.includes("D") ? 0.55 : 1.0);

  return alpha * L_task + beta * C_bw + gamma * C_lat + delta * C_ctx + L_op;
}

function chooseFamilies(tensor, stats, targetSpec, ctxScale) {
  const candidates = buildCandidates(tensor.kind, ctxScale);
  let best = candidates[0];
  let bestCost = Infinity;
  for (const fam of candidates) {
    const cost = lagrangianCost(fam, tensor, stats, targetSpec, ctxScale);
    if (cost < bestCost) {
      bestCost = cost;
      best = fam;
    }
  }
  return { families: best, lagrangian_cost: Number(bestCost.toFixed(6)) };
}

export async function fpqxCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === "plan" || sub === undefined) return cmdFpqxPlan(sub === "plan" ? rest : args);
  console.error(`akai fpqx: unknown subcommand '${sub || ""}'`);
  console.error("  Available: plan");
  process.exit(1);
}

async function cmdFpqxPlan(args) {
  const modelPath = args.find(a => !a.startsWith("--")) || null;
  const target = (flag(args, "--target") || "edge").toLowerCase();
  const context = (flag(args, "--context") || "8k").toLowerCase();
  const json = hasFlag(args, "--json");
  const verbose = hasFlag(args, "--verbose");

  const targetSpec = TARGETS[target] || TARGETS.edge;
  const ctxScale = CONTEXT_SCALES[context] || CONTEXT_SCALES["8k"];

  try {
    requireRealModel(modelPath);
    const parsed = parseSafeTensors(modelPath);

    const plan = parsed.tensors.map((t, idx) => {
      const samples = sampleTensor(modelPath, t, 2048);
      const stats = vectorStats(samples);
      const { families, lagrangian_cost } = chooseFamilies(t, stats, targetSpec, ctxScale);
      return {
        layer: idx,
        name: t.name,
        kind: t.kind,
        dtype: t.dtype,
        shape: t.shape,
        elements: t.elements,
        bytes: t.bytes,
        mean_abs: Number(stats.meanAbs.toFixed(6)),
        stddev: Number(stats.stddev.toFixed(6)),
        zero_frac: Number(stats.zeroFrac.toFixed(6)),
        families,
        lagrangian_cost,
        hardware_pack: targetSpec.hw,
      };
    });

    const allFamilies = new Set(plan.flatMap(p => p.families));
    const summary = {
      A: allFamilies.has("A") ? "enabled where additive overlay improves loss/bw tradeoff" : undefined,
      M: allFamilies.has("M") ? "enabled where multiplicative manifold improves dense transforms" : undefined,
      Pi: allFamilies.has("Pi") ? "enabled where context-conditioned restoration reduces context cost" : undefined,
      D: allFamilies.has("D") ? "enabled where distilled representation minimizes cache footprint" : undefined,
      La: allFamilies.has("La") ? "enabled where adaptive bits lower objective under target constraints" : undefined,
      H: allFamilies.has("H") ? `${targetSpec.hw} packing selected for hardware alignment` : undefined,
    };
    for (const k of Object.keys(summary)) {
      if (!summary[k]) delete summary[k];
    }

    const result = {
      schema_version: "aurekai.fpqx.plan.v1",
      command: "fpqx.plan",
      timestamp: now(),
      model: basename(modelPath),
      model_format: parsed.format,
      target,
      hardware_pack: targetSpec.hw,
      context_window: context,
      context_scale: ctxScale,
      bw_budget: targetSpec.bw_budget,
      lat_budget: targetSpec.lat_budget,
      ctx_budget: targetSpec.ctx_budget,
      operator_model: "𝒯(x,c,h,t) = (B + R + P) ⊙ S + Π(x,c,h,t) + Δ_seq(c,t)",
      lagrangian: "min E[L_task + α L_op + β C_bw + γ C_lat + δ C_ctx]",
      families_enabled: summary,
      layer_plan: plan,
      total_layers: plan.length,
      avg_lagrangian_cost: Number((plan.reduce((s, p) => s + p.lagrangian_cost, 0) / Math.max(1, plan.length)).toFixed(6)),
      provenance: "measured",
      status: "PASS",
    };

    if (json) {
      printJson(result);
    } else {
      console.log(`\nAK FPQ-X Plan — ${basename(modelPath)}`);
      console.log(`  target:   ${target} (${targetSpec.hw})`);
      console.log(`  context:  ${context} (scale: ${ctxScale})`);
      console.log(`  source:   measured tensor stats (${parsed.tensorCount} tensors)`);
      console.log(`\n  Layer plan:`);
      for (const p of plan.slice(0, 60)) {
        console.log(`    ${String(p.layer).padStart(4)} ${p.name.padEnd(42)} ${p.families.join("+").padEnd(18)} cost=${p.lagrangian_cost}`);
      }
      if (plan.length > 60) console.log(`    ... ${plan.length - 60} more tensors`);
      if (verbose) console.log(`\n  Avg Lagrangian cost: ${result.avg_lagrangian_cost}`);
    }

    return result;
  } catch (error) {
    console.error(`akai fpqx plan: ${error.message}`);
    process.exit(1);
  }
}
