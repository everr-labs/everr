# Citric

CI/CD observability platform built on OpenTelemetry. Collects telemetry from GitHub Actions workflows and stores data in ClickHouse for visualization and analysis.

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `packages/app` | React + TanStack Start web dashboard |
| `packages/docs` | Fumadocs documentation site |
| `collector/` | Go-based OpenTelemetry Collector |

## Quick Reference

```bash
# Root
pnpm install          # Install dependencies
pnpm check            # Lint + format (Biome)

# Web App (packages/app)
pnpm dev              # Dev server
pnpm test             # Vitest tests
pnpm build            # Production build

# Docs (packages/docs)
pnpm --filter docs dev    # Dev server
pnpm --filter docs build  # Production build

# Collector (collector/)
make run              # Build and run collector
make test-all         # Run Go tests
```

## Development Environment

- The dev server (`pnpm dev`) is always running in a separate terminal - do not start it
- ClickHouse is running locally with the `citric` database
- Changes to the web app will hot-reload automatically

## Guidelines

- [Architecture](.claude/docs/architecture.md) - System design and key directories
- [Development Setup](.claude/docs/development.md) - Local environment setup
- [Code Style](.claude/docs/code-style.md) - Formatting and conventions
- Features and documentation live in `packages/docs` — keep docs up to date when adding or modifying features


Your context window will be automatically compacted as it approaches its limit, allowing you to continue working
indefinitely from where you left off. Therefore, do not stop tasks early due to token budget concerns.
As you approach your token budget limit, save your current progress and state to memory before the context window refreshes.
Always be as persistent and autonomous as possible and complete tasks fully, even if the end of your budget is approaching.
Never artificially stop any task early regardless of the context remaining.

## Code Patterns

When implementing UI changes across multiple routes or pages, always use shared layout components (e.g., TanStack Start layout routes) rather than duplicating layout code. Check for existing layout abstractions before creating inline layouts.

Always use the `Panel` component (`packages/app/src/components/ui/panel.tsx`) for all data-displaying sections on dashboard pages. Panel handles data fetching, loading skeletons, and error states. Use `variant="stat"` for KPI cards, default variant for charts and lists.

##  ClickHouse section.

When fixing ClickHouse queries, remember that column aliases from subqueries cannot be accessed as map expressions in outer queries — reference them by their alias name directly. Always test complex ClickHouse SQL mentally for alias scoping.
