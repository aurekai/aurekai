# Compatibility — Aurekai / Bonfyre

This document covers ABI compatibility, dual-manifest rules, legacy `.bf*` format support, and command alias preservation during the Bonfyre → Aurekai migration.

## Dual-manifest release rule

Every Aurekai release ships two manifests:

| Manifest                | Purpose                                  |
|-------------------------|------------------------------------------|
| `aurekai.manifest.json` | Public distribution metadata             |
| `bonfyre.manifest.json` | Native runtime compatibility validation  |

Tooling that validates against `bonfyre.manifest.json` continues to work unchanged. This is by design — the dual-manifest is the bridge, not a bug.

## Legacy `.bf*` format support

| Legacy format | Aurekai alias |
|---------------|---------------|
| `.bfmodel`    | `.akmodel`    |
| `.bfsae`      | `.aksae`      |
| `.bffpqx`     | `.akfpqx`     |

Aurekai reads `.bfmodel`, `.bfsae`, and `.bffpqx` files transparently. No conversion step is required at read time.

## Command aliases

The following CLI aliases remain live during migration:

| Legacy command   | Aurekai equivalent |
|------------------|--------------------|
| `bonfyre`        | `akai`             |
| `bonfyre-hyper`  | `akai`             |
| `bonfyre-sae`    | `akai sae`         |

Aliases will be preserved for at least one full minor release cycle after `1.0.0`.

## ABI compatibility

The native runtime ABI is versioned independently of the public `akai` CLI. Bonfyre operators compiled against the native runtime continue to run without recompilation as long as the `bonfyre.manifest.json` compatibility manifest is present in the release.

The native runtime is tracked at: [https://github.com/aurekai/native-runtime](https://github.com/aurekai/native-runtime)

## Deprecation timeline

No `.bf*` formats or command aliases are currently deprecated. Removal will be announced with at minimum one minor release notice in `CHANGELOG.md`.
