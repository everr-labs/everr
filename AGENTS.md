# AGENTS.md

## Skills

Repo-local skills live in `.agents/skills/`. Check them proactively.

When the everr cli doesn't work, investigate why instead of falling back to something else.

## Clickhouse

- Do not use PREWHERE unless explicitly requested. Clickhouse has an automatic optimzation that is often better than a customized one.
- Do not add tenant_id = toUInt64(getSetting('SQL_everr_tenant_id')). We already have a row-level policy for that.

## Postgres and Drizzle

- Do not generate the migrations when modifying the schema, otherwise we can't iterate on it without messing with the dev env

## Everr CLI

<!-- BEGIN everr -->
For CI, GitHub Actions, pipelines, workflow logs, or test performance tasks: call `everr ai-instructions` for full usage.

Quick start — run `everr status` to get the current commit's pipeline state while you plan your next steps.
<!-- END everr -->

Use `everr-dev` (not `everr`) when running CLI commands in this workspace if available.
