# Migration — Bonfyre → Aurekai

This document is for operators, pipeline authors, and integration maintainers moving from the Bonfyre codename surface to Aurekai public APIs.

## Summary

| What changed         | Before (Bonfyre)             | After (Aurekai)              |
|----------------------|------------------------------|------------------------------|
| CLI binary           | `bonfyre`, `bonfyre-hyper`   | `akai`                       |
| Package              | (internal)                   | `@aurekai/runtime` (npm)     |
| Model format         | `.bfmodel`                   | `.akmodel` (`.bfmodel` still read) |
| SAE format           | `.bfsae`                     | `.aksae` (`.bfsae` still read) |
| FPQx format          | `.bffpqx`                    | `.akfpqx` (`.bffpqx` still read) |
| Manifest             | `bonfyre.manifest.json` only | Both manifests shipped       |
| Manifest schema      | (internal)                   | `aurekai.deploy.v1`          |

## Step-by-step migration

### 1. Replace the CLI

```bash
# Remove old binary (if installed manually)
rm -f /usr/local/bin/bonfyre

# Install Aurekai
bun add -g @aurekai/runtime
akai doctor --deep
```

### 2. Update scripts

Replace `bonfyre` → `akai` and `bonfyre-hyper` → `akai` in all shell scripts, Makefiles, and CI pipelines.

```bash
# Quick replacement in a repo
grep -rl 'bonfyre' . | xargs sed -i 's/\bbonfyre\b/akai/g'
```

Review changes — some references to the codename in comments or docs may be intentional.

### 3. Update manifest references

If you validate against `bonfyre.manifest.json`, no action is required — it ships in every Aurekai release. If you want to adopt the new schema:

```json
{
  "$schema": "aurekai.deploy.v1"
}
```

### 4. File format — no conversion needed

Aurekai reads `.bfmodel`, `.bfsae`, and `.bffpqx` files transparently. Rename at your own pace; both extensions remain valid.

### 5. Update integration repo CI

Integration repos generated with the seed scaffold use `validate.yml` which tests against `akai`. If you have legacy CI using `bonfyre` commands, update the `bash_command` strings to use `akai`.

## Rollback

The dual-manifest guarantee means you can roll back to any Bonfyre-compatible operator by pointing at a release that includes `bonfyre.manifest.json`. No data migration is required.

## Further reading

- [`COMPATIBILITY.md`](./COMPATIBILITY.md) — formats, aliases, ABI details
- [`CHANGELOG.md`](./CHANGELOG.md) — version history
- [`registry/integrations.json`](./registry/integrations.json) — full integration registry
