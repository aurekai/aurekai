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

- [ ] **PyPI aurekai**
  - URL: https://pypi.org/account/register/
  - Reserve: `pip install twine && twine upload` with a stub `aurekai` package
  - Stub setup: `pyproject.toml` with `name = "aurekai"` and `version = "0.8.0a1"`


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
  - Create publisher ID `aurekai`
  - Display name: `Aurekai`

- [ ] **Open VSX publisher aurekai**
  - URL: https://open-vsx.org/user-settings/namespaces
  - Namespace: `aurekai`

---

## Priority 3 — Reserve before Homebrew/Helm GA

- [ ] **Homebrew tap aurekai/tap**
  - Create GitHub repo `aurekai/homebrew-tap`
  - Add formula `akai.rb` pointing to `akai-hyper-v0.8.0-alpha.1-*` binary
  - Test: `brew tap aurekai/tap && brew install akai`

- [ ] **Helm repo**
  - Host `https://charts.aurekai.ai` via GitHub Pages from `aurekai/aurekai` `gh-pages` branch
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
