# Aurekai LiveOps Track

Experimental track for real-time MoQ pipeline event streaming and live operator monitoring.

## Overview

AkaiMoQ (Media-over-QUIC) delivers real-time pipeline events via a low-latency QUIC transport. LiveOps provides the operational layer for monitoring, alerting, and SLA enforcement.

## Components

### 1. AkaiMoQ Event Stream

```bash
# Start live event stream
akai moq events --namespace default --follow --json | jq -c '
  . | {ts: .timestamp, type: .type, artifact_id, proof_uri, latency_ms}
'
```

Events emitted on every pipeline stage transition.

### 2. SLA Monitor

```bash
#!/usr/bin/env bash
# scripts/liveops-sla-monitor.sh
set -euo pipefail
SLA_THRESHOLD_MS="${1:-5000}"

akai moq events --namespace default --follow --json | while IFS= read -r line; do
  LATENCY=$(echo "$line" | jq -r '.latency_ms // 0')
  TYPE=$(echo "$line" | jq -r '.type // "unknown"')
  if [ "$LATENCY" -gt "$SLA_THRESHOLD_MS" ]; then
    echo "SLA BREACH: $TYPE latency=${LATENCY}ms (threshold=${SLA_THRESHOLD_MS}ms)"
    akai meter record --event "sla_breach" --units 1 --json
  fi
done
```

### 3. Pipeline Health Dashboard

```bash
# Snapshot current pipeline state
akai moq status --json | jq '{
  active_pipelines: .active | length,
  pending_events: .queue_depth,
  avg_latency_ms: .avg_latency_ms,
  proof_rate: .proof_completeness_pct
}'
```

### 4. Alert Integration

```bash
# Emit alert on proof gap
akai moq events --namespace default --since 60s --json | \
  jq '[.events[] | select(.proof_uri == "" or .proof_uri == null)] | length' | \
  xargs -I{} bash -c '[ {} -eq 0 ] || echo "ALERT: {} events missing proof in last 60s"'
```

### 5. CI / Nightly Health Check

```yaml
# .github/workflows/aurekai-liveops-health.yml
on:
  schedule:
    - cron: "*/15 * * * *"

jobs:
  liveops-health:
    steps:
      - run: |
          akai moq status --json | tee moq-status.json
          akai doctor --json
          akai proof bundle --json | jq '{proof_uri}'
```

## Metrics

| Metric | Target |
|---|---|
| Event delivery latency | < 200ms p99 |
| Proof completeness | 100% of pipeline events |
| SLA breach rate | 0 per day |
| Queue depth | < 100 pending events |
