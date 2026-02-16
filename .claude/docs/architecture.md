# Architecture

## Overview

Citric provides CI/CD observability for GitHub Actions using OpenTelemetry standards. The system captures workflow telemetry via webhooks and stores it in ClickHouse for querying and visualization.

```
GitHub Actions → Webhook → OTel Collector → ClickHouse → Web Dashboard
```

## Web App (packages/app)

**Stack:** TanStack Start (full-stack React), TanStack Router, Tailwind CSS 4.x, Vitest

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/routes/` | File-based routes (`__root.tsx` is the layout) |
| `src/components/` | Reusable React components |
| `src/routeTree.gen.ts` | Auto-generated route tree - **do not edit** |

### Routing

Routes are file-based via TanStack Router. Create new routes by adding files to `src/routes/`.

## OpenTelemetry Collector (collector/)

Custom OpenTelemetry Collector that:
- Receives GitHub Actions workflow events via webhook at `/webhook/github`
- Exports traces, metrics, and logs to ClickHouse

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `receiver/githubactionsreceiver/` | Custom webhook receiver for GitHub Actions |
| `config/manifest.yaml` | OTel Collector Builder configuration |
| `config.yaml` | Runtime configuration (create from `config.example.yml`) |

## Data Flow

1. GitHub sends workflow webhook events to the collector
2. Collector transforms events into OpenTelemetry traces/metrics/logs
3. Data is exported to ClickHouse for storage
4. Web dashboard queries ClickHouse to display CI/CD insights

## Infrastructure

| Service | Purpose |
|---------|---------|
| ClickHouse | Primary telemetry storage |
| PostgreSQL | App metadata and user data |

## UI Patterns

When implementing UI changes across multiple routes or pages, always use shared layout components (e.g., TanStack Start layout routes) rather than duplicating layout code. Check for existing layout abstractions before creating inline layouts.

Always use the `Panel` component (`packages/app/src/components/ui/panel.tsx`) for all data-displaying sections on dashboard pages. Panel handles data fetching, loading skeletons, and error states. Use `variant="stat"` for KPI cards, default variant for charts and lists.

## ClickHouse Queries

When fixing ClickHouse queries, remember that column aliases from subqueries cannot be accessed as map expressions in outer queries — reference them by their alias name directly. Always test complex ClickHouse SQL mentally for alias scoping.