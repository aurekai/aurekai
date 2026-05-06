<p align="center">
  <img src="assets/aurekai-logo.svg" alt="Aurekai" width="520" />
</p>

# Aurekai

**Aurekai is the operating fabric for intelligent work, built on the Akai native runtime with compatibility for the Bonfyre runtime lineage.**

Aurekai is not a wrapper around LLMs. Aurekai is a native AI operations runtime exposed through MCP, LLM tool calling, workflow engines, agent frameworks, data systems, CI/CD, infrastructure templates, and IDEs — with real commands for media, models, memory, proof, commerce, telephony, network events, reasoning, publishing, and client delivery.

Every run emits proof, lineage, metering, cache, feature, and artifact metadata.

> **v0.8.0** — WeightOps 20x: 25 commands across Groups A–E (supply chain, adapters, SAE steering, real-time ops, P2P mesh). All emit `aurekai.weightops.result.v1`. See [docs/releases.md](./docs/releases.md).
> **v0.9.0** — AK Block Calculus: `ak block inspect`, `ak block commute`, `ak gauge fix`, `ak fpqx plan`, and operator-algebra mode for `ak weights compile`. Native C block inspector. 54/54 block algebra validations pass. See [docs/releases.md](./docs/releases.md).

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

- **Runtime** — execution, routing, queue management, workflow dispatch, and release gates
- **Commerce** — auth, gate issuance, metering, invoicing, ledger, CMS, and client outreach
- **Intake** — file ingest, media normalization, transcription, segmentation, frame extraction, and speech loop
- **Memory** — `.akmodel`, `.aksae`, `.akfpqx`, FPQ compression, FPQx alignment, SAE activation, vector search, KV cache
- **Proof** — Merkle graph, lineage, equivalence indexing, SBOM, checksums, and proof bundle assembly
- **Reason** — reasoning sessions, branching, diff, physics trajectories, and learning feedback
- **Wire** — telephony simulation, PCAP ingest, wire probing/reporting, MoQ relay, and network seal/eval
- **Publish** — brief generation, narration, deliverable packing, clip extraction, and distribution
- **Substrate** — capability registry, space management, time scheduling, compression, and hardening tests
- **WeightOps** — 25 commands across supply chain integrity, adapter composition, SAE steering, real-time ops, and P2P mesh distribution
- **WeightOps** — 25 commands across supply chain integrity, adapter composition, SAE steering, real-time ops, and P2P mesh distribution
- **Block Calculus** — `ak block inspect|commute`, `ak gauge fix`, `ak fpqx plan`, operator-algebra compile; model-state programming over AK Block IR

The capability registry is the source of truth: [`registry/aurekai.capabilities.json`](./registry/aurekai.capabilities.json)

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

Each integration is a **host-native adapter over the Akai runtime** — not a wrapper. Every integration declares which capability families it exposes, which native Akai commands it binds, which platform-native primitives it exploits, and which proof/lineage/metering artifacts it emits.

See [`registry/integrations.json`](./registry/integrations.json) and [`ECOSYSTEM_NAMES.md`](./ECOSYSTEM_NAMES.md) for the full matrix.

## Deep integrations

Aurekai integrations are capability-native adapters over the Akai runtime, not thin shell wrappers.

See:
- [`registry/integrations.json`](./registry/integrations.json)
- [`registry/aurekai.capabilities.json`](./registry/aurekai.capabilities.json)

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

## Capability architecture

```
Akai Native Runtime
  → Aurekai Capability Registry  (registry/aurekai.capabilities.json)
  → Generated tool/workflow/schema bindings
  → Deep integrations for workflow engines, CI/CD, infra, IDEs, data/ML, MCP, agent frameworks, LLM providers
  → Every run emits proof, lineage, metering, cache, feature, and artifact metadata
```

Capability families and their primary commands:

