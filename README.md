<p align="center">
  <img src="assets/aurekai-logo.svg" alt="Aurekai" width="520" />
</p>

# Aurekai

Aurekai is the public platform layer for the Bonfyre native runtime.

The `akai` CLI provides the Aurekai front door while preserving compatibility
with Bonfyre operators, manifests, and legacy artifact formats.

## Aurekai-first formats

```
.akmodel    model weight pack
.aksae      SAE feature dictionary
.akfpqx     cross-model FPQx alignment manifest
```

## Legacy-compatible formats

```
.bfmodel    (alias: .akmodel)
.bfsae      (alias: .aksae)
.bffpqx     (alias: .akfpqx)
```

## Dual-manifest release rule

Every Aurekai release includes both manifests:

```
aurekai.manifest.json       public distribution metadata
bonfyre.manifest.json       legacy runtime validation metadata
```

This is not a bug. It is the bridge.

Aurekai packages include a Bonfyre compatibility manifest for native runtime validation.

## Recommended release artifact set

```
akai-hyper-v0.8.0-bun-darwin-arm64
aurekai-runtime-v0.8.0-bun-darwin-arm64.tar.gz
aurekai-model-memory-qwen3-8b-20260502.tar.gz
aurekai-appliance-v0.8.0-bun-darwin-arm64.tar.gz
aurekai.manifest.json
bonfyre.manifest.json
SHA256SUMS
SBOM.spdx.json
```

## Install

```bash
bun add -g @aurekai/runtime
akai doctor --deep
akai install --user
akai dashboard
akai run recipe.json --sae-audit --semantic-cache
```

## CLI

```bash
akai doctor --deep
akai dashboard
akai run <recipe> [--input FILE] [--sae-audit] [--semantic-cache]
akai install --user|--system [--service]
akai sae:activate --dict default.aksae --residual residual.bin
akai model:inspect qwen3-8b.akmodel
akai fpqx:align-sae --from qwen3-8b.l24.aksae --to llama3-8b.l26.aksae --out qwen3-to-llama3.akfpqx
akai query:features "feature:6159 > 0.7"
```

Compatibility aliases remain in place during migration:

```bash
bonfyre       -> akai
bonfyre-hyper -> akai
bonfyre-sae   -> akai sae
```

## Registry

| Surface        | Name                        |
|----------------|-----------------------------|
| GitHub         | `aurekai/aurekai`           |
| npm            | `@aurekai/runtime`          |
| PyPI           | `aurekai`                   |
| Docker / GHCR  | `ghcr.io/aurekai/runtime`   |
| Hugging Face   | `aurekai/model-memory`      |
| Homebrew       | `aurekai/tap`               |
| Helm           | `aurekai-runtime`           |
| Kestra Flows   | `aurekai/aurekai-kestra`    |
| VS Code        | Aurekai Workbench           |
| CLI            | `akai`                      |

## Brand architecture

- Aurekai Platform
- Aurekai Runtime
- Aurekai Intake
- Aurekai Intelligence
- Aurekai Memory
- Aurekai Proof
- Aurekai Wire
- Aurekai Commerce
- Aurekai Publish
- Aurekai Edge

## Public naming

- Product: Aurekai
- CLI: `akai`
- Internal codename: Bonfyre
- Main package: `@aurekai/runtime`
- Main container: `ghcr.io/aurekai/runtime`
- Manifest schema: `aurekai.deploy.v1`

## Repo split

The public platform layer lives in this repository:

- https://github.com/aurekai/aurekai

The native runtime lineage is now tracked in:

- https://github.com/aurekai/native-runtime

Kestra orchestration flows and blueprints are tracked in:

- https://github.com/aurekai/aurekai-kestra

Full ecosystem integration matrix is tracked in:

- `registry/integrations.json`
- `ECOSYSTEM_NAMES.md`

Integration operations scripts:

- `scripts/sync-integration-scaffold.sh` to synchronize baseline README/LICENSE/CI scaffold across integration repos
- `scripts/apply-branch-protection.sh` to apply a baseline main-branch protection policy across repos listed in the integration registry

Bonfyre remains the compatibility lineage for ABI, command aliases, and legacy
format support during migration.

