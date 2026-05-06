#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const COMMANDS = [
  ["negotiate", "--for", "examples/call-to-brief-to-invoice.akrecipe"],
  ["hydrate", "llama-8b.q4.akmodel"],
  ["compile", "examples/call-to-brief-to-invoice.akrecipe"],
  ["status", "llama-8b.q4.akmodel"],
  ["skeleton", "llama-8b.q4.akmodel"],
  ["trace", "--recipe", "examples/call-to-brief-to-invoice.akrecipe", "--model", "llama-8b.q4.akmodel"],
  ["pull-region", "--trace", "{\"schema_version\":\"aurekai.weightops.weighttrace.v1\",\"model\":\"llama-8b.q4.akmodel\",\"regions\":[\"embed\",\"attn.q\"]}"],
  ["diff", "llama-8b.q4.akmodel", "mistral-7b.q4.akmodel"],
  ["patch", "llama-8b.q4.akmodel", "--from.akdelta"],
  ["prove", "llama-8b.q4.akmodel"],
  ["lease", "llama-8b.q4.akmodel", "--duration", "4h"],
  ["teleport", "ak:sha256:0123456789abcdef0123456789abcdef"],
  ["weightless-run", "examples/call-to-brief-to-invoice.akrecipe"],
  ["synth-quant", "--from", "llama-8b.q4.akmodel", "--to", "q8"],
  ["verify-fidelity", "llama-8b.q4.akmodel"],
  ["distill-feature-micro", "--from", "llama-8b.q4.akmodel", "--feature", "sentiment"],
  ["ghost-infer", "--recipe", "examples/call-to-brief-to-invoice.akrecipe", "--memory", "test.q4.akmemory"],
  ["marketplace", "--list"],
  ["serve-cdn", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["moq-stream", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["arb-route", "--recipe", "examples/call-to-brief-to-invoice.akrecipe", "--dry-run"],
  ["sbom", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["tamper-detect", "--model", "llama-8b.q4.akmodel", "--inject-drift"],
  ["proof-chain", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["integrity-gate", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["federated-merge", "--nodes", "node1.akmodel,node2.akmodel", "--dry-run"],
  ["dp-noise", "--model", "llama-8b.q4.akmodel", "--epsilon", "1.2", "--delta", "1e-5", "--dry-run"],
  ["drift-monitor", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["perf-profile", "--model", "llama-8b.q4.akmodel", "--tasks", "chat,embed", "--runs", "4"],
  ["ensemble-merge", "--models", "llama-8b.q4.akmodel,mistral-7b.q4.akmodel", "--dry-run"],
  ["pipeline-dag", "--validate-only"],
  ["edge-compile", "--model", "llama-8b.q4.akmodel", "--target", "wasm", "--dry-run"],
  ["quantize-target", "--model", "llama-8b.q4.akmodel", "--target", "arm-neon", "--bits", "8", "--dry-run"],
  ["audit-trail", "--model", "llama-8b.q4.akmodel"],
  ["adapter-list", "--model", "llama-8b.q4.akmodel"],
  ["adapter-hot-swap", "--model", "llama-8b.q4.akmodel", "--adapter", "lora-chat-v2", "--dry-run"],
  ["merge", "--base", "llama-8b.q4.akmodel", "--adapters", "a1,a2", "--dry-run"],
  ["split", "--model", "llama-8b.q4.akmodel", "--chunks", "4", "--dry-run"],
  ["freeze", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["sae-probe", "--model", "llama-8b.q4.akmodel", "--features", "danger,deception", "--dry-run"],
  ["sae-steer", "--model", "llama-8b.q4.akmodel", "--feature", "helpfulness", "--dry-run"],
  ["feature-drift", "--model-a", "llama-8b.q4.akmodel", "--model-b", "mistral-7b.q4.akmodel"],
  ["kv-compress", "--model", "llama-8b.q4.akmodel", "--context", "ctx-a", "--dry-run"],
  ["kv-restore", "--cache", "ctx-a.akkvcache", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["sla-monitor", "--model", "llama-8b.q4.akmodel", "--window-min", "30"],
  ["budget-alert", "--model", "llama-8b.q4.akmodel", "--ceiling", "250", "--dry-run"],
  ["cost-forecast", "--model", "llama-8b.q4.akmodel", "--recipe", "examples/call-to-brief-to-invoice.akrecipe", "--horizon-hours", "72", "--rps", "3"],
  ["hot-patch", "--model", "llama-8b.q4.akmodel", "--patch", "--from.akdelta", "--dry-run"],
  ["credit-settle", "--model", "llama-8b.q4.akmodel", "--period", "2026-05", "--dry-run"],
  ["p2p-seed", "--model", "llama-8b.q4.akmodel", "--chunks", "8", "--dry-run"],
  ["relay-handoff", "--session", "sess-a", "--peer", "relay-peer-b", "--model", "llama-8b.q4.akmodel", "--dry-run"],
  ["geo-pin", "--model", "llama-8b.q4.akmodel", "--region", "us-east-1", "--dry-run"],
  ["mirror-sync", "--model", "llama-8b.q4.akmodel", "--mirrors", "mirror-a,mirror-b", "--dry-run"],
  ["escrow", "--model", "llama-8b.q4.akmodel", "--condition", "proof-chain-verified", "--recipient", "ops@example.com", "--dry-run"],
];

let passed = 0;
let failed = 0;

for (const args of COMMANDS) {
  const proc = spawnSync("node", ["./bin/akai.mjs", "weights", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const name = args[0];

  if (!proc.stdout || !proc.stdout.trim().length) {
    failed += 1;
    console.error(`[FAIL] ${name}: no JSON envelope on stdout`);
    continue;
  }

  let env;
  try {
    env = JSON.parse(proc.stdout);
  } catch (err) {
    failed += 1;
    console.error(`[FAIL] ${name}: invalid JSON envelope (${err.message})`);
    continue;
  }

  const checks = [
    env.schema_version === "aurekai.weightops.result.v1",
    typeof env.command === "string" && env.command.startsWith("weights."),
    typeof env.status === "string",
    typeof env.created_at === "string",
    typeof env.duration_ms === "number",
    env.payload && typeof env.payload === "object",
  ];

  if (checks.every(Boolean)) {
    passed += 1;
    console.log(`[PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`[FAIL] ${name}: envelope fields missing or invalid`);
  }
}

console.log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
