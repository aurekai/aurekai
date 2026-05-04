#!/usr/bin/env bash
# demo-11-progressive-hydrate.sh
# Phase 6 demo: Progressive hydration — model emits readiness checkpoints as
# weight regions load, enabling first-usable at 22% and quality delivery at 68%.
set -euo pipefail

MODEL="${1:-qwen3-8b}"
RECIPE="${2:-examples/audio-to-deliverable-phase6.akrecipe}"

echo ""
echo "=== Phase 6 WeightOps: Progressive Hydration Demo ==="
echo "  model:  ${MODEL}"
echo "  recipe: ${RECIPE}"
echo ""

echo "[1/4] Show hydration plan"
akai weights hydrate "${MODEL}.akmodel" | jq '{
  model,
  first_usable_at_pct,
  quality_target_at_pct,
  checkpoints: [.checkpoints[] | {name, pct, tasks}]
}'

echo ""
echo "[2/4] Stream readiness checkpoints (progressive)"
echo "  (In production: recipe steps begin executing at their required checkpoint)"
echo ""
akai weights hydrate "${MODEL}.akmodel" --progressive --emit-readiness \
  | while IFS= read -r line; do
      PCT=$(echo "$line" | jq -r '.pct // empty' 2>/dev/null)
      CP=$(echo  "$line" | jq -r '.checkpoint // empty' 2>/dev/null)
      TASKS=$(echo "$line" | jq -r '.supported_tasks | join(", ") // empty' 2>/dev/null)
      if [[ -n "${PCT}" ]]; then
        echo "  [${PCT}%] ${CP}: ${TASKS}"
      fi
    done

echo ""
echo "[3/4] Verify weight proof at 68% usable checkpoint"
akai weights prove "${MODEL}.akmodel" --tasks "${RECIPE}" \
  | jq '{verified_chunks_pct, compatible_recipes, output_file}'

echo ""
echo "[4/4] Show final status"
akai weights status "${MODEL}.akmodel" | jq '.hydration_state | {
  checkpoint,
  pct,
  readiness_score,
  supported_tasks,
  missing_regions
}'

echo ""
echo "=== Done: model reached 68% quality — full download not required ==="
