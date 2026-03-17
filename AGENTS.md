# AGENTS.md

## Skills

Repo-local skills live in `.agents/skills/`. Check them proactively.

When the everr cli doesn't work, investigate why instead of falling back to something else.

## Clickhouse

- Do not use PREWHERE unless explicitly requested. Clickhouse has an automatic optimzation that is often better than a customized one.
- Do not add tenant_id = toUInt64(getSetting('SQL_everr_tenant_id')). We already have a row-level policy for that.

## Postgres and Drizzle

- Do not generate the migrations when modifying the schema, otherwise we can't iterate on it without messing with the dev env

<!-- BEGIN everr -->
Use Everr CLI guidance when the task involves CI, GitHub Actions workflows, pipelines, CI failures, workflow logs, or CI test performance from the current project directory.

Call `everr ai-instructions` to understand usage.
<!-- END everr -->
