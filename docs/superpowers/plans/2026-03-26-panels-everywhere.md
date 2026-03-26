# Panels Everywhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Cost Analysis, Workflow Detail, and Repositories pages to use the `<Panel>` component for data fetching and display, matching the pattern used in the Dashboard Overview.

**Architecture:** Each page replaces manual `useQuery` + `<Card>` patterns with `<Panel queries={[...]}>{(data) => ...}</Panel>`. For pages whose query factories need extra params beyond `timeRange` (repos, workflow detail), we use closures that bind the extra params and return a `TimeRangeInput`-compatible factory. The `<Panel>` component itself is unchanged.

**Tech Stack:** React, TanStack Query, TanStack Router, TypeScript

---

## File Map

| Page | File | Change |
|------|------|--------|
| Cost Analysis | `packages/app/src/routes/_authenticated/_dashboard/cost-analysis.tsx` | Modify: replace `useQuery` + `Card` with `Panel` |
| Repositories | `packages/app/src/routes/_authenticated/_dashboard/repos.tsx` | Modify: replace `useQuery` + `Card` with `Panel` using closures |
| Workflow Detail | `packages/app/src/routes/_authenticated/_dashboard/workflows/$repo/$workflowName.tsx` | Modify: replace `useQuery` + `Card` with `Panel` using closures |

No new files. No changes to `panel.tsx`. No changes to query option files.

---

### Task 1: Migrate Cost Analysis page

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/cost-analysis.tsx`

This is the simplest migration — all three query factories (`costOverviewOptions`, `costByRepoOptions`, `costByWorkflowOptions`) already accept `TimeRangeInput`, so they work with `<Panel>` directly.

- [ ] **Step 1: Replace stat cards with Panel variant="stat"**

Replace the 4 manual stat `<Card>` components and the 3 `useQuery` hooks with `<Panel variant="stat">` components. The first 4 stats all come from `costOverviewOptions` (the `summary` field).

Replace the entire `CostAnalysisPage` function with:

```tsx
function CostAnalysisPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cost Analysis</h1>
          <p className="text-muted-foreground">
            Estimated GitHub Actions spend based on runner usage
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Panel
          title="Estimated Cost"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={DollarSign}
        >
          {(overview) => formatCost(overview.summary.totalCost)}
        </Panel>

        <Panel
          title="Total Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Clock}
        >
          {(overview) =>
            Math.round(overview.summary.totalMinutes).toLocaleString()
          }
        </Panel>

        <Panel
          title="Billing Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Receipt}
        >
          {(overview) => overview.summary.totalBillingMinutes.toLocaleString()}
        </Panel>

        <Panel
          title="Self-Hosted Minutes"
          queries={[costOverviewOptions]}
          variant="stat"
          icon={Server}
        >
          {(overview) =>
            Math.round(overview.summary.selfHostedMinutes).toLocaleString()
          }
        </Panel>
      </div>

      <Panel
        title="Cost Over Time"
        description="Daily estimated cost by operating system"
        queries={[costOverviewOptions]}
      >
        {(overview) => <CostOverTimeChart data={overview.overTime} />}
      </Panel>

      <Panel
        title="Cost by Runner"
        description="Estimated cost per runner type"
        queries={[costOverviewOptions]}
      >
        {(overview) => <CostByRunnerChart data={overview.byRunner} />}
      </Panel>

      <Panel
        title="Cost by Repository"
        description="Per-repository cost breakdown"
        queries={[costByRepoOptions]}
      >
        {(byRepo) => <CostByRepoTable data={byRepo} />}
      </Panel>

      <Panel
        title="Cost by Workflow"
        description="Per-workflow cost breakdown"
        queries={[costByWorkflowOptions]}
      >
        {(byWorkflow) => <CostByWorkflowTable data={byWorkflow} />}
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: Update imports**

Replace the import block at the top of the file. Remove `Card*`, `Skeleton`, `useQuery`. Add `Panel` and icons.

