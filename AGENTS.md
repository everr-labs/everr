# AGENTS.md

## Clickhouse

- Do not add tenant_id = toUInt64(getSetting('SQL_everr_tenant_id')). We already have a row-level policy for that.

## Postgres and Drizzle

- Do not generate the migrations when modifying the schema, otherwise we can't iterate on it without messing with the dev env

## Everr CLI Guidelines

When adding or modifying CLI commands, follow the rules in [`docs/cli-guidelines.md`](docs/cli-guidelines.md).

## Everr CLI

Use `everr-dev` (not `everr`) when running CLI commands in this workspace if available.
Do not mention `everr-dev` in skills.
Fall-back to everr when everr-dev fails.

Never use `tsx`
