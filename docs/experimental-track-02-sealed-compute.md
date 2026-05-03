# Aurekai Sealed Compute Track

Experimental track for sealed netlist execution, tamper-proof compute envelopes, and eval-sealed validation.

## Overview

Sealed Compute ensures that model evaluation happens inside a cryptographically sealed envelope — the netlist is locked before eval and the proof record cannot be forged after the fact.

## Components

### 1. AkaiNet Seal

```bash
# Seal a netlist before evaluation
akai net seal --netlist netlist.json --json | jq '{seal_id, artifact_id}'
```

A seal binds the netlist hash, operator version, and timestamp into a tamper-evident record.

### 2. eval-sealed

```bash
# Evaluate inside the sealed envelope
akai net eval-sealed --id $SEAL_ID --json | jq '{result, verified}'
```

Fails if the netlist was modified after sealing.

### 3. Proof Chain

```bash
akai proof bundle --json | jq '{proof_uri}'
akai canon hash --artifact $EVAL_ARTIFACT --json | jq '{hash}'
```

### 4. CI Integration

```yaml
# .github/workflows/aurekai-sealed-compute.yml
jobs:
  sealed-eval:
    steps:
      - run: |
          SEAL=$(akai net seal --netlist netlist.json --json)
          SEAL_ID=$(echo "$SEAL" | jq -r '.seal_id')
          akai net eval-sealed --id "$SEAL_ID" --json
          akai proof bundle --json
```

## Security Properties

| Property | Mechanism |
|---|---|
| Tamper-evidence | Canon hash locked at seal time |
| Replay prevention | Monotonic seal sequence |
| Proof completeness | Proof bundle emitted post-eval |
| Auditability | Lineage graph includes seal record |