```tsx
import { Clock, DollarSign, Receipt, Server } from "lucide-react";
import {
  CostByRepoTable,
  CostByRunnerChart,
  CostByWorkflowTable,
  CostOverTimeChart,
} from "@/components/cost-analysis";
import { Panel } from "@/components/panel";
import {
  costByRepoOptions,
  costByWorkflowOptions,
  costOverviewOptions,
} from "@/data/cost-analysis/options";
import { formatCost } from "@/lib/runner-pricing";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";
```

Note: `createFileRoute` is still needed for the Route export.

- [ ] **Step 3: Remove CostAnalysisSkeleton**

Delete the `CostAnalysisSkeleton` function entirely and remove `pendingComponent: CostAnalysisSkeleton` from the Route config. Panel handles its own loading states.

- [ ] **Step 4: Verify the page works**

Run: `pnpm --filter app dev` and navigate to the Cost Analysis page. Verify:
- 4 stat cards render with correct values
- 4 content panels render charts/tables
- Loading skeletons appear before data loads
- Error states show if a query fails (can test by disconnecting network briefly)

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/cost-analysis.tsx
git commit -m "refactor: migrate cost analysis page to Panel component"
```

---

### Task 2: Migrate Repositories page

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/repos.tsx`

The repo query factories take `RepoDetailInput` (`{ timeRange, repo }`), not just `TimeRangeInput`. We use closures to bind the `repo` param. The `RepoHeader` component stays — it uses stats data outside any card, so we keep a single `useQuery` for it.

- [ ] **Step 1: Replace card section with Panels using closures**

Replace the `RepoDetailPage` function. Key changes:
- Keep `repoStatsOptions` as a direct `useQuery` for the `RepoHeader`
- Define closure factories that bind `repo` for Panel compatibility
- Replace all 5 `<Card>` blocks with `<Panel>` components

```tsx
function RepoDetailPage() {
  const { timeRange, name } = Route.useLoaderDeps();
  const input = { timeRange, repo: name };
  const enabled = !!name;
  const { data: stats } = useQuery({ ...repoStatsOptions(input), enabled });

  // Closures that bind `repo` so Panel can pass just { timeRange }
  const successRateTrend = (tr: TimeRangeInput) =>
    repoSuccessRateTrendOptions({ ...tr, repo: name });
  const durationTrend = (tr: TimeRangeInput) =>
    repoDurationTrendOptions({ ...tr, repo: name });
  const failingJobs = (tr: TimeRangeInput) =>
    topFailingJobsOptions({ ...tr, repo: name });
  const branches = (tr: TimeRangeInput) =>
    activeBranchesOptions({ ...tr, repo: name });
  const recentRuns = (tr: TimeRangeInput) =>
    repoRecentRunsOptions({ ...tr, repo: name });

  if (!name) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground text-sm">
        Select a repository to view details. Navigate from the overview page or
        use ?name=owner/repo.
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <RepoHeader name={name} stats={stats} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel
          title="Success Rate"
          description="Build reliability over time"
          queries={[successRateTrend]}
        >
          {(data) => <RepoSuccessRateChart data={data} />}
        </Panel>

        <Panel
          title="Duration Trends"
          description="Job duration P50 and P95"
          queries={[durationTrend]}
        >
          {(data) => <RepoDurationTrendChart data={data} />}
        </Panel>
      </div>

      <Panel
        title="Top Failing Jobs"
        description="Jobs with the highest failure count"
        queries={[failingJobs]}
      >
        {(data) => <TopFailingJobsTable data={data} />}
      </Panel>

      <Panel
        title="Active Branches"
        description="Branches with recent activity"
        queries={[branches]}
      >
        {(data) => <ActiveBranchesTable data={data} />}
      </Panel>

      <Panel
        title="Recent Runs"
        description="Latest workflow runs for this repository"
        queries={[recentRuns]}
      >
        {(data) => <RepoRecentRuns data={data} />}
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: Update imports**

Replace the import block. Remove `Card*`, `Skeleton`. Add `Panel` and `TimeRangeInput`.

```tsx
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  ActiveBranchesTable,
  RepoDurationTrendChart,
  RepoHeader,
  RepoRecentRuns,
  RepoSuccessRateChart,
  TopFailingJobsTable,
} from "@/components/repo-detail";
import { Panel } from "@/components/panel";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  activeBranchesOptions,
  repoDurationTrendOptions,
  repoRecentRunsOptions,
  repoStatsOptions,
  repoSuccessRateTrendOptions,
  topFailingJobsOptions,
} from "@/data/repo-detail/options";
import { TimeRangeSearchSchema, withTimeRange } from "@/lib/time-range";
```

- [ ] **Step 3: Remove RepoDetailSkeleton**

Delete the `RepoDetailSkeleton` function and remove `pendingComponent: RepoDetailSkeleton` from the Route config.

- [ ] **Step 4: Verify the page works**

Run: `pnpm --filter app dev` and navigate to `/repos?name=some-org/some-repo`. Verify:
- RepoHeader still shows stats badges
- 5 panels render with correct data
- Empty repo name shows placeholder message
- Loading skeletons appear on each panel independently

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/repos.tsx
git commit -m "refactor: migrate repositories page to Panel component"
```

