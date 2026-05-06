import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
const AKAI_BIN = join(__dirname, "..", "bin", "akai.mjs");

function now() {
  return new Date().toISOString();
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function statePaths() {
  const root = join(homedir(), ".aurekai", "mcp");
  return {
    root,
    state: join(root, "distribution-state.json"),
    log: join(root, "distribution.log"),
  };
}

function writeState(doc) {
  const p = statePaths();
  mkdirSync(p.root, { recursive: true });
  writeFileSync(p.state, JSON.stringify(doc, null, 2) + "\n");
}

function readState() {
  const p = statePaths();
  if (!existsSync(p.state)) return null;
  try {
    return JSON.parse(readFileSync(p.state, "utf8"));
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runAkai(args, env = {}) {
  const proc = spawnSync("node", [AKAI_BIN, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  const stdout = proc.stdout || "";
  const stderr = proc.stderr || "";
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = { raw_stdout: stdout };
  }
  return {
    ok: proc.status === 0,
    exit_code: proc.status,
    stdout,
    stderr,
    parsed,
  };
}

function toolList() {
  return [
    {
      name: "distribution.resolve",
      description: "Resolve and verify a CAS ref/artifact",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "string" },
        },
        required: ["ref"],
      },
    },
    {
      name: "distribution.materialize",
      description: "Materialize a CAS ref/artifact to a file path",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          out: { type: "string" },
        },
        required: ["ref", "out"],
      },
    },
    {
      name: "distribution.status",
      description: "Get CAS storage stats",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "distribution.fetch_range",
      description: "Fetch a byte range from URL/path",
      input_schema: {
        type: "object",
        properties: {
          source: { type: "string" },
          out: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
        },
        required: ["source", "out", "start", "end"],
      },
    },
  ];
}

async function dispatchTool(name, args = {}) {
  if (name === "distribution.resolve") {
    const ref = String(args.ref || "");
    if (!ref) throw new Error("distribution.resolve requires ref");
    return runAkai(["cas", "verify", ref]);
  }

  if (name === "distribution.materialize") {
    const ref = String(args.ref || "");
    const out = resolve(String(args.out || ""));
    if (!ref || !out) throw new Error("distribution.materialize requires ref and out");
    return runAkai(["cas", "materialize", ref, "--out", out]);
  }

  if (name === "distribution.status") {
    return runAkai(["cas", "stats"]);
  }

  if (name === "distribution.fetch_range") {
    const source = String(args.source || "");
    const out = resolve(String(args.out || ""));
    const start = Number(args.start);
    const end = Number(args.end);
    if (!source || !out || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error("distribution.fetch_range requires source/out/start/end");
    }
    return runAkai([
      "fetch",
      "range",
      "--url", source,
      "--out", out,
      "--start", String(start),
      "--end", String(end),
    ]);
  }

  throw new Error(`unknown tool '${name}'`);
}

function rpcOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcErr(id, code, message, data = null) {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

async function startHttpServer({ host, port }) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        const body = JSON.stringify({ ok: true, schema_version: "aurekai.mcp.health.v1", created_at: now() });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
        return;
      }

      if (req.method === "GET" && req.url === "/tools") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ schema_version: "aurekai.mcp.tools.v1", tools: toolList() }));
        return;
      }

      if (req.method === "POST" && req.url === "/rpc") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", async () => {
          let doc;
          try {
            doc = JSON.parse(body || "{}");
          } catch {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify(rpcErr(null, -32700, "parse error")));
            return;
          }

          const id = doc.id ?? null;
          const method = doc.method;
          const params = doc.params || {};

          try {
            if (method === "initialize") {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(rpcOk(id, {
                serverInfo: { name: "aurekai-mcp-distribution", version: "0.8.0" },
                capabilities: { tools: { listChanged: false } },
              })));
              return;
            }

            if (method === "tools/list") {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(rpcOk(id, { tools: toolList() })));
              return;
            }

            if (method === "tools/call") {
              const name = params.name;
              const input = params.arguments || {};
              const result = await dispatchTool(name, input);
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(rpcOk(id, {
                content: [{ type: "json", json: result.parsed }],
                isError: !result.ok,
                stderr: result.stderr,
                exit_code: result.exit_code,
              })));
              return;
            }

            // Also allow direct RPC methods for convenience.
            if (method && method.startsWith("distribution.")) {
              const result = await dispatchTool(method, params);
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(rpcOk(id, result.parsed)));
              return;
            }

            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify(rpcErr(id, -32601, `method not found: ${method}`)));
          } catch (err) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify(rpcErr(id, -32000, "internal error", { message: String(err?.message || err) })));
          }
        });
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
  });

  await new Promise((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(port, host, () => resolveP());
  });

  const addr = server.address();
  const activePort = typeof addr === "object" && addr ? addr.port : port;
  const state = {
    schema_version: "aurekai.mcp.distribution.state.v1",
    pid: process.pid,
    host,
    port: activePort,
    started_at: now(),
    rpc_url: `http://${host}:${activePort}/rpc`,
    health_url: `http://${host}:${activePort}/health`,
    tools_url: `http://${host}:${activePort}/tools`,
  };
  writeState(state);

  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    server.close(() => process.exit(0));
  });

  return state;
}

