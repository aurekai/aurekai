#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY_FILE="${1:-$ROOT_DIR/registry/integrations.json}"

if [[ ! -f "$REGISTRY_FILE" ]]; then
  echo "registry file not found: $REGISTRY_FILE" >&2
  exit 1
fi

repos=()
while IFS= read -r repo; do
  repos+=("$repo")
done < <(jq -r '.integrations[].repo' "$REGISTRY_FILE" | sed -E 's#https://github.com/##')

applied=0
failed=0

for repo in "${repos[@]}"; do
  echo "applying protection: $repo"
  if gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$repo/branches/main/protection" \
    -f required_status_checks.strict=true \
    -f required_status_checks.contexts[]="validate" \
    -f enforce_admins=true \
    -f required_pull_request_reviews.dismiss_stale_reviews=true \
    -f required_pull_request_reviews.required_approving_review_count=1 \
    -f restrictions= >/dev/null 2>&1; then
    applied=$((applied + 1))
  else
    echo "failed: $repo"
    failed=$((failed + 1))
  fi
done

echo "branch protection applied: $applied"
echo "branch protection failed: $failed"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
