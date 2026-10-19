#!/usr/bin/env bash
# Works a folder of tickets to the end, one ticket at a time, with no choices
# left to an agent.
#
#   scripts/agent-loop.sh docs/specs/2026-10-17-session-replay/tickets
#
# Each ticket is a markdown file `NN-slug.md` with these header lines:
#
#   **Blocked by:** 01, 07            (or "None ...")
#   **Complexity:** high | medium | low
#   **Verify:** `shell command`
#   **Status:** ready-for-agent | done | failed
#
# Loop:
#   1. The frontier is every `ready-for-agent` ticket whose blockers are all
#      `done`. Take the lowest number. No ready tickets left: stop with
#      success. Ready tickets but none unblocked: stop with failure.
#   2. Route by complexity: high -> grok, medium/low -> opencode.
#   3. Attempts: the routed agent, then the same agent again with the failed
#      Verify output, then (only when the route was opencode) grok once.
#      Every attempt builds on the working tree of the one before.
#   4. An attempt passes when the tree changed and Verify exits 0. The loop
#      sets Status to done and commits. The agents never commit.
#   5. All attempts failed: Status is set to failed, the changes stay in the
#      tree for a person to read, and the loop stops.
#
# Env: OPENCODE_MODEL (default opencode-go/deepseek-v4.1-flash),
#      GROK_MODEL (default: grok's own default), DRY_RUN=1 to print the plan.

set -euo pipefail

TICKETS_DIR=${1:?usage: scripts/agent-loop.sh <tickets-dir>}
OPENCODE_MODEL=${OPENCODE_MODEL:-opencode-go/deepseek-v4.1-flash}
GROK_MODEL=${GROK_MODEL:-}
DRY_RUN=${DRY_RUN:-0}

ROOT=$(git rev-parse --show-toplevel)
TICKETS_DIR=$(cd "$TICKETS_DIR" && pwd)
SPEC_DIR=$(dirname "$TICKETS_DIR")
SPEC_FILE="$SPEC_DIR.md"
RUN_DIR="$SPEC_DIR/runs"
RUN_REL=${RUN_DIR#"$ROOT"/}
mkdir -p "$RUN_DIR"

die() { echo "agent-loop: $*" >&2; exit 1; }

# The value of a `**Name:** value` header line.
field() { sed -n "s/^\*\*$2:\*\* *//p" "$1" | head -1; }

ticket_status() { field "$1" Status; }
ticket_number() { basename "$1" | cut -c1-2; }
ticket_title() { sed -n '1s/^# [0-9]*: *//p' "$1"; }
ticket_verify() { field "$1" Verify | sed 's/^`//; s/`$//'; }
ticket_blockers() { field "$1" "Blocked by" | grep -oE '\b[0-9]{2}\b' || true; }

set_status() { perl -pi -e "s/^\*\*Status:\*\* .*/**Status:** $2/" "$1"; }

route() {
  case $(field "$1" Complexity) in
    high) echo grok ;;
    medium | low) echo opencode ;;
    *) die "$(basename "$1"): Complexity must be high, medium, or low" ;;
  esac
}

ticket_by_number() { ls "$TICKETS_DIR/$1"-*.md 2>/dev/null | head -1; }

# The lowest-numbered ready ticket whose blockers are all done.
next_ticket() {
  local f b dep ok
  for f in "$TICKETS_DIR"/[0-9][0-9]-*.md; do
    [[ $(ticket_status "$f") == ready-for-agent ]] || continue
    ok=1
    for b in $(ticket_blockers "$f"); do
      dep=$(ticket_by_number "$b")
      [[ -n $dep ]] || die "$(basename "$f"): blocker $b does not exist"
      [[ $(ticket_status "$dep") == done ]] || { ok=0; break; }
    done
    if [[ $ok == 1 ]]; then echo "$f"; return; fi
  done
}

ready_left() {
  grep -l '^\*\*Status:\*\* ready-for-agent' "$TICKETS_DIR"/[0-9][0-9]-*.md 2>/dev/null |
    wc -l | tr -d ' '
}

# Changes outside the run logs and the ticket files.
tree_changed() {
  [[ -n $(git -C "$ROOT" status --porcelain --untracked-files=all -- . \
    ":!$RUN_REL" ":!${TICKETS_DIR#"$ROOT"/}") ]]
}

