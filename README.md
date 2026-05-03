<p align="center">
  <img src="assets/aurekai-logo.svg" alt="Aurekai" width="520" />
</p>

# Aurekai

**Aurekai is the operating fabric for intelligent work.**

Aurekai connects runtime validation, model memory, semantic cache, proof bundles, workflow orchestration, LLM provider integrations, and developer tooling into one traceable AI-native platform.

```bash
bun add -g @aurekai/runtime
akai doctor --deep
```

## Quick start

```bash
akai --help
akai doctor --deep
akai install --user
akai dashboard
akai run recipe.json --sae-audit --semantic-cache
```

## What Aurekai includes

- **Runtime** — execution, validation, install, dashboard, release gates
- **Memory** — `.akmodel`, `.aksae`, `.akfpqx`, semantic cache, feature SQL
- **Proof** — manifests, lineage, SBOM, checksums, proof bundles
- **Integrations** — LLM providers, agent frameworks, workflow engines, data/ML, infra, IDEs
- **Compatibility** — legacy Bonfyre operators, manifests, and `.bf*` formats

## Public packages

| Surface      | Package                                                                          |
|--------------|----------------------------------------------------------------------------------|
| npm          | [`@aurekai/runtime`](https://www.npmjs.com/package/@aurekai/runtime)             |
| PyPI         | [`aurekai`](https://pypi.org/project/aurekai/)                                   |
| JSR          | [`@aurekai/sdk`](https://jsr.io/@aurekai/sdk)                                    |
| Homebrew     | `aurekai/homebrew-tap`                                                            |
| Open VSX     | `aurekai-workbench`                                                               |
| MCP          | [`@aurekai/mcp`](https://www.npmjs.com/package/@aurekai/mcp)                     |
| Hugging Face | `aurekai/model-memory`, `aurekai/sae-dictionaries`, `aurekai/fpqx-alignments`    |

See the latest [GitHub Release](https://github.com/aurekai/aurekai/releases) for platform binaries, manifests, SBOM, and checksums.

## Ecosystem integrations

Aurekai maintains active integration surfaces across LLM providers, agent frameworks, workflow orchestrators, data/ML tools, infrastructure platforms, IDE/dev environments, MCP, package managers, and model-memory registries.

See [`registry/integrations.json`](./registry/integrations.json) and [`ECOSYSTEM_NAMES.md`](./ECOSYSTEM_NAMES.md) for the full matrix.

### LLM providers

OpenAI · Anthropic · Gemini · Mistral · Groq · xAI · Perplexity · Cohere · local Llama stacks · Gateway · Evals

### Agent frameworks

LangChain · LlamaIndex · Haystack · Semantic Kernel · AutoGen · CrewAI

### Workflow and orchestration

Kestra · Airflow · Prefect · Dagster · Temporal · n8n · Node-RED · GitHub Actions · GitLab CI · Argo Workflows · Tekton

### Data and ML

MLflow · W&B · DVC · DuckDB · SQLite · PostgreSQL

### Infrastructure and developer environments

Terraform · Pulumi · Helm · Kubernetes · Nix · VS Code · Open VSX · Dev Containers · Codespaces · Gitpod

## Formats

### Aurekai-first

| Format     | Purpose                              |
|------------|--------------------------------------|
| `.akmodel` | model weight pack                    |
| `.aksae`   | SAE feature dictionary               |
| `.akfpqx`  | cross-model FPQx alignment manifest  |

### Legacy-compatible

| Format     | Alias      |
|------------|------------|
| `.bfmodel` | `.akmodel` |
| `.bfsae`   | `.aksae`   |
| `.bffpqx`  | `.akfpqx`  |

## Manifest bridge

Every Aurekai release includes:

| Manifest                | Purpose                                  |
|-------------------------|------------------------------------------|
| `aurekai.manifest.json` | public distribution metadata             |
| `bonfyre.manifest.json` | native runtime compatibility validation  |

This is not a bug. It is the bridge.

## CLI

```bash
akai doctor --deep
akai dashboard
akai run <recipe> [--input FILE] [--sae-audit] [--semantic-cache]
akai install --user
akai sae:activate --dict default.aksae --residual residual.bin
akai model:inspect qwen3-8b.akmodel
akai fpqx:align-sae --from qwen3-8b.l24.aksae --to llama3-8b.l26.aksae --out qwen3-to-llama3.akfpqx
akai query:features "feature:6159 > 0.7"
```

Compatibility aliases remain during migration:

```
bonfyre       -> akai
bonfyre-hyper -> akai
bonfyre-sae   -> akai sae
```

## Native runtime lineage

Aurekai is the public platform for intelligent-work automation, built on a native runtime lineage originally developed under the Bonfyre codename.

The native runtime is tracked separately: [https://github.com/aurekai/native-runtime](https://github.com/aurekai/native-runtime)

See [`COMPATIBILITY.md`](./COMPATIBILITY.md) and [`MIGRATION.md`](./MIGRATION.md) for migration mechanics, dual-manifest rules, and `.bf*` format support.

## License

Aurekai code and tooling are licensed under Apache-2.0.

Model-memory artifacts, SAE dictionaries, FPQx alignments, and benchmark assets may carry additional upstream model or dataset terms. See each artifact manifest.

