---
name: idea
description: Capture a raw idea into the Shape Up backlog. Low-friction, no gates. Feeds the betting table inbox.
---

# Idea Backlog Skill

Use this skill when the user wants to capture a rough idea. This is the pre-shaping inbox — ideas here are uncommitted and not yet shaped. **No implementation, no gates, no approval steps.**

## Backlog Location

All ideas live in `.specs/ideas/` as individual markdown files:

```
.specs/ideas/
└── {idea-name}.md      ← one file per idea, kebab-case
```

## Idea File Format

```markdown
# {Idea Title}

## What
[One sentence: what this is]

## Why
[Why this matters — what problem it solves or opportunity it opens]

## Who
[Who is affected or who benefits]

## Rough appetite
[small / medium / big / unknown]

## Notes
[Any early thoughts, links, prior art, related ideas]
```

Fields are intentionally loose. An idea doesn't need to be fully formed. Leave `Notes` empty if not provided. Use `unknown` for `Rough appetite` if not stated.

## Workflow

### Step 1: Capture

If the user described the idea in the prompt, use that — don't re-ask. If the idea is unclear, ask for:
- A name (1-4 words, kebab-case for the filename)
- A one-liner description

Keep it fast. This is a low-friction capture, not an interview.

### Step 2: Create `.specs/ideas/{idea-name}.md`

Fill in the template using whatever the user provided. Don't invent information — use `unknown` or leave a field minimal if there's not enough to fill it.

### Step 3: Update TASKS.md

Run `bash scripts/update-tasks.sh` to regenerate `TASKS.md` at the repo root.

### Step 4: Show the backlog

After saving, list all existing files in `.specs/ideas/` with their `What` line as a one-liner summary:

```
Current idea backlog:
- flame-graph-for-slow-jobs — Show a flame graph for slow CI jobs
- webhook-retry-ui — Manual retry button for failed webhook deliveries
- ...
```

If the backlog is empty except for the new idea, say so.

Optionally, if the idea seems mature enough: *"When you're ready to shape this, run `/spec` to turn it into a pitch."*

## Rules

1. Low-friction — ask only what's needed; use what's already in the prompt
2. All fields are optional; `unknown` is always valid
3. No gates, no refinement loops, no approval steps
4. Always show the full backlog after saving
5. Do not start shaping or writing code
6. Ideas are uncommitted — capturing one is not a decision to build it