| Family       | Key commands                                                        |
|--------------|---------------------------------------------------------------------|
| `runtime`    | `runtime.capabilities`, `control.route`, `queue.enqueue`, `tier.route`, `workflow.run` |
| `commerce`   | `gate.issue`, `meter.record`, `pay.invoice`, `ledger.export`, `outreach.followup` |
| `intake`     | `ingest.file`, `transcribe.audio`, `segment.speakers`, `frame_extract.video`, `speech_loop.transform` |
| `memory`     | `model.pull`, `fpq.compress`, `fpqx.align`, `sae.activate`, `vec.search`, `kvcache.chain` |
| `proof`      | `canon.hash`, `graph.lineage`, `graph.merkle`, `index.equivalence`, `proof.bundle` |
| `reason`     | `reason.start`, `reason.branch`, `physics.run`, `flow.branch`, `learn.feedback` |
| `wire`       | `tel.sim_call`, `wire.ingest_pcap`, `wire.report`, `moq.video_relay`, `net.seal` |
| `publish`    | `brief.generate`, `narrate.brief`, `pack.deliverable`, `clips.extract`, `distribute.bundle` |
| `substrate`  | `capability.registry`, `space.put`, `time.schedule`, `compress.family`, `violence.coupling_test` |
| `weightops`  | `sbom`, `tamper-detect`, `proof-chain`, `audit-trail`, `integrity-gate`, `merge`, `split`, `freeze`, `adapter-list`, `adapter-hot-swap`, `sae-probe`, `sae-steer`, `feature-drift`, `kv-compress`, `kv-restore`, `sla-monitor`, `budget-alert`, `cost-forecast`, `hot-patch`, `credit-settle`, `p2p-seed`, `relay-handoff`, `geo-pin`, `mirror-sync`, `escrow` |
| `weightops`  | `sbom`, `tamper-detect`, `proof-chain`, `audit-trail`, `integrity-gate`, `merge`, `split`, `freeze`, `adapter-list`, `adapter-hot-swap`, `sae-probe`, `sae-steer`, `feature-drift`, `kv-compress`, `kv-restore`, `sla-monitor`, `budget-alert`, `cost-forecast`, `hot-patch`, `credit-settle`, `p2p-seed`, `relay-handoff`, `geo-pin`, `mirror-sync`, `escrow` |
| `block`      | `block.inspect`, `block.commute`, `block.gauge_fix`, `fpqx.plan`, `compile.algebra` |

Validation: `node scripts/validate-capability-bindings.mjs`

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

### WeightOps (`akai weights <cmd>`)

**Group A — Supply Chain Integrity**
```bash
akai weights sbom --model llama3.akmodel
akai weights tamper-detect --model llama3.akmodel
akai weights proof-chain --model llama3.akmodel
akai weights audit-trail --model llama3.akmodel
akai weights integrity-gate --model llama3.akmodel
```

**Group B — Adapter & Composition**
```bash
akai weights adapter-list --model llama3.akmodel
akai weights adapter-hot-swap --model llama3.akmodel --adapter lora-chat-v2
akai weights merge --base llama3.akmodel --adapters lora-a,lora-b --method linear
akai weights split --model llama3.akmodel --chunks 4
akai weights freeze --model llama3.akmodel --reason production-release
```

**Group C — SAE Steering & KV Cache**
```bash
akai weights sae-probe --model llama3.akmodel --features danger,deception
akai weights sae-steer --model llama3.akmodel --feature helpfulness --direction toward
akai weights feature-drift --model-a v1.akmodel --model-b v2.akmodel
akai weights kv-compress --model llama3.akmodel --tokens 4096 --out ctx.akkvcache
akai weights kv-restore --cache ctx.akkvcache --model llama3.akmodel
```

**Group D — Real-Time Ops & Policy**
```bash
akai weights sla-monitor --model llama3.akmodel --latency-sla-ms 500
akai weights budget-alert --model llama3.akmodel --ceiling 100 --fallback route-to-cheapest
akai weights cost-forecast --model llama3.akmodel --horizon-hours 168 --rps 10
akai weights hot-patch --model llama3.akmodel --patch delta.akdelta
akai weights credit-settle --model llama3.akmodel --period 2026-05
```

**Group E — P2P Distribution & Mesh**
```bash
akai weights p2p-seed --model llama3.akmodel --chunks 16
akai weights relay-handoff --model llama3.akmodel --peer relay-peer-b
akai weights geo-pin --model llama3.akmodel --region us-east-1
akai weights mirror-sync --model llama3.akmodel --mirrors mirror-a,mirror-b
akai weights escrow --model llama3.akmodel --condition proof-chain-verified --recipient ops@example.com
```

All commands emit `aurekai.weightops.result.v1` JSON to stdout.

Compatibility aliases remain during migration:

```
bonfyre       -> akai
bonfyre-hyper -> akai
bonfyre-sae   -> akai sae
```

## AK Block Calculus

AK treats model state as executable algebra, not a byte array.

The core thesis: **a compressed model should be executable, adaptive, and context-aware.**

Every tensor in a model is a typed mathematical object — a *block* — with a coordinate system, a seed program, a residual correction, an execution policy, and a set of provable invariants. The stored tensor is not a static value. It is an operator-valued object that depends on input, context, hardware, and time:

```
𝒯(x,c,h,t) = (B + R + P) ⊙ S + Π(x,c,h,t) + Δ_seq(c,t)
```

This is the FPQ-X operator model. Six operator families govern how each block executes:

| Family | Role |
|--------|------|
| `A` | Additive — base + residual overlay |
| `M` | Multiplicative — scaled by low-rank multiplicative manifold |
| `Π` | Predictive — context-conditioned restoration |
| `D` | Distilled — compressed KV / feature atoms |
| `Λ` | Adaptive — dynamic bit policy per token/context window |
| `H` | Hardware-aligned — native SIMD/GPU lane packing |

### Block IR

