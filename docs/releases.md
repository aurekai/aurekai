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

Aurekai follows semver. Current pre-release track: `0.8.0-alpha.x`

Integration scaffold repos pin against:
```
AUREKAI_VERSION=0.8.0-alpha.4
AKAI_PACKAGE_VERSION=0.8.0-alpha.4
AUREKAI_MANIFEST_SCHEMA=aurekai.deploy.v1
HELM_CHART_VERSION=0.8.1
```

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
