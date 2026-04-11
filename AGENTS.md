# AGENTS.md

## Skills

Repo-local skills live in `.agents/skills/`. Check them proactively.

When the everr cli doesn't work, investigate why instead of falling back to something else.

## Clickhouse

- Do not use PREWHERE unless explicitly requested. Clickhouse has an automatic optimzation that is often better than a customized one.
- Do not add tenant_id = toUInt64(getSetting('SQL_everr_tenant_id')). We already have a row-level policy for that.

## Postgres and Drizzle

- Do not generate the migrations when modifying the schema, otherwise we can't iterate on it without messing with the dev env

## Quick Capture — Ideas and Issues

Use these directly when the user wants to capture an idea or log an issue. No skill invocation needed. Use what's in the prompt — don't re-ask what was already said. Keep it fast and low-friction.

**After saving either type**: run `bash scripts/update-todo.sh`, then list all files in the relevant `todo/` subfolder with their `What` line.

### Idea → `todo/ideas/{kebab-name}.md`

For raw feature thoughts not ready for shaping. Template sections: `What`, `Why`, `Who`, `Rough appetite` (small/medium/big/unknown), `Notes`. All fields optional — use `unknown` or leave empty if not provided. Do not shape or write code. If mature enough, suggest the `/project` skill.

### Issue → `todo/issues/{kebab-name}.md`

For bugs and focused problems. Template sections: `What`, `Where`, `Steps to reproduce`, `Expected`, `Actual`, `Priority` (critical/high/medium/low/unknown), `Notes`. Only `What` is required — use `unknown`/`N/A` for the rest. Do not investigate or fix — capture only. If it sounds like a feature, route to Idea or `/project` instead.

## Everr CLI Guidelines

When adding or modifying CLI commands, follow the rules in [`docs/cli-guidelines.md`](docs/cli-guidelines.md).

## Everr CLI

<!-- BEGIN everr -->
For CI, GitHub Actions, pipelines, workflow logs, or test performance tasks: call `everr ai-instructions` for full usage.

Quick start — run `everr status` to get the current commit's pipeline state while you plan your next steps.
<!-- END everr -->

Use `everr-dev` (not `everr`) when running CLI commands in this workspace if available.
