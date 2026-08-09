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

## Postgres and Drizzle

- Do not generate the migrations when modifying the schema, otherwise we can't iterate on it without messing with the dev env

## Everr CLI

Use `everr-dev` (not `everr`) when running CLI commands in this workspace if available.
Do not mention `everr-dev` in skills.

When I mention "production" as target, use everr instead of everr-dev.

## Web SDK `packages/otel-web`

Keep the bundle size minimal and measure the size using `pnpm size` at each meaningful iteration.
