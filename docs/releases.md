# Releases — Aurekai

See the [GitHub Releases page](https://github.com/aurekai/aurekai/releases) for all published artifacts.

## Release artifact set

Each release ships:

| Artifact                                           | Description                              |
|----------------------------------------------------|------------------------------------------|
| `akai-hyper-{version}-{platform}`                  | Standalone CLI binary (bun-compiled)     |
| `aurekai-runtime-{version}-{platform}.tar.gz`      | Runtime bundle                           |
| `aurekai-model-memory-{model}-{date}.tar.gz`       | Model memory pack (optional, per model)  |
| `aurekai-appliance-{version}-{platform}.tar.gz`    | Full appliance bundle                    |
| `aurekai.manifest.json`                            | Public distribution metadata             |
| `bonfyre.manifest.json`                            | Native runtime compatibility manifest    |
| `SHA256SUMS`                                       | Checksums                                |
| `SBOM.spdx.json`                                   | Software Bill of Materials               |

## Versioning

Aurekai follows semver. Current stable release: `0.8.0`

Integration scaffold repos pin against:
```
AUREKAI_VERSION=0.8.0
AKAI_PACKAGE_VERSION=0.8.0
AUREKAI_MANIFEST_SCHEMA=aurekai.deploy.v1
HELM_CHART_VERSION=0.8.1
```

## v0.8.0 — WeightOps 20x (2026-05-04)

**25 WeightOps commands** across 5 groups, all emitting `aurekai.weightops.result.v1`:

| Group | Commands |
|-------|----------|
| A — Supply Chain | `sbom`, `tamper-detect`, `proof-chain`, `audit-trail`, `integrity-gate` |
| B — Adapters | `adapter-list`, `adapter-hot-swap`, `merge`, `split`, `freeze` |
| C — SAE & KV | `sae-probe`, `sae-steer`, `feature-drift`, `kv-compress`, `kv-restore` |
| D — Real-Time Ops | `sla-monitor`, `budget-alert`, `cost-forecast`, `hot-patch`, `credit-settle` |
| E — P2P Mesh | `p2p-seed`, `relay-handoff`, `geo-pin`, `mirror-sync`, `escrow` |

Published: [`@aurekai/runtime@0.8.0`](https://www.npmjs.com/package/@aurekai/runtime) · [`@aurekai/sdk@0.8.0`](https://jsr.io/@aurekai/sdk@0.8.0) · tag [`v0.8.0`](https://github.com/aurekai/aurekai/releases/tag/v0.8.0)

## Platforms

| Target              | Identifier              |
|---------------------|-------------------------|
| macOS arm64         | `bun-darwin-arm64`      |
| macOS x64           | `bun-darwin-x64`        |
| Linux x64           | `bun-linux-x64`         |
| Linux arm64         | `bun-linux-arm64`       |

## Channels

| Channel   | Tag       | Description                            |
|-----------|-----------|----------------------------------------|
| alpha     | `alpha`   | Active development, breaking changes   |
| latest    | `latest`  | Stable (not yet active)                |