A block is a typed executable object:

```
block = {
  kind:       self_attention | ffn | embedding | norm | kv_cache | ...
  space:      fpq-x | fpq | bwa | polar | lowrank | euclidean
  chart:      coordinate system identifier
  seed:       lambda/combinator seed program
  residual:   QJL | QJL+ghost | RVQ | lattice
  policy:     { bit_budget, hardware_pack, recommended_families }
  invariants: { energy_closure, subspace_compatibility, cosine, spectral_gap, eta_L, eta_R }
}
```

BWA (Bonfyre Weight Algebra) defines weight tensors as decomposable fields:

```
W = L + R
```

where `L` is the harmonic / coherent low-rank component and `R` is the structured residual. Editing, merging, or quantizing a weight block means operating on this field with conservation laws: curl correction keeps `R ⊥ col(L)`, divergence correction preserves Frobenius energy, and subspace projection maintains compatibility between components.

### Block Calculus commands

**Inspect a model block's mathematical type:**
```bash
akai block inspect model.safetensors --layer 12 --tensor q_proj
```
```
kind:                   self_attention
space:                  fpq-x
decomposition:          W = L + R
eta_L:                  0.057   (low-rank energy fraction)
eta_R:                  0.943   (residual energy fraction)
class:                  residual-heavy
recommended families:   A + M + Pi + H
spectral_gap:           3.2
hardware_pack:          NEON_128
energy_closure:         pass
subspace_compatibility: pass
```

**Check whether two operations commute:**
```bash
akai block commute --a safety_patch.akdelta --b fpqx_quant.akplan --tensor layer12.mlp
```
```
[A, B] norm:       0.031
safe to reorder:   yes
preferred order:   quantize → patch
reason:            patch lies mostly in low-rank subspace; residual distortion bounded
```

**Apply gauge-fix corrections to restore block invariants:**
```bash
akai gauge fix edited_model.akmodel --preserve energy,subspace,cosine
```
Applies: curl correction → two-sided projection → divergence correction → energy normalization. Preserves subspace compatibility and Frobenius energy after edits.

**Plan the FPQ-X operator family assignment per layer:**
```bash
akai fpqx plan model.safetensors --target edge --context 128k
```
```
A:  enabled for all dense tensors
M:  enabled for q_proj/v_proj — multiplicative gain drift correction
Π:  enabled for residual-heavy tensors and long-context attention
D:  enabled for KV cache — distilled to compressed atom set
Λ:  adaptive bit policy enabled
H:  NEON_128 packing
```
Minimizes: `min E[L_task + α L_op + β C_bw + γ C_lat + δ C_ctx]`

**Compile a model to a selected operator algebra:**
```bash
akai weights compile model.safetensors \
  --objective latency=0.2,bw=0.5,cosine=0.999 \
  --target metal
```
Outputs a per-layer operator plan. Example:
```
Layer 0  tok_emb           A+H
Layer 1  q_proj            A+M+Pi+H
Layer 4  kv_cache.past_k   D+H
Layer 19 lm_head           A+La+H
```

### Block invariants

Every block carries provable invariants:

| Invariant | Meaning |
|-----------|---------|
| `energy_closure` | Frobenius energy conserved across L + R decomposition |
| `subspace_compatibility` | R lies in orthogonal complement of col(L) |
| `cosine_similarity` | Cosine preservation after compression |
| `spectral_gap` | Separation between dominant and residual singular components |
| `eta_L / eta_R` | Energy partition fractions between low-rank and residual |
| `effective_rank` | Number of significant singular components |
| `bpw` | Bits per weight after packing |
| `hardware_pack` | Native SIMD/GPU target alignment |

### Model-state programming

AK Block Calculus is the foundation for *model-state programming*: operating on model internals below the prompt layer and above raw kernel code.

```bash
# Conceptual example of model-state programming:
akai weights compile model.safetensors --objective latency=0.2,bw=0.5,cosine=0.999 --target metal
akai gauge fix compiled.akmodel --preserve energy,subspace,cosine
akai block inspect compiled.akmodel --tensor q_proj
```

This is not prompt engineering, not fine-tuning, not ordinary quantization, and not inference serving. It is direct compilation and algebra over the model's information-flow operators.

## Native runtime lineage

Aurekai is the public platform for intelligent-work automation, built on a native runtime lineage originally developed under the Bonfyre codename.

The native runtime is tracked separately: [https://github.com/aurekai/native-runtime](https://github.com/aurekai/native-runtime)

See [`COMPATIBILITY.md`](./COMPATIBILITY.md) and [`MIGRATION.md`](./MIGRATION.md) for migration mechanics, dual-manifest rules, and `.bf*` format support.

## License

Aurekai code and tooling are licensed under Apache-2.0.

Model-memory artifacts, SAE dictionaries, FPQx alignments, and benchmark assets may carry additional upstream model or dataset terms. See each artifact manifest.

