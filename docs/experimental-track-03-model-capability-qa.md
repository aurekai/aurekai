# Aurekai Model Capability QA Track

Experimental track for post-FPQ model capability validation using AkaiFlashQLA.

## Overview

After every FPQ compression, run AkaiFlashQLA (Quantized Latent Analysis) to verify that model capabilities are preserved within acceptable degradation bounds.

## Components

### 1. AkaiFlashQLA Post-FPQ

```bash
# Run capability QA after FPQ compression
MODEL_TAG="latest"
BITS=8

FPQ=$(akai fpq compress --model "$MODEL_TAG" --bits "$BITS" --json)
COMPRESSED_ID=$(echo "$FPQ" | jq -r '.artifact_id')

# Run FlashQLA analysis
QLA=$(akai flashqla run --artifact "$COMPRESSED_ID" --json)
echo "$QLA" | jq '{capability_score, degradation_pct, pass}'
```

Fails if `degradation_pct > 5.0` or `capability_score < 0.92`.

### 2. Capability Benchmark Suite

```bash
# Run full capability benchmark
akai benchmark run --suite capability --artifact "$COMPRESSED_ID" --json | jq '{
  families: .families,
  overall_pass: .pass,
  degraded: [.families[] | select(.degradation_pct > 2.0)]
}'
```

### 3. CI Integration

```yaml
# .github/workflows/aurekai-model-capability-qa.yml
on:
  workflow_dispatch:
    inputs:
      model_tag:
        required: true
      bits:
        default: "8"

jobs:
  capability-qa:
    steps:
      - run: |
          FPQ=$(akai fpq compress --model "${{ inputs.model_tag }}" --bits "${{ inputs.bits }}" --json)
          COMPRESSED_ID=$(echo "$FPQ" | jq -r '.artifact_id')
          akai flashqla run --artifact "$COMPRESSED_ID" --json | tee qla-results.json
          PASS=$(jq -r '.pass' qla-results.json)
          [ "$PASS" = "true" ] || (echo "FAIL: capability QA failed" && exit 1)
          akai proof bundle --json
      - uses: actions/upload-artifact@v4
        with:
          name: qla-results
          path: qla-results.json
```

## Thresholds

| Metric | Threshold |
|---|---|
| `capability_score` | ≥ 0.92 |
| `degradation_pct` | ≤ 5.0% |
| Family pass rate | 100% of 9 families |
| Proof completeness | Required |
