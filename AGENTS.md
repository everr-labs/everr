# CONSTITUTION

Never add tests for YAML files that only check their text content.

NEVER use a useEffect to react to props change to update an internal state. That's the worst thing you can do in a React app.

Never use em dashes (—) or en dashes (–) in the docs. Use commas, colons, parentheses, or separate sentences instead. CLI flags and operators such as `--yes` stay as written.

When working with Telemetry, always check that ingestion works as expected using Everr.

MUST follow the oTel semconv when available.

Custom attrs should be under everr. prefix

example:

- browser.web_vital.ttfb.request_duration isn't standard, so it should be everr.browser.web_vital.ttfb.request_duration
- browser.web_vital.value is standard and should not be prefixed

## Web app `packages/app`

Always test changes manually, use the credentials from .auth (look for this on the main worktree)
If .auth is not available, skip.

## Clickhouse

- Do not add tenant_id = toUInt64(getSetting('SQL_everr_tenant_id')). We already have a row-level policy for that.
- ClickHouse migrations (`packages/app/clickhouse`) run on production at server startup. Never write a disruptive migration, one that causes issues in production when it runs. If a change needs one of these, stop and ask:
  - no dropped or truncated tables, columns, or partitions that hold data
  - no statement that rewrites existing data on a large table (a mutation such as `ALTER ... UPDATE`, `DELETE`, `MATERIALIZE`, or a column type change)
  - no step that leaves a table without its tenant filter or a user without its grants, even for a moment (use `OR REPLACE`, not `DROP` then `CREATE`)
  - no change that breaks the running collector or the previous app version during a rolling deploy
  - every statement must be safe to repeat (`IF NOT EXISTS`, `OR REPLACE`)

## Postgres and Drizzle

- Do not generate the migrations when modifying the schema, otherwise we can't iterate on it without messing with the dev env

## Everr CLI

Use `everr-dev` (not `everr`) when running CLI commands in this workspace if available.
Do not mention `everr-dev` in skills.

When I mention "production" as target, use everr instead of everr-dev.

## Web SDK `packages/otel-web`

Keep the bundle size minimal and measure the size using `pnpm size` at each meaningful iteration.

When adding, renaming, or removing an emitted event or attribute, update the catalog in `skills/everr-use-telemetry/rules/browser-events.md`.
