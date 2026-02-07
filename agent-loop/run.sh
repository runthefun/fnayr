#!/usr/bin/env bash
set -euo pipefail

# ─── Agent Loop ───────────────────────────────────────────────────────
# Proposer/Reviewer loop between Claude Code CLI and OpenAI Codex CLI.
#
# Each round:
#   1. Reviewer (Codex) reviews the plan → approves or emits reservations
#   2. If not approved, Proposer (Claude) incorporates reservations into
#      the plan and outputs a summary of changes
#   3. Repeat until approved or max iterations reached
#
# Usage:
#   ./run.sh [--max-iter N] <plan-file>
# ──────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONVO_FILE="$SCRIPT_DIR/conversation.md"

# ─── Config ───────────────────────────────────────────────────────────
PLAN_OPEN='<<<PLAN>>>'
PLAN_CLOSE='<<<END_PLAN>>>'
APPROVE_MARKER='<<<APPROVED>>>'

# ─── Helpers ──────────────────────────────────────────────────────────

usage() {
  echo "Usage: $0 [options] <plan-file>"
  echo ""
  echo "  plan-file              Path to a markdown file with the implementation plan"
  echo ""
  echo "Options:"
  echo "  --max-iter <n>         Maximum number of review rounds (default: 3)"
  echo "  -h, --help             Show this help"
  exit 1
}

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

extract_plan() {
  local input="$1"
  echo "$input" | sed -n "/${PLAN_OPEN}/,/${PLAN_CLOSE}/p" | sed "1d;\$d"
}

extract_remarks() {
  local input="$1"
  echo "$input" | sed "/${PLAN_OPEN}/,/${PLAN_CLOSE}/d"
}

run_claude() {
  local prompt="$1"
  claude -p \
    --model sonnet \
    --allowedTools "" \
    --no-session-persistence \
    "$prompt" \
    2>/dev/null
}

run_codex() {
  local prompt="$1"
  codex exec \
    --skip-git-repo-check \
    "$prompt" \
    2>/dev/null
}

# ─── Reviewer prompt (Codex) ─────────────────────────────────────────

build_reviewer_prompt() {
  local round="$1"
  local plan

  plan="$(cat "$PLAN_FILE")"

  cat <<PROMPT
## Context

We are two AI agents collaborating to refine an implementation plan.
There are two roles:
- **Proposer (Claude)**: Owns and edits the plan. Incorporates feedback by updating the plan.
- **Reviewer (Codex)**: Reviews the plan. Either approves it or emits reservations. Does NOT edit the plan.

You are the **Reviewer (Codex)**.

Your role is to critically review the current plan and either approve it or raise reservations.
You do NOT modify the plan. You do NOT suggest rewrites. You only assess and give feedback.

## Current Plan

$plan

## Instructions (round $round)

Review the plan above.

Then choose exactly ONE of:

**A) Approve** — The plan is solid, complete, and ready for implementation.
Output the marker below on its own line:
$APPROVE_MARKER
You may add a short note explaining why the plan looks good.

**B) Raise reservations** — You have concerns that must be addressed before the plan is ready.
List each reservation clearly and concisely. Be specific: say what is wrong and why.
Do NOT rewrite the plan or propose exact wording. Just describe the issues.

Remember: you are the Reviewer. You only review. You never output plan markers ($PLAN_OPEN / $PLAN_CLOSE).
PROMPT
}

# ─── Proposer prompt (Claude) ────────────────────────────────────────

build_proposer_prompt() {
  local round="$1"
  local remarks="$2"
  local plan

  plan="$(cat "$PLAN_FILE")"

  cat <<PROMPT
## Context

We are two AI agents collaborating to refine an implementation plan.
There are two roles:
- **Proposer (Claude)**: Owns and edits the plan. Incorporates feedback by updating the plan.
- **Reviewer (Codex)**: Reviews the plan. Either approves it or emits reservations. Does NOT edit the plan.

You are the **Proposer (Claude)**.

Your role is to maintain the plan. When the Reviewer raises reservations, you read them,
update the plan to address the concerns, and output a summary of what you changed.

## Current Plan

$plan

## Reviewer's Reservations (round $round)

$remarks

## Instructions

1. Read the Reviewer's reservations above carefully.
2. Update the plan to address each concern.
3. Output the FULL updated plan between these markers:
   $PLAN_OPEN
   (entire updated plan here)
   $PLAN_CLOSE
   The content between the markers will REPLACE the plan file entirely.
   Keep all parts of the plan that are not affected by the reservations.
4. Outside the markers, write a concise summary of what you changed and why.

Remember: you are the Proposer. You always output the plan between the markers.
You never approve or reject — that is the Reviewer's job.
PROMPT
}

# ─── Parse args ──────────────────────────────────────────────────────

