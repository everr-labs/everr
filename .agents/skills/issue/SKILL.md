---
name: issue
description: Capture a bug or focused problem into the issue tracker. Low-friction, no gates. Small and scoped — not feature ideas.
---

# Issue Tracker Skill

Use this skill when the user wants to capture a bug or focused problem. Issues are small and scoped — not feature ideas, not pitches. **No investigation, no diagnosis, no fixes. Capture only.**

## Issue Location

All issues live in `.specs/issues/` as individual markdown files:

```
.specs/issues/
└── {issue-name}.md      ← one file per issue, kebab-case
```

## Issue File Format

```markdown
# {Issue Title}

## What
[One sentence: what's broken or wrong]

## Where
[Area / component / file affected]

## Steps to reproduce
[How to trigger it — numbered list, or "N/A" if not applicable]

## Expected
[What should happen]

## Actual
[What actually happens]

## Priority
[critical / high / medium / low / unknown]

## Notes
[Any context, links, related issues, logs]
```

`What` is the only required field. All others are optional — use `unknown` or `N/A` for anything not provided.

## Workflow

### Step 1: Capture

If the user described the issue in the prompt, use that — don't re-ask. Only ask for clarification if the issue is too vague to name or describe in one sentence. Keep it fast.

### Step 2: Create `.specs/issues/{issue-name}.md`

Fill in the template using whatever the user provided. Don't invent details. Derive a kebab-case filename from the issue description (e.g., "webhook re-run events don't create a new job row" → `webhook-job-missing-on-rerun.md`).

### Step 3: Update TASKS.md

Run `bash scripts/update-tasks.sh` to regenerate `TASKS.md` at the repo root.

### Step 4: Show the issue list

After saving, list all existing files in `.specs/issues/` with their `What` line:

```
Open issues:
- webhook-job-missing-on-rerun — Webhook re-run events don't create a new job row
- slow-query-on-trace-view — Trace view query takes >5s on large repos
```

If the list is empty except for the new issue, say so.

## Rules

1. Low-friction — use what's in the prompt; don't interrogate
2. `What` is required; all other fields are optional — `unknown` / `N/A` always valid
3. No gates, no refinement loops, no approval steps
4. Always show the full issue list after saving
5. Do not investigate, diagnose, or fix — capture only
6. Issues are small and focused — if it sounds like a feature, suggest `/idea` or `/spec` instead
