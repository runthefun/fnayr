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
REVIEWER_TEMPLATE="$SCRIPT_DIR/REVIEWER.md"
PROPOSER_TEMPLATE="$SCRIPT_DIR/PROPOSER.md"

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

# ─── Template rendering ──────────────────────────────────────────────
# Reads a template file and replaces {{KEY}} placeholders with values.
# Usage: render_template <file> KEY1 VAL1 KEY2 VAL2 ...

render_template() {
  local file="$1"; shift
  local result
  result="$(cat "$file")"

  while [[ $# -ge 2 ]]; do
    local key="$1" val="$2"; shift 2
    # Use awk to avoid sed delimiter issues with arbitrary content
    result="$(awk -v pat="{{${key}}}" -v rep="$val" '{
      idx = index($0, pat)
      while (idx > 0) {
        $0 = substr($0, 1, idx-1) rep substr($0, idx + length(pat))
        idx = index($0, pat)
      }
      print
    }' <<< "$result")"
  done

  printf '%s' "$result"
}

# ─── Reviewer prompt (Codex) ─────────────────────────────────────────

build_reviewer_prompt() {
  local round="$1"
  local plan
  plan="$(cat "$PLAN_FILE")"

  render_template "$REVIEWER_TEMPLATE" \
    PLAN           "$plan" \
    ROUND          "$round" \
    APPROVE_MARKER "$APPROVE_MARKER" \
    PLAN_OPEN      "$PLAN_OPEN" \
    PLAN_CLOSE     "$PLAN_CLOSE"
}

# ─── Proposer prompt (Claude) ────────────────────────────────────────

build_proposer_prompt() {
  local round="$1"
  local remarks="$2"
  local plan
  plan="$(cat "$PLAN_FILE")"

  render_template "$PROPOSER_TEMPLATE" \
    PLAN       "$plan" \
    ROUND      "$round" \
    REMARKS    "$remarks" \
    PLAN_OPEN  "$PLAN_OPEN" \
    PLAN_CLOSE "$PLAN_CLOSE"
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

for tmpl in "$REVIEWER_TEMPLATE" "$PROPOSER_TEMPLATE"; do
  if [[ ! -f "$tmpl" ]]; then
    echo "Error: template not found: $tmpl"
    exit 1
  fi
done

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
