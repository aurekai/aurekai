# Repo Map — Aurekai

## Core

| Repo | Description |
|------|-------------|
| [`aurekai/aurekai`](https://github.com/aurekai/aurekai) | Public platform layer — CLI, registry, schemas, integration scripts |
| [`aurekai/native-runtime`](https://github.com/aurekai/native-runtime) | Native runtime lineage (Bonfyre codename) |

## Integration repos

All integration repos follow the scaffold pattern: `scripts/`, `tests/`, `docs/`, `.release-versions.env`, `.github/workflows/validate.yml`.

### Workflow and orchestration

| Repo | Type |
|------|------|
| [`aurekai-kestra`](https://github.com/aurekai/aurekai-kestra) | workflow |
| [`aurekai-airflow`](https://github.com/aurekai/aurekai-airflow) | workflow |
| [`aurekai-prefect`](https://github.com/aurekai/aurekai-prefect) | workflow |
| [`aurekai-dagster`](https://github.com/aurekai/aurekai-dagster) | workflow |
| [`aurekai-temporal`](https://github.com/aurekai/aurekai-temporal) | workflow |
| [`aurekai-n8n`](https://github.com/aurekai/aurekai-n8n) | workflow |
| [`aurekai-node-red`](https://github.com/aurekai/aurekai-node-red) | workflow |
| [`aurekai-github-actions`](https://github.com/aurekai/aurekai-github-actions) | workflow |
| [`aurekai-gitlab-ci`](https://github.com/aurekai/aurekai-gitlab-ci) | workflow |
| [`aurekai-argo-workflows`](https://github.com/aurekai/aurekai-argo-workflows) | workflow |
| [`aurekai-tekton`](https://github.com/aurekai/aurekai-tekton) | workflow |

### Agent frameworks

| Repo | Type |
|------|------|
| [`aurekai-langchain`](https://github.com/aurekai/aurekai-langchain) | agent |
| [`aurekai-llamaindex`](https://github.com/aurekai/aurekai-llamaindex) | agent |
| [`aurekai-haystack`](https://github.com/aurekai/aurekai-haystack) | agent |
| [`aurekai-semantic-kernel`](https://github.com/aurekai/aurekai-semantic-kernel) | agent |
| [`aurekai-autogen`](https://github.com/aurekai/aurekai-autogen) | agent |
| [`aurekai-crewai`](https://github.com/aurekai/aurekai-crewai) | agent |

### Data and ML

| Repo | Type |
|------|------|
| [`aurekai-mlflow`](https://github.com/aurekai/aurekai-mlflow) | data-ml |
| [`aurekai-wandb`](https://github.com/aurekai/aurekai-wandb) | data-ml |
| [`aurekai-dvc`](https://github.com/aurekai/aurekai-dvc) | data-ml |
| [`aurekai-duckdb`](https://github.com/aurekai/aurekai-duckdb) | data-ml |
| [`aurekai-sqlite`](https://github.com/aurekai/aurekai-sqlite) | data-ml |
| [`aurekai-postgres`](https://github.com/aurekai/aurekai-postgres) | data-ml |

### Infrastructure

| Repo | Type |
|------|------|
| [`aurekai-terraform`](https://github.com/aurekai/aurekai-terraform) | infra |
| [`aurekai-pulumi`](https://github.com/aurekai/aurekai-pulumi) | infra |
| [`aurekai-helm`](https://github.com/aurekai/aurekai-helm) | infra |
| [`aurekai-kubernetes`](https://github.com/aurekai/aurekai-kubernetes) | infra |
| [`aurekai-nix`](https://github.com/aurekai/aurekai-nix) | infra |

### IDE and developer environments

| Repo | Type |
|------|------|
| [`aurekai-vscode`](https://github.com/aurekai/aurekai-vscode) | ide |
| [`aurekai-openvsx`](https://github.com/aurekai/aurekai-openvsx) | ide |
| [`aurekai-devcontainer`](https://github.com/aurekai/aurekai-devcontainer) | ide |
| [`aurekai-codespaces`](https://github.com/aurekai/aurekai-codespaces) | ide |
| [`aurekai-gitpod`](https://github.com/aurekai/aurekai-gitpod) | ide |

## Support tooling

| Script | Purpose |
|--------|---------|
| `scripts/sync-integration-scaffold.sh` | Synchronize baseline README/LICENSE/CI scaffold across integration repos |
| `scripts/apply-branch-protection.sh` | Apply baseline main-branch protection policy across repos in the integration registry |

## Registry files

| File | Purpose |
|------|---------|
| `registry/integrations.json` | Full integration matrix with statuses |
| `registry/product-map.json` | Product layer map |
| `registry/public-surfaces.json` | Public package surface registry |
| `ECOSYSTEM_NAMES.md` | Human-readable ecosystem name reference |
