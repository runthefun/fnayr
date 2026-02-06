#!/usr/bin/env bash
set -euo pipefail

PRD="PRD.json"
PROGRESS="progress.md"
STEP=0

# default max steps to the number of remaining tasks
if [ -n "${1:-}" ]; then
  MAX_STEPS="$1"
else
  MAX_STEPS=$(jq '[.tasks[] | select(.done == false)] | length' "$PRD")
fi

# init progress file if missing
if [ ! -f "$PROGRESS" ]; then
  echo "# ECS Refactor Progress" > "$PROGRESS"
  echo "" >> "$PROGRESS"
fi

while [ "$STEP" -lt "$MAX_STEPS" ]; do
  STEP=$((STEP + 1))

  # check if all tasks are done
  REMAINING=$(jq '[.tasks[] | select(.done == false)] | length' "$PRD")
  if [ "$REMAINING" -eq 0 ]; then
    echo "=== All tasks done! ==="
    break
  fi

  echo "=== Step $STEP / $MAX_STEPS  ($REMAINING tasks remaining) ==="

  PROMPT="$(cat <<'PROMPT_EOF'
You are executing an ECS refactor plan defined in PRD.json. Read PRD.json and progress.md now.

Your job:
1. Read PRD.json (full file) and progress.md
2. From the tasks where "done": false, pick the ONE task that is most suitable to work on next (consider dependencies, risk, and logical ordering)
3. Execute it fully: read relevant source files, implement changes, write/update tests
4. Validate: run `pnpm typecheck` and `pnpm test:run` — both must pass
5. If validation fails, fix and retry until it passes
6. Once confident, commit the changes with a concise message (e.g., "ecs: fix destroyEntity listener ordering")
7. Update PRD.json: set "done": true for the completed task
8. Append a concise summary line to progress.md in this format:
   ## Step N — Task T: <title>
   <one-line summary of what was done>

   Replace N with the current step number and T with the task id.

Current step number: STEP_NUMBER

IMPORTANT:
- Do ONE task only, then stop
- Do not skip validation
- Do not modify tasks you are not working on
- Commit before marking done
PROMPT_EOF
)"

  # inject step number
  PROMPT="${PROMPT//STEP_NUMBER/$STEP}"

  claude --dangerously-skip-permissions -p "$PROMPT"

  # verify the task was actually marked done
  NEW_REMAINING=$(jq '[.tasks[] | select(.done == false)] | length' "$PRD")
  if [ "$NEW_REMAINING" -ge "$REMAINING" ]; then
    echo "WARNING: No task was marked done in this step. Stopping to avoid infinite loop."
    break
  fi

  echo "=== Step $STEP complete ==="
  echo ""
done

echo "=== Finished after $STEP steps ==="