---

### Task 3: Migrate Workflow Detail page

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/workflows/$repo/$workflowName.tsx`

Most complex migration. 7 query factories all take `WorkflowDetailInput` (`{ timeRange, workflowName, repo }`). Uses closures like repos page. The `DeltaIndicator` helper and `durationChartConfig`/`durationTooltipFormatter` stay — they're used inside panel children.

- [ ] **Step 1: Replace the component with Panel-based version**

Replace the `WorkflowDetailPage` function. Key changes:
- Remove all 7 `useQuery` hooks
- Define closure factories binding `workflowName` and `repo`
- Replace all 9 card sections with `<Panel>` components
- Stat cards use multiple queries (e.g. `[wfStats, wfSuccessTrend]`) for sparkline backgrounds

```tsx
function WorkflowDetailPage() {
  const { workflowName: rawName, repo: rawRepo } = Route.useParams();
  const workflowName = decodeURIComponent(rawName);
  const repo = decodeURIComponent(rawRepo);

  // Closures that bind workflowName + repo so Panel can pass just { timeRange }
  const wfStats = (tr: TimeRangeInput) =>
    workflowStatsOptions({ ...tr, workflowName, repo });
  const wfSuccessTrend = (tr: TimeRangeInput) =>
    workflowSuccessRateTrendOptions({ ...tr, workflowName, repo });
  const wfDurationTrend = (tr: TimeRangeInput) =>
    workflowDurationTrendOptions({ ...tr, workflowName, repo });
  const wfCost = (tr: TimeRangeInput) =>
    workflowCostOptions({ ...tr, workflowName, repo });
  const wfFailingJobs = (tr: TimeRangeInput) =>
    workflowTopFailingJobsOptions({ ...tr, workflowName, repo });
  const wfFailureReasons = (tr: TimeRangeInput) =>
    workflowFailureReasonsOptions({ ...tr, workflowName, repo });
  const wfRecentRuns = (tr: TimeRangeInput) =>
    workflowRecentRunsOptions({ ...tr, workflowName, repo });

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{workflowName}</h1>
        <p className="text-muted-foreground">{repo}</p>
      </div>

      {/* KPI stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Panel
          title="Total Runs"
          queries={[wfStats, wfSuccessTrend]}
          variant="stat"
          icon={Activity}
          background={(_stats, trends) => (
            <Sparkline
              data={trends.map((t) => t.totalRuns)}
              className="h-full w-full"
            />
          )}
        >
          {(stats) => (
            <>
              {stats.totalRuns.toLocaleString()}{" "}
              <DeltaIndicator
                current={stats.totalRuns}
                previous={stats.prevTotalRuns}
              />
            </>
          )}
        </Panel>

        <Panel
          title="Success Rate"
          queries={[wfStats, wfSuccessTrend]}
          variant="stat"
          icon={TrendingUp}
          background={(_stats, trends) => (
            <Sparkline
              data={trends.map((t) => t.successRate)}
              maxValue={100}
              className="h-full w-full"
            />
          )}
        >
          {(stats) => (
            <>
              <span
                className={
                  stats.successRate >= 80
                    ? "text-green-600"
                    : stats.successRate >= 50
                      ? "text-yellow-600"
                      : "text-red-600"
                }
              >
                {stats.successRate}%
              </span>{" "}
              <DeltaIndicator
                current={stats.successRate}
                previous={stats.prevSuccessRate}
              />
            </>
          )}
        </Panel>

        <Panel
          title="Avg Duration"
          queries={[wfStats, wfDurationTrend]}
          variant="stat"
          icon={Clock}
          background={(_stats, trends) => (
            <Sparkline
              data={trends.map((t) => t.avgDuration)}
              className="h-full w-full"
            />
          )}
        >
          {(stats) => (
            <>
              {formatDuration(stats.avgDuration, "ms")}{" "}
              <DeltaIndicator
                current={stats.avgDuration}
                previous={stats.prevAvgDuration}
                invertColors
              />
            </>
          )}
        </Panel>

        <Panel
          title="Est. Cost"
          queries={[wfCost]}
          variant="stat"
          icon={DollarSign}
          background={(cost) =>
            cost.overTime.length > 0 ? (
              <Sparkline data={cost.overTime} className="h-full w-full" />
            ) : null
          }
        >
          {(cost) => (
            <>
              {formatCost(cost.totalCost)}{" "}
              <DeltaIndicator
                current={cost.totalCost}
                previous={cost.prevTotalCost}
                invertColors
              />
              <p className="text-muted-foreground text-xs font-normal">
                {Math.round(cost.totalMinutes)} min
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* Trend charts */}
      <div className="grid gap-3 md:grid-cols-2">
        <Panel
          title="Success Rate Trend"
          queries={[wfSuccessTrend]}
          skeleton={<div className="h-40" />}
        >
          {(data) =>
            data.length > 0 ? (
              <SuccessRateMiniChart data={data} />
            ) : (
              <ChartEmptyState message="No success rate data available" />
            )
          }
        </Panel>

        <Panel
          title="Duration Trend"
          queries={[wfDurationTrend]}
          skeleton={<div className="h-40" />}
        >
          {(data) =>
            data.length > 0 ? (
              <ChartContainer
                config={durationChartConfig}
                className="h-40 w-full"
              >
                <ComposedChart
                  data={data}
                  margin={{ left: -20, right: 4 }}
                >
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    tickFormatter={formatChartDate}
                    fontSize={10}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    tickFormatter={(v) => formatDuration(v, "ms")}
                    fontSize={10}
                    width={50}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={chartTooltipLabelFormatter}
                        formatter={durationTooltipFormatter}
                      />
                    }
                  />
                  <Line
                    dataKey="avgDuration"
                    type="monotone"
                    stroke="var(--color-avgDuration)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="p95Duration"
                    type="monotone"
                    stroke="var(--color-p95Duration)"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            ) : (
              <ChartEmptyState message="No duration data available" />
            )
          }
        </Panel>
      </div>

      {/* Detail panels */}
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Top Failing Jobs" queries={[wfFailingJobs]}>
          {(jobs) =>
            jobs.length > 0 ? (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div
                    key={job.jobName}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col min-w-0 flex-1 mr-2">
                      <span className="text-sm font-medium truncate">
                        {job.jobName}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {job.totalRuns} runs
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={getSuccessRateVariant(job.successRate)}>
                        {job.successRate}%
                      </Badge>
                      <Badge variant="destructive">{job.failureCount}x</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No failing jobs found
              </p>
            )
          }
        </Panel>

        <Panel title="Failure Reasons" queries={[wfFailureReasons]}>
          {(reasons) =>
            reasons.length > 0 ? (
              <div className="space-y-3">
                {reasons.map((reason) => (
                  <div
                    key={reason.pattern}
                    className="flex items-center justify-between"
                  >
                    <div className="flex flex-col min-w-0 flex-1 mr-2">
                      <span className="text-sm font-medium truncate">
                        {reason.pattern}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatRelativeTime(reason.lastOccurrence)}
                      </span>
                    </div>
                    <Badge variant="secondary">{reason.count}x</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No failure reasons found
              </p>
            )
          }
        </Panel>
      </div>

      {/* Recent Runs */}
      <Panel
        title="Recent Runs"
        queries={[wfRecentRuns]}
        action={
          <Link
            to="/runs"
            search={{
              page: 1,
              workflowName,
              repo,
              branch: undefined,
              conclusion: undefined,
              runId: undefined,
            }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            View all
          </Link>
        }
      >
        {(runs) => <RunsTable data={runs} />}
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: Update imports**

Remove `Card*`, `Skeleton`, `useQuery`, `useTimeRange`. Add `Panel` and `TimeRangeInput`.

```tsx
import { Badge } from "@everr/ui/components/badge";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import {
  ChartEmptyState,
  chartTooltipLabelFormatter,
  createChartTooltipFormatter,
  formatChartDate,
} from "@everr/ui/components/chart-helpers";
import { Sparkline } from "@everr/ui/components/sparkline";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import { ComposedChart, Line, XAxis, YAxis } from "recharts";
import { SuccessRateMiniChart } from "@/components/dashboard/success-rate-mini-chart";
import { Panel } from "@/components/panel";
import { RunsTable } from "@/components/runs-list";
import type { TimeRangeInput } from "@/data/analytics/schemas";
import {
  workflowCostOptions,
  workflowDurationTrendOptions,
  workflowFailureReasonsOptions,
  workflowRecentRunsOptions,
  workflowStatsOptions,
  workflowSuccessRateTrendOptions,
  workflowTopFailingJobsOptions,
} from "@/data/workflows/options";
import {
  formatDuration,
  formatRelativeTime,
  getSuccessRateVariant,
} from "@/lib/formatting";
import { formatCost } from "@/lib/runner-pricing";
import { TimeRangeSearchSchema } from "@/lib/time-range";
```

- [ ] **Step 3: Remove WorkflowDetailSkeleton**

Delete the `WorkflowDetailSkeleton` function and remove `pendingComponent: WorkflowDetailSkeleton` from the Route config.

- [ ] **Step 4: Verify the page works**

Run: `pnpm --filter app dev` and navigate to a workflow detail page. Verify:
- 4 stat cards with sparkline backgrounds and delta indicators
- 2 trend chart panels
- 2 detail list panels (failing jobs, failure reasons)
- Recent runs panel with "View all" action link
- All loading states handled by Panel skeletons

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/workflows/\$repo/\$workflowName.tsx
git commit -m "refactor: migrate workflow detail page to Panel component"
```

---

## Shape Up: Future Work (Option B)

### Appetite: 2 weeks (small batch)

### Problem
The Runs List and Workflows List pages use tables with pagination, filters, and search. These don't fit the current Panel pattern which is designed for time-range-scoped analytics queries without pagination state.

### Solution sketch
Extend Panel (or create a sibling `TablePanel`) to support:
- Pagination state (`page`, `pageSize`) managed externally
- Filter/search params passed alongside `timeRange`
- A table-optimized loading skeleton
- Optional integration with URL search params for pagination

### Pages in scope
- **Runs List** (`runs/index.tsx`) — `RunsFilterBar` + `RunsTable` + pagination
- **Workflows List** (`workflows/index.tsx`) — filter controls + `WorkflowsTable` + pagination

### Rabbit holes
- Don't try to make Panel handle pagination generically — the two pages have different filter shapes
- Don't absorb filter bar UI into Panel — keep filters external, only wrap the data display

### No-gos
- Don't migrate Run Detail, Job Detail, or Step Detail — these are trace-viewer UIs with fundamentally different data patterns (single entity, nested navigation, streaming logs)
- Don't migrate Account Settings or Users Management — third-party widget pages
