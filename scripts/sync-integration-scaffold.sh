#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY_FILE="${1:-$ROOT_DIR/registry/integrations.json}"
TARGET_ROOT="${2:-/tmp/aurekai-integration-sync}"

if [[ ! -f "$REGISTRY_FILE" ]]; then
  echo "registry file not found: $REGISTRY_FILE" >&2
  exit 1
fi

mkdir -p "$TARGET_ROOT"

python3 << 'PY'
import json
import os
import subprocess
from pathlib import Path

root = Path(os.environ['ROOT_DIR'])
registry = Path(os.environ['REGISTRY_FILE'])
target_root = Path(os.environ['TARGET_ROOT'])

core_templates = [
    'doctor-deep',
    'manifest-verify',
    'model-memory-pack',
    'sae-audit',
    'semantic-cache-bench',
    'proof-bundle-export',
    'release-gate',
]

integrations = json.loads(registry.read_text())['integrations']

for it in integrations:
    repo_url = it['repo']
    repo = repo_url.replace('https://github.com/', '')
    name = repo.split('/')[-1]
    path = target_root / name

    if path.exists():
        subprocess.run(['rm', '-rf', str(path)], check=True)

    clone = subprocess.run(['gh', 'repo', 'clone', repo, str(path)], capture_output=True, text=True)
    if clone.returncode != 0:
        print(f'clone failed: {repo}')
        continue

    readme = path / 'README.md'
    if not readme.exists():
        readme.write_text(f"# {name}\n\nAurekai integration surface.\n")

    if '## Core Template Set' not in readme.read_text():
        with readme.open('a') as f:
            f.write('\n## Core Template Set\n\n')
            for t in core_templates:
                f.write(f'- {t}\n')

    license_file = path / 'LICENSE'
    if not license_file.exists():
        license_file.write_text('Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n')

    workflows = path / '.github' / 'workflows'
    workflows.mkdir(parents=True, exist_ok=True)
    validate = workflows / 'validate.yml'
    if not validate.exists():
        validate.write_text('''name: validate
on:
  pull_request:
  push:
    branches: [ main ]
jobs:
  readme:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Ensure scaffold files exist
        run: |
          test -f README.md
          test -f LICENSE
''')

    subprocess.run(['git', '-C', str(path), 'add', '-A'], check=False)
    status = subprocess.run(['git', '-C', str(path), 'status', '--porcelain'], capture_output=True, text=True)
    if not status.stdout.strip():
        print(f'no changes: {repo}')
        continue

    subprocess.run(['git', '-C', str(path), 'commit', '-m', 'chore: sync integration scaffold'], check=True)
    subprocess.run(['git', '-C', str(path), 'push', 'origin', 'main'], check=True)
    print(f'synced: {repo}')
PY
