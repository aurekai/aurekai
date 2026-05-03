# Branding — Aurekai

## Names

| Term              | Value                          |
|-------------------|--------------------------------|
| Product           | Aurekai                        |
| CLI               | `akai`                         |
| Internal codename | Bonfyre                        |
| Main npm package  | `@aurekai/runtime`             |
| Main container    | `ghcr.io/aurekai/runtime`      |
| Manifest schema   | `aurekai.deploy.v1`            |
| Helm chart        | `aurekai-runtime`              |
| VS Code extension | Aurekai Workbench              |
| HuggingFace org   | `aurekai`                      |

## Brand architecture

| Layer               | Name                  |
|---------------------|-----------------------|
| Platform            | Aurekai Platform      |
| Runtime             | Aurekai Runtime       |
| Intake              | Aurekai Intake        |
| Intelligence        | Aurekai Intelligence  |
| Memory              | Aurekai Memory        |
| Proof               | Aurekai Proof         |
| Wire                | Aurekai Wire          |
| Commerce            | Aurekai Commerce      |
| Publish             | Aurekai Publish       |
| Edge                | Aurekai Edge          |

## Tagline

> Aurekai is the operating fabric for intelligent work — runtime, model memory, proof, semantic cache, and provider-neutral integrations for modern AI systems.

## Codename policy

The Bonfyre codename is preserved in:
- CLI compatibility aliases (`bonfyre` → `akai`)
- Legacy artifact formats (`.bfmodel`, `.bfsae`, `.bffpqx`)
- The `bonfyre.manifest.json` compatibility manifest shipped in every release

The Bonfyre name does **not** appear in:
- Public package names
- User-facing documentation titles
- Marketing copy

See [`COMPATIBILITY.md`](./COMPATIBILITY.md) for the full compatibility surface.
