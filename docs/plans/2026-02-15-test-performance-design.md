# Test Performance Page Design

## Overview

A new dashboard page at `/dashboard/test-performance` for analyzing test execution duration and failure patterns over time. Users can filter by repository, package, test name, and branch, then investigate trends via a scatter plot, KPIs, duration trend chart, and a failures table.

## Route & Navigation

- **Route**: `/dashboard/test-performance`
- **Sidebar**: New entry "Test Performance" alongside existing test-related pages
- **Search params**: Extends `TimeRangeSearchSchema` with `repo`, `package`, `testName`, `branch`

## Page Layout

```
Page Header → Filter Bar → KPI Row → Scatter Plot → Duration Trend → Failures Table
```

### Filter Bar

Horizontal bar with:
- **Repository** dropdown (distinct repos in time range, default "All")
- **Package** dropdown (scoped to selected repo, default "All")
- **Test name** combobox with search (scoped to repo/package, default empty = all)
- **Branch** toggle: "All" | "main only"

All filter values stored in URL search params for shareability.

### KPI Stats Row (4 stat Panels)

| KPI | Description |
|-----|-------------|
| Total Executions | Count of matching test executions |
| Avg Duration | Average test duration |
| P95 Duration | 95th percentile duration |
| Failure Rate | % of executions that failed |

### Scatter Plot

- **X-axis**: Timestamp
- **Y-axis**: Duration (seconds)
- **Color**: Test outcome (green = pass, red = fail)
- **Shape**: Branch type (circle = main/stable, triangle = other branches)
- **Tooltip**: Test name, duration, branch, commit SHA, timestamp
- **Click**: Navigate to `/dashboard/runs/$traceId`
- **Sampling**: Server-side LIMIT 1000, ordered by timestamp
- **Empty state**: ChartEmptyState with filter guidance

### Duration Trend Chart

Recharts LineChart showing avg, p50, p95 duration per day. Same pattern as existing `TestDurationTrendChart` but scoped to active filters.

### Recent Failures Table

| Column | Description |
|--------|-------------|
| Test Name | Full test name |
| Timestamp | When the failure occurred |
| Duration | Test duration |
| Branch | Branch name |
| Commit | Truncated SHA |
| Run | Link to `/dashboard/runs/$traceId` |

Sorted most recent first, limited to 50 rows.

## Data Layer

New file: `packages/app/src/data/test-performance.ts`

### Server Functions

All accept `TimeRangeInput` + filter params (repo, package, testName, branch).

1. **`getTestPerformanceScatter`** — Individual test executions for scatter plot (LIMIT 1000)
2. **`getTestPerformanceStats`** — 4 KPI aggregate values
3. **`getTestPerformanceTrend`** — Daily avg/p50/p95 duration
4. **`getTestPerformanceFailures`** — Recent failures (LIMIT 50)
5. **`getTestPerformanceRepos`** — Distinct repos for filter dropdown
6. **`getTestPerformancePackages`** — Distinct packages for selected repo
7. **`getTestPerformanceTestNames`** — Distinct test names for combobox

### ClickHouse Queries

All query the `otel_traces` table using:
- `SpanAttributes['citric.test.duration_seconds']` for duration
- `SpanAttributes['citric.test.result']` for outcome
- `SpanAttributes['citric.test.name']` and `SpanAttributes['citric.test.parent_test']` for test name
- `SpanAttributes['citric.test.package']` for package
- `ResourceAttributes['vcs.repository.name']` for repo
- `ResourceAttributes['vcs.ref.head.name']` for branch
- `ResourceAttributes['cicd.pipeline.run.id']` for run ID
- `ResourceAttributes['vcs.ref.head.revision']` for commit SHA

### React Query Integration

Each server function has a corresponding `queryOptions` factory. Filter dropdown queries depend on selected filters (package options depend on repo selection, etc.).

## Technology

- Recharts `ScatterChart` for the scatter plot
- Recharts `LineChart` for duration trend
- Panel component for all data-displaying sections
- Existing ChartContainer/ChartTooltip infrastructure
- TanStack Router search params for filter state
- Zod validation for all inputs