async function cmdServe(args) {
  const host = flag(args, "--host") || "127.0.0.1";
  const port = Number(flag(args, "--port") || "7779");
  const state = await startHttpServer({ host, port });
  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "mcp.serve",
    status: "PASS",
    created_at: now(),
    payload: state,
  });
}

async function cmdStart(args) {
  const host = flag(args, "--host") || "127.0.0.1";
  const port = Number(flag(args, "--port") || "7779");
  const foreground = hasFlag(args, "--foreground");

  const existing = readState();
  if (existing?.pid && isPidAlive(existing.pid)) {
    printJson({
      schema_version: "aurekai.weightops.result.v1",
      command: "mcp.start",
      status: "PASS",
      created_at: now(),
      payload: {
        already_running: true,
        ...existing,
      },
    });
    return;
  }

  if (foreground) {
    const state = await startHttpServer({ host, port });
    printJson({
      schema_version: "aurekai.weightops.result.v1",
      command: "mcp.start",
      status: "PASS",
      created_at: now(),
      payload: {
        mode: "foreground",
        ...state,
      },
    });
    return;
  }

  const p = statePaths();
  mkdirSync(p.root, { recursive: true });

  const child = spawn("node", [resolve(__filename), "serve", "--host", host, "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  const state = {
    schema_version: "aurekai.mcp.distribution.state.v1",
    pid: child.pid,
    host,
    port,
    started_at: now(),
    rpc_url: `http://${host}:${port}/rpc`,
    health_url: `http://${host}:${port}/health`,
    tools_url: `http://${host}:${port}/tools`,
    pending_boot: true,
  };
  writeState(state);

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "mcp.start",
    status: "PASS",
    created_at: now(),
    payload: {
      mode: "detached",
      ...state,
      log_path: p.log,
    },
  });
}

function cmdStatus() {
  const s = readState();
  if (!s) {
    printJson({
      schema_version: "aurekai.weightops.result.v1",
      command: "mcp.status",
      status: "PASS",
      created_at: now(),
      payload: {
        running: false,
      },
    });
    return;
  }

  const running = isPidAlive(Number(s.pid));
  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "mcp.status",
    status: "PASS",
    created_at: now(),
    payload: {
      running,
      ...s,
    },
  });
}

function cmdStop() {
  const s = readState();
  if (!s?.pid) {
    printJson({
      schema_version: "aurekai.weightops.result.v1",
      command: "mcp.stop",
      status: "PASS",
      created_at: now(),
      payload: {
        stopped: false,
        reason: "not-running",
      },
    });
    return;
  }

  let stopped = false;
  let error = null;
  try {
    process.kill(Number(s.pid), "SIGTERM");
    stopped = true;
  } catch (e) {
    error = String(e?.message || e);
  }

  if (stopped) {
    const p = statePaths();
    if (existsSync(p.state)) rmSync(p.state, { force: true });
  }

  printJson({
    schema_version: "aurekai.weightops.result.v1",
    command: "mcp.stop",
    status: error ? "WARN" : "PASS",
    created_at: now(),
    payload: {
      pid: s.pid,
      stopped,
      error,
    },
  });
}

function printHelp() {
  console.log("Usage:");
  console.log("  akai mcp start [--host <host>] [--port <port>] [--foreground]");
  console.log("  akai mcp stop");
  console.log("  akai mcp status");
  console.log("  akai mcp serve [--host <host>] [--port <port>]  # internal");
  console.log("");
  console.log("HTTP endpoints:");
  console.log("  GET  /health");
  console.log("  GET  /tools");
  console.log("  POST /rpc      (JSON-RPC 2.0: initialize, tools/list, tools/call)");
}

export async function mcpCommand(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printHelp();
    return;
  }

  if (sub === "start") return cmdStart(rest);
  if (sub === "stop") return cmdStop();
  if (sub === "status") return cmdStatus();
  if (sub === "serve") return cmdServe(rest);

  throw new Error(`unknown mcp subcommand '${sub}'`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  mcpCommand(process.argv.slice(2)).catch(err => {
    process.stderr.write(String(err?.stack || err) + "\n");
    process.exit(1);
  });
}
