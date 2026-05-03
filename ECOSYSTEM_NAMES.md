# Ecosystem Name Reservation Checklist

Reserve these names immediately before pushing the public repo.
Priority order listed below.

---

## Priority 1 — Must reserve before first public push

- [x] **github.com/aurekai** (org) ✅ COMPLETE
  - URL: https://github.com/aurekai
  - Org created with `aurekai/aurekai` repo
  - Main branch + v0.8.0-alpha.1 tag live at https://github.com/aurekai/aurekai

- [x] **npm @aurekai scope** ✅ COMPLETE
  - URL: https://www.npmjs.com/org/aurekai
  - Org `aurekai` created, `@aurekai/runtime@0.8.0-alpha.1` published
  - Alpha tag live: `npm install @aurekai/runtime@0.8.0-alpha.1`

- [~] **PyPI aurekai**
  - URL: https://pypi.org/project/aurekai/
  - Thin real package added in `python/` with `python -m aurekai --version|doctor|manifest`
  - Builds + `twine check` pass locally
  - Trusted publishing workflow added in `.github/workflows/pypi-publish.yml`


Docker/GHCR publishing deferred until after alpha.1 to reduce early cost and maintenance.
Primary alpha distribution is GitHub Releases + npm + direct akai CLI.

---

## Priority 2 — Reserve before first public announcement

- [x] **HuggingFace aurekai org** ✅ COMPLETE
  - URL: https://huggingface.co/aurekai
  - Org created with 4 model repos + READMEs:
    - [aurekai/model-memory](https://huggingface.co/aurekai/model-memory) — with qwen3-8b tarballs + manifests
    - [aurekai/sae-dictionaries](https://huggingface.co/aurekai/sae-dictionaries) — SAE format reference docs
    - [aurekai/fpqx-alignments](https://huggingface.co/aurekai/fpqx-alignments) — FPQx alignment reference docs
    - [aurekai/semantic-cache-bench](https://huggingface.co/aurekai/semantic-cache-bench) — Benchmark reference docs

- [ ] **aurekai.ai** domain
  - Registrar: Namecheap / Cloudflare / Google Domains
  - Also reserve: `aurekai.dev`, `akai.sh`, `aurekai.com`

- [ ] **VS Code publisher aurekai**
  - URL: https://marketplace.visualstudio.com/manage
  - Publisher ID still needs to be created in Marketplace UI
  - Extension scaffold updated in `extensions/vscode/` and VSIX packaging is validated locally

- [ ] **Open VSX publisher aurekai**
  - URL: https://open-vsx.org/user-settings/namespaces
  - Namespace still needs to be created in Open VSX UI
  - Extension scaffold is aligned for `ovsx publish`

---

## Priority 3 — Reserve before Homebrew/Helm GA

- [x] **Homebrew tap aurekai/homebrew-tap** ✅ COMPLETE
  - GitHub repo live: `https://github.com/aurekai/homebrew-tap`
  - Formula `aurekai.rb` installs from published npm tarball `@aurekai/runtime@0.8.0-alpha.1`
  - Dry-run validated: `brew tap aurekai/homebrew-tap && brew install aurekai`

- [~] **Helm repo / Artifact Hub**
  - Artifact Hub metadata added in `helm/aurekai-runtime/`
  - Chart remains preview-only until container distribution is public

- [x] **JSR @aurekai/sdk** ✅ DRY-RUN VALIDATED
  - Package scaffold added in `jsr/`
  - `deno publish --dry-run --allow-dirty` passes locally

- [x] **GitHub Actions Marketplace surfaces** ✅ COMPLETE
  - `https://github.com/aurekai/setup-aurekai`
  - `https://github.com/aurekai/aurekai-doctor`
  - Both tagged at `v0.8.0-alpha.1`

- [x] **MCP repo surface** ✅ INITIAL
  - `https://github.com/aurekai/aurekai-mcp`
  - `@aurekai/mcp` scaffold published to repo with first tag `v0.8.0-alpha.1`
  - Run `helm package helm/aurekai-runtime && helm repo index .`

---

## Name → handle mapping

| Surface        | Name / Handle                        | Status |
|----------------|--------------------------------------|--------|
| GitHub org     | `aurekai`                            | [ ] |
| GitHub repo    | `aurekai/aurekai`                    | [ ] |
| npm scope      | `@aurekai`                           | [ ] |
| npm package    | `@aurekai/runtime`                   | [ ] |
| PyPI           | `aurekai`                            | [ ] |
| HuggingFace    | `aurekai`                            | [ ] |
| Domain         | `aurekai.ai`                         | [ ] |
| Domain         | `aurekai.dev`                        | [ ] |
| Domain         | `akai.sh`                            | [ ] |
| VS Code        | publisher `aurekai`                  | [ ] |
| Open VSX       | namespace `aurekai`                  | [ ] |
| Homebrew tap   | `aurekai/tap`                        | [ ] |
| Helm chart     | `aurekai-runtime`                    | [ ] |
| CLI handle     | `akai` (via npm bin)                 | [ ] |