write_prompt() { # ticket attempt failure-log out
  {
    cat <<EOF
You are implementing one ticket in the Everr monorepo at $ROOT.

Read first: CLAUDE.md and AGENTS.md at the repo root (they are binding),
CONTEXT.md (use its glossary words), and the spec $SPEC_FILE.

Implement exactly this ticket and nothing else. Do not start other tickets.
Do not commit, push, or create branches. Do not edit the ticket file.
When you add, rename, or remove an emitted event or attribute, update
skills/everr-use-telemetry/rules/browser-events.md.

Before you stop, run this command from the repo root and make it pass:

    $(ticket_verify "$1")

--- TICKET ---
$(cat "$1")
EOF
    if [[ -n ${3:-} && -s $3 ]]; then
      cat <<EOF

--- PREVIOUS ATTEMPT ---
Attempt $(($2 - 1)) left its changes in the working tree, but the Verify
command failed. Its last output:

$(tail -n 150 "$3")

Fix the failure, building on the existing changes.
EOF
    fi
  } >"$4"
}

run_agent() { # agent prompt-file log
  case $1 in
    grok)
      (cd "$ROOT" && grok --cwd "$ROOT" --always-approve --no-alt-screen \
        --output-format plain ${GROK_MODEL:+--model "$GROK_MODEL"} \
        --prompt-file "$2") >"$3" 2>&1 || true ;;
    opencode)
      (cd "$ROOT" && opencode run --auto --model "$OPENCODE_MODEL" \
        --title "$(basename "$2" .prompt.md)" "$(cat "$2")") >"$3" 2>&1 || true ;;
  esac
}

verify() { # ticket log
  (cd "$ROOT" && bash -c "$(ticket_verify "$1")") >"$2" 2>&1
}

# Preconditions: a feature branch and no tracked changes, so every commit
# holds one ticket's work.
branch=$(git -C "$ROOT" branch --show-current)
[[ $branch != main ]] || die "refusing to run on main; create a branch first"
if [[ $DRY_RUN != 1 ]]; then
  git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet ||
    die "tracked changes in the tree; commit or stash them first"
fi

# A dry run marks tickets done in a copy, so the real files never change.
if [[ $DRY_RUN == 1 ]]; then
  copy=$(mktemp -d)
  cp "$TICKETS_DIR"/[0-9][0-9]-*.md "$copy/"
  TICKETS_DIR=$copy
fi

while :; do
  ticket=$(next_ticket)
  if [[ -z $ticket ]]; then
    left=$(ready_left)
    [[ $left == 0 ]] && { echo "agent-loop: all tickets done"; exit 0; }
    die "$left ticket(s) ready but blocked by a ticket that is not done"
  fi

  n=$(ticket_number "$ticket")
  title=$(ticket_title "$ticket")
  primary=$(route "$ticket")
  plan=("$primary" "$primary")
  [[ $primary == opencode ]] && plan+=(grok)

  echo "agent-loop: $n $title -> ${plan[*]}"
  if [[ $DRY_RUN == 1 ]]; then set_status "$ticket" done; continue; fi

  passed=0 failure=""
  for i in "${!plan[@]}"; do
    attempt=$((i + 1))
    agent=${plan[$i]}
    base="$RUN_DIR/$n-attempt$attempt-$agent"
    write_prompt "$ticket" "$attempt" "$failure" "$base.prompt.md"
    echo "agent-loop:   attempt $attempt ($agent)"
    run_agent "$agent" "$base.prompt.md" "$base.agent.log"
    if ! tree_changed; then
      echo "agent did not change any file" >"$base.verify.log"
    elif verify "$ticket" "$base.verify.log"; then
      passed=1
      break
    fi
    failure="$base.verify.log"
    echo "agent-loop:   verify failed, see $failure"
  done

  if [[ $passed == 1 ]]; then
    set_status "$ticket" done
    git -C "$ROOT" add -A -- . ":!$RUN_REL"
    git -C "$ROOT" commit -q --no-verify -m "feat(session-replay): $title" \
      -m "Ticket $n, implemented by $agent (attempt $attempt)."
    echo "agent-loop:   done, $(git -C "$ROOT" rev-parse --short HEAD)"
  else
    set_status "$ticket" failed
    die "ticket $n failed after ${#plan[@]} attempts; changes left in the tree"
  fi
done
