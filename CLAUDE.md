# Everr

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
- ClickHouse is running locally with the `everr` database
- Changes to the web app will hot-reload automatically

## Guidelines

- [Architecture](.claude/docs/architecture.md) - System design, UI patterns, and key directories
- [Development Setup](.claude/docs/development.md) - Local environment setup
- [Code Style](.claude/docs/code-style.md) - Formatting and conventions
