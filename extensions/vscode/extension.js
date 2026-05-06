const vscode = require("vscode");
const { exec } = require("node:child_process");

function runCommand(command, label) {
  const terminal = vscode.window.createTerminal({ name: label });
  terminal.show();
  terminal.sendText(command);
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aurekai.doctor", () => runCommand("akai doctor --deep", "Aurekai Doctor")),
    vscode.commands.registerCommand("aurekai.run", async () => {
      const recipe = await vscode.window.showInputBox({ prompt: "Recipe path or inline recipe" });
      if (recipe) runCommand(`akai run ${recipe}`, "Aurekai Run");
    }),
    vscode.commands.registerCommand("aurekai.install", () => runCommand("akai install --user", "Aurekai Install")),
    vscode.commands.registerCommand("aurekai.dashboard", () => runCommand("akai dashboard", "Aurekai Dashboard")),
    vscode.commands.registerCommand("aurekai.inspectModel", async () => {
      const uri = await vscode.window.showOpenDialog({ filters: { "Aurekai Model": ["akmodel", "bfmodel"] }, canSelectMany: false });
      if (uri && uri[0]) runCommand(`akai model:inspect "${uri[0].fsPath}"`, "Aurekai Model Inspect");
    }),
    vscode.commands.registerCommand("aurekai.inspectManifest", async () => {
      const editor = vscode.window.activeTextEditor;
      const manifestPath = editor && editor.document ? editor.document.uri.fsPath : "aurekai.manifest.json";
      runCommand(`akai manifest:print --file "${manifestPath}"`, "Aurekai Manifest");
    }),
    vscode.commands.registerCommand("aurekai.mcpStart", () =>
      runCommand("akai mcp start", "Aurekai MCP Start")
    ),
    vscode.commands.registerCommand("aurekai.mcpStop", () =>
      runCommand("akai mcp stop", "Aurekai MCP Stop")
    ),
    vscode.commands.registerCommand("aurekai.casMaterialize", async () => {
      const ref = await vscode.window.showInputBox({ prompt: "CAS ref or artifact id (e.g. my-model@v1 or ak://sha256:...)" });
      if (!ref) return;
      const out = await vscode.window.showInputBox({ prompt: "Output file path" });
      if (!out) return;
      runCommand(`akai cas materialize "${ref}" --out "${out}"`, "Aurekai CAS Materialize");
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };