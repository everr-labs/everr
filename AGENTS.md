# AGENTS.md

## Skills

Repo-local skills live in `.agents/skills/`. Check them proactively.

When the everr cli doesn't work, investigate why instead of falling back to something else.

## Clickhouse

- Do not use PREWHERE unless explicitly requested. Clickhouse has an automatic optimzation that is often better than a customized one.
- Do not add tenant_id = toUInt64(getSetting('SQL_everr_tenant_id')). We already have a row-level policy for that.
