# Workflows Page Design

## Overview

A dedicated Workflows page that aggregates CI/CD data per workflow, providing deeper insight than the general overview. Two routes: a list page for spotting problematic workflows at a glance, and a detail page for investigating a specific workflow's trends over time.

## Routes & Navigation

Two new routes following the existing list-to-detail pattern (like Runs):

- `/dashboard/workflows/` — list page
- `/dashboard/workflows/$workflowName` — detail page (workflow name is URL-encoded)

Navigation: add "Workflows" to the CI/CD sidebar group between "Runs" and "Failures".

## Workflows List Page

### Filters
- **Repository dropdown** — reuses existing filter options from `getRunFilterOptions`
- **Name search** — text input for filtering workflows by name (client-side or ILIKE query)

### Table

| Column | Content |
|--------|---------|
| Workflow | Name (link to detail page) |
| Repository | Repo name |
| Runs | Count + delta vs prior period, sparkline background |
| Success Rate | Percentage + colored badge + delta, sparkline background |
| Avg Duration | Formatted duration + delta, sparkline background (rolling avg) |
| Last Run | Relative timestamp |

Each metric column (Runs, Success Rate, Avg Duration) includes:
- **Sparkline background**: time-bucketed data rendered behind the value at low opacity (same style as dashboard KPI cards)
- **Period-over-period delta**: comparison against the preceding time range of equal width (e.g., last 7d vs prior 7d), shown as `+12%` / `-5%` with green/red coloring

### Search Params
`repo`, `search`, `page` — all optional, plus inherited `from`, `to`, `refresh` from `TimeRangeSearchSchema`.

### Pagination
Same `Pagination` component as Runs page, 20 items per page.

## Workflow Detail Page

### KPI Stat Cards (4-column grid)

All use `Panel` with `variant="stat"`, sparkline backgrounds, and delta vs prior period:

- **Total Runs** — run count for this workflow
- **Success Rate** — percentage with color coding
- **Avg Duration** — formatted, with p95 subtitle
- **Est. Cost** — estimated cost for this workflow

### Trend Charts (2-column grid)

- **Success Rate Trend** — line chart over the selected time range
- **Duration Trend** — line chart showing avg + p95 duration over time

### Detail Panels (2-column grid)

- **Top Failing Jobs** — jobs within this workflow ranked by failure count, with badge showing count
- **Failure Reasons** — most common error messages with occurrence count

### Recent Runs (full-width)

Reuses existing `RunsTable` component, pre-filtered to the workflow. "View all" links to `/dashboard/runs?workflowName=<name>`.

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `packages/app/src/routes/dashboard/workflows/index.tsx` | List page route |
| `packages/app/src/routes/dashboard/workflows/$workflowName.tsx` | Detail page route |
| `packages/app/src/data/workflows.ts` | All ClickHouse queries + query option factories |
| `packages/app/src/components/workflows/workflows-table.tsx` | Table with sparkline backgrounds + deltas |
| `packages/app/src/components/workflows/workflows-filter-bar.tsx` | Repo filter + name search |

### Modified Files

| File | Change |
|------|--------|
| `packages/app/src/lib/navigation.ts` | Add "Workflows" to CI/CD nav group |

## ClickHouse Queries

All in `packages/app/src/data/workflows.ts`:

| Function | Purpose |
|----------|---------|
| `getWorkflowsList` | Aggregated list with current + prior period metrics |
| `getWorkflowsSparklines` | Time-bucketed data per workflow for sparkline backgrounds |
| `getWorkflowFilterOptions` | Reuses existing repos list |
| `getWorkflowStats` | KPI stats for detail page with prior period deltas |
| `getWorkflowSuccessRateTrend` | Success rate over time for detail chart |
| `getWorkflowDurationTrend` | Avg + p95 duration over time for detail chart |
| `getWorkflowTopFailingJobs` | Jobs ranked by failure count within workflow |
| `getWorkflowFailureReasons` | Common error messages within workflow |
| `getWorkflowRecentRuns` | Recent runs for the workflow |

## Data Model

Workflows are identified by `ResourceAttributes['cicd.pipeline.name']` in the `otel_traces` table. Aggregations group by this field plus `ResourceAttributes['vcs.repository.name']` for the list view.

Period-over-period comparison uses conditional aggregation within a single query: the WHERE clause spans both current and prior periods, with `countIf`/`avgIf` separating the two ranges.
