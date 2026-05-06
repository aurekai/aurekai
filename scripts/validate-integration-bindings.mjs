#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  mcpDistributionStatus,
  githubActionCasImport,
  githubActionCasMaterialize,
  vscodeCasVerify,
} from "../src/integration-bindings.mjs";

const AKAI = join(process.cwd(), "bin", "akai.mjs");
const tmp = "/tmp/akai-integration-bindings-e2e";
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const casHome = join(tmp, "cas-home");
const port = 17879;

function run(args, expectCode = 0) {
  const proc = spawnSync("node", [AKAI, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, AKAI_CAS_HOME: casHome },
  });
  if (proc.status !== expectCode) {
    console.error(`FAIL: akai ${args.join(" ")} exited ${proc.status}`);
    console.error(proc.stdout);
    console.error(proc.stderr);
    process.exit(1);
  }
  try { return JSON.parse(proc.stdout); } catch { return proc.stdout; }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`ASSERT FAIL: ${msg}`);
    process.exit(1);
  }
}

async function httpJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let doc = null;
  try { doc = JSON.parse(text); } catch { doc = { raw: text }; }
  return { ok: res.ok, status: res.status, doc };
}

(async () => {
  console.log("=== 1) start mcp server ===");
  const started = run(["mcp", "start", "--host", "127.0.0.1", "--port", String(port)]);
  assert(started?.payload?.pid, "mcp start returns pid");
  console.log(`  pid=${started.payload.pid}`);

  // Give process a short chance to bind.
  await new Promise(r => setTimeout(r, 300));

  console.log("=== 2) mcp status ===");
  const status = run(["mcp", "status"]);
  assert(status?.payload?.running === true, "mcp running");
  assert(String(status?.payload?.rpc_url || "").includes(String(port)), "rpc url contains port");
  console.log(`  rpc=${status.payload.rpc_url}`);

  console.log("=== 3) mcp tools/list ===");
  const tools = await httpJson(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert(tools.ok, "tools/list HTTP ok");
  assert(Array.isArray(tools.doc?.result?.tools), "tools/list returns tools");
  assert(tools.doc.result.tools.some(t => t.name === "distribution.status"), "distribution.status present");
  console.log(`  tools=${tools.doc.result.tools.length}`);

  console.log("=== 4) mcp tool call distribution.status ===");
  const callStatus = await httpJson(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "distribution.status", arguments: {} },
    }),
  });
  assert(callStatus.ok, "tools/call HTTP ok");
  assert(callStatus.doc?.result?.isError === false, "tools/call not error");
  console.log("  PASS");

  console.log("=== 5) integration-bindings module wrappers ===");
  const sampleFile = join(tmp, "sample.bin");
  writeFileSync(sampleFile, Buffer.alloc(256 * 1024, 0xab));

  const imported = githubActionCasImport(sampleFile, "sample@v1", { AKAI_CAS_HOME: casHome });
  assert(imported.ok, "githubActionCasImport ok");

  const verify = vscodeCasVerify("sample-v1", { AKAI_CAS_HOME: casHome });
  assert(verify.ok, "vscodeCasVerify ok");

  const outPath = join(tmp, "materialized.bin");
  const mat = githubActionCasMaterialize("sample-v1", outPath, { AKAI_CAS_HOME: casHome });
  assert(mat.ok, "githubActionCasMaterialize ok");
  assert(existsSync(outPath), "materialized file exists");

  const stats = mcpDistributionStatus({ AKAI_CAS_HOME: casHome });
  assert(stats.ok, "mcpDistributionStatus ok");
  console.log("  PASS");

  console.log("=== 6) stop mcp server ===");
  const stopped = run(["mcp", "stop"]);
  assert(stopped?.payload?.stopped === true || stopped?.payload?.stopped === false, "mcp stop returns stopped flag");
  console.log(`  stopped=${stopped.payload.stopped}`);

  console.log("\nIntegration bindings validate: PASS");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