MAX_ROUNDS=3
PLAN_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-iter)
      MAX_ROUNDS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    -*)
      echo "Unknown option: $1"
      usage
      ;;
    *)
      PLAN_FILE="$1"
      shift
      ;;
  esac
done

if [[ -z "$PLAN_FILE" ]]; then
  usage
fi

PLAN_FILE="$(cd "$(dirname "$PLAN_FILE")" && pwd)/$(basename "$PLAN_FILE")"
if [[ ! -f "$PLAN_FILE" ]]; then
  echo "Error: plan file not found: $PLAN_FILE"
  exit 1
fi

# ─── Initialize conversation ─────────────────────────────────────────

echo "🔄 Starting agent loop: up to $MAX_ROUNDS rounds"
echo "   Plan:         $PLAN_FILE"
echo "   Conversation: $CONVO_FILE"
echo "   Proposer:     Claude"
echo "   Reviewer:     Codex"
echo ""

cat > "$CONVO_FILE" <<EOF
# Agent Conversation

**Plan file**: $(basename "$PLAN_FILE")
**Started**: $(timestamp)
**Max rounds**: $MAX_ROUNDS
**Proposer**: Claude | **Reviewer**: Codex

---

EOF

# ─── Main loop ────────────────────────────────────────────────────────

APPROVED=false
FINAL_ROUND=0

for ((round = 1; round <= MAX_ROUNDS; round++)); do
  echo "━━━ Round $round/$MAX_ROUNDS ━━━"
  FINAL_ROUND="$round"

  # ── Step 1: Reviewer reviews the plan ──
  echo "  ⏳ Reviewer (Codex) is reviewing..."
  REVIEWER_REPLY="$(run_codex "$(build_reviewer_prompt "$round")")"

  # Check for approval
  if echo "$REVIEWER_REPLY" | grep -qF "$APPROVE_MARKER"; then
    APPROVED=true
    REVIEWER_REMARKS="$(echo "$REVIEWER_REPLY" | sed "s/${APPROVE_MARKER}//g")"

    {
      echo "### Round $round — Reviewer (Codex)"
      echo ""
      echo "$REVIEWER_REMARKS"
      echo ""
      echo "> ✅ **Reviewer approved the plan.**"
      echo ""
      echo "---"
      echo ""
    } >> "$CONVO_FILE"

    echo "  ✅ Reviewer APPROVED the plan"
    echo ""
    echo "🎉 Plan approved at round $round!"
    break
  fi

  # Not approved — log reservations
  {
    echo "### Round $round — Reviewer (Codex)"
    echo ""
    echo "$REVIEWER_REPLY"
    echo ""
    echo "---"
    echo ""
  } >> "$CONVO_FILE"

  wc_reviewer="$(echo "$REVIEWER_REPLY" | wc -w | tr -d ' ')"
  echo "  ⚠️  Reviewer raised reservations ($wc_reviewer words)"

  # ── Step 2: Proposer addresses reservations ──
  echo "  ⏳ Proposer (Claude) is updating the plan..."
  PROPOSER_REPLY="$(run_claude "$(build_proposer_prompt "$round" "$REVIEWER_REPLY")")"

  NEW_PLAN="$(extract_plan "$PROPOSER_REPLY")"
  PROPOSER_REMARKS="$(extract_remarks "$PROPOSER_REPLY")"

  if [[ -n "$NEW_PLAN" ]]; then
    echo "$NEW_PLAN" > "$PLAN_FILE"
  else
    PROPOSER_REMARKS="$PROPOSER_REPLY"
  fi

  {
    echo "### Round $round — Proposer (Claude)"
    echo ""
    echo "$PROPOSER_REMARKS"
    echo ""
    echo "---"
    echo ""
  } >> "$CONVO_FILE"

  wc_proposer="$(echo "$PROPOSER_REMARKS" | wc -w | tr -d ' ')"
  plan_status="unchanged"
  [[ -n "$NEW_PLAN" ]] && plan_status="updated"
  echo "  ✅ Proposer updated ($wc_proposer words, plan $plan_status)"

  echo ""
done

# ─── Wrap up ──────────────────────────────────────────────────────────

{
  echo "## Completed"
  echo ""
  echo "**Finished**: $(timestamp)"
  echo "**Rounds**: $FINAL_ROUND / $MAX_ROUNDS"
  if [[ "$APPROVED" == true ]]; then
    echo "**Result**: Plan approved by Reviewer"
  else
    echo "**Result**: Max iterations reached (not approved)"
  fi
} >> "$CONVO_FILE"

echo ""
echo "✅ Done!"
echo "   Plan:         $PLAN_FILE"
echo "   Conversation: $CONVO_FILE"
if [[ "$APPROVED" == true ]]; then
  echo "   Status:       APPROVED"
else
  echo "   Status:       NOT APPROVED (hit max iterations)"
fi
