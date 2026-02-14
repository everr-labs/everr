# Workflows Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Workflows list page and detail page that aggregate CI/CD data per workflow with sparkline backgrounds, period-over-period deltas, trend charts, and drill-down to individual workflow details.

**Architecture:** Two TanStack Router file-based routes (`/dashboard/workflows/` and `/dashboard/workflows/$workflowName`) backed by ClickHouse queries in a single data file. The list page uses a custom table with inline sparkline backgrounds and period-over-period comparison. The detail page uses the existing `Panel` component for KPI cards and charts, plus `RunsTable` for recent runs.

**Tech Stack:** React, TanStack Router, TanStack Query, TanStack Start (createServerFn), ClickHouse SQL, Recharts (Sparkline), Tailwind CSS, Zod

---

### Task 1: Add navigation entry

**Files:**
- Modify: `packages/app/src/lib/navigation.ts:26-39`

**Step 1: Add "Workflows" to CI/CD nav group**

In `packages/app/src/lib/navigation.ts`, add a new entry after "Runs" and before "Failures" in the CI/CD items array:

```typescript
{
  title: "Workflows",
  url: "/dashboard/workflows",
},
```

The full CI/CD items array should be:
```typescript
items: [
  { title: "Overview", url: "/dashboard" },
  { title: "Runs", url: "/dashboard/runs" },
  { title: "Workflows", url: "/dashboard/workflows" },
  { title: "Failures", url: "/dashboard/failures" },
],
```

**Step 2: Verify**

Run: `pnpm check`
Expected: PASS (no lint/format errors)

**Step 3: Commit**

```bash
git add packages/app/src/lib/navigation.ts
git commit -m "feat(workflows): add workflows to sidebar navigation"
```

---

### Task 2: Create workflows data layer — list queries

**Files:**
- Create: `packages/app/src/data/workflows.ts`

**Step 1: Create the data file with list + sparkline queries**

Create `packages/app/src/data/workflows.ts` with the following server functions and query option factories. This file handles all data fetching for both the list and detail pages.

Start with the list page queries:

```typescript
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { type TimeRangeInput, TimeRangeInputSchema } from "./analytics";

// --- List page types ---

export interface WorkflowListItem {
  workflowName: string;
  repo: string;
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  lastRunAt: string;
  prevTotalRuns: number;
  prevSuccessRate: number;
  prevAvgDuration: number;
}

export interface WorkflowsListResult {
  workflows: WorkflowListItem[];
  totalCount: number;
}

export interface WorkflowSparklineData {
  workflowName: string;
  repo: string;
  buckets: {
    date: string;
    totalRuns: number;
    successRate: number;
    avgDuration: number;
  }[];
}

// --- List page input schema ---

const WorkflowsListInputSchema = z.object({
  timeRange: TimeRangeSchema,
  page: z.number(),
  repo: z.string().optional(),
  search: z.string().optional(),
});
export type WorkflowsListInput = z.infer<typeof WorkflowsListInputSchema>;
```

**Step 2: Implement `getWorkflowsList` server function**

This query spans both current and prior periods using conditional aggregation. The prior period has the same width as the current period, shifted back.

```typescript
export const getWorkflowsList = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowsListInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(data.timeRange);
    const pageSize = 20;
    const offset = (data.page - 1) * pageSize;

    // Calculate prior period (same width, shifted back)
    const rangeMs = toDate.getTime() - fromDate.getTime();
    const priorFromDate = new Date(fromDate.getTime() - rangeMs);
    const priorFromISO = priorFromDate.toISOString().replace("T", " ").replace("Z", "");

    const conditions: string[] = [
      "Timestamp >= {priorFromTime:String} AND Timestamp <= {toTime:String}",
      "ResourceAttributes['cicd.pipeline.name'] != ''",
      "ResourceAttributes['cicd.pipeline.run.id'] != ''",
      "ResourceAttributes['cicd.pipeline.task.run.result'] != ''",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
      priorFromTime: priorFromISO,
      pageSize,
      offset,
    };

    if (data.repo) {
      conditions.push("ResourceAttributes['vcs.repository.name'] = {repo:String}");
      params.repo = data.repo;
    }
    if (data.search) {
      conditions.push("ResourceAttributes['cicd.pipeline.name'] ILIKE {search:String}");
      params.search = `%${data.search}%`;
    }

    const whereClause = conditions.join("\n\t\t\t\tAND ");

    const dataSql = `
      SELECT
        workflowName,
        repo,
        countIf(timestamp >= {fromTime:String}) as totalRuns,
        round(countIf(timestamp >= {fromTime:String} AND conclusion = 'success') * 100.0
          / nullIf(countIf(timestamp >= {fromTime:String}), 0), 1) as successRate,
        avgIf(duration, timestamp >= {fromTime:String}) as avgDuration,
        maxIf(timestamp, timestamp >= {fromTime:String}) as lastRunAt,
        countIf(timestamp < {fromTime:String}) as prevTotalRuns,
        round(countIf(timestamp < {fromTime:String} AND conclusion = 'success') * 100.0
          / nullIf(countIf(timestamp < {fromTime:String}), 0), 1) as prevSuccessRate,
        avgIf(duration, timestamp < {fromTime:String}) as prevAvgDuration
      FROM (
        SELECT
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
          anyLast(ResourceAttributes['vcs.repository.name']) as repo,
          anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
          max(Timestamp) as timestamp,
          max(Duration) / 1000000 as duration
        FROM otel_traces
        WHERE ${whereClause}
        GROUP BY run_id
      )
      GROUP BY workflowName, repo
      HAVING countIf(timestamp >= {fromTime:String}) > 0
      ORDER BY totalRuns DESC
      LIMIT {pageSize:UInt32} OFFSET {offset:UInt32}
    `;

    const countSql = `
      SELECT count(*) as total
      FROM (
        SELECT
          ResourceAttributes['cicd.pipeline.name'] as workflowName,
          ResourceAttributes['vcs.repository.name'] as repo
        FROM otel_traces
        WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
          AND ResourceAttributes['cicd.pipeline.name'] != ''
          AND ResourceAttributes['cicd.pipeline.run.id'] != ''
          AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
          ${data.repo ? "AND ResourceAttributes['vcs.repository.name'] = {repo:String}" : ""}
          ${data.search ? "AND ResourceAttributes['cicd.pipeline.name'] ILIKE {search:String}" : ""}
        GROUP BY workflowName, repo
      )
    `;

    const [dataResult, countResult] = await Promise.all([
      query<{
        workflowName: string;
        repo: string;
        totalRuns: string;
        successRate: string;
        avgDuration: string;
        lastRunAt: string;
        prevTotalRuns: string;
        prevSuccessRate: string;
        prevAvgDuration: string;
      }>(dataSql, params),
      query<{ total: string }>(countSql, params),
    ]);

    return {
      workflows: dataResult.map((row) => ({
        workflowName: row.workflowName,
        repo: row.repo,
        totalRuns: Number(row.totalRuns),
        successRate: Number(row.successRate) || 0,
        avgDuration: Number(row.avgDuration),
        lastRunAt: row.lastRunAt,
        prevTotalRuns: Number(row.prevTotalRuns),
        prevSuccessRate: Number(row.prevSuccessRate) || 0,
        prevAvgDuration: Number(row.prevAvgDuration),
      })),
      totalCount: countResult.length > 0 ? Number(countResult[0].total) : 0,
    } satisfies WorkflowsListResult;
  });
```

**Step 3: Implement `getWorkflowsSparklines` server function**

Returns time-bucketed data for each workflow in the current page, used for sparkline backgrounds.

```typescript
const WorkflowsSparklineInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflows: z.array(z.object({ workflowName: z.string(), repo: z.string() })),
});

export const getWorkflowsSparklines = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowsSparklineInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    if (data.workflows.length === 0) return [] as WorkflowSparklineData[];

    const workflowPairs = data.workflows
      .map((w) => `(${escapeClickHouseString(w.workflowName)}, ${escapeClickHouseString(w.repo)})`)
      .join(", ");

    const sql = `
      SELECT
        workflowName,
        repo,
        date,
        count(*) as totalRuns,
        round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate,
        avg(duration) as avgDuration
      FROM (
        SELECT
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
          anyLast(ResourceAttributes['vcs.repository.name']) as repo,
          anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
          toDate(max(Timestamp)) as date,
          max(Duration) / 1000000 as duration
        FROM otel_traces
        WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
          AND ResourceAttributes['cicd.pipeline.name'] != ''
          AND ResourceAttributes['cicd.pipeline.run.id'] != ''
          AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
        GROUP BY run_id
      )
      WHERE (workflowName, repo) IN (${workflowPairs})
      GROUP BY workflowName, repo, date
      ORDER BY workflowName, repo, date ASC
    `;

    const result = await query<{
      workflowName: string;
      repo: string;
      date: string;
      totalRuns: string;
      successRate: string;
      avgDuration: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    // Group by workflow+repo
    const grouped = new Map<string, WorkflowSparklineData>();
    for (const row of result) {
      const key = `${row.workflowName}:${row.repo}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          workflowName: row.workflowName,
          repo: row.repo,
          buckets: [],
        });
      }
      grouped.get(key)!.buckets.push({
        date: row.date,
        totalRuns: Number(row.totalRuns),
        successRate: Number(row.successRate) || 0,
        avgDuration: Number(row.avgDuration),
      });
    }

    return Array.from(grouped.values()) satisfies WorkflowSparklineData[];
  });

function escapeClickHouseString(str: string): string {
  return `'${str.replace(/'/g, "\\'")}'`;
}
```

**Step 4: Add query option factories for list queries**

```typescript
export const workflowsListOptions = (input: WorkflowsListInput) =>
  queryOptions({
    queryKey: ["workflows", "list", input],
    queryFn: () => getWorkflowsList({ data: input }),
  });

export const workflowsSparklineOptions = (input: {
  timeRange: { from: string; to: string };
  workflows: { workflowName: string; repo: string }[];
}) =>
  queryOptions({
    queryKey: ["workflows", "sparklines", input],
    queryFn: () => getWorkflowsSparklines({ data: input }),
    enabled: input.workflows.length > 0,
  });
```

**Step 5: Verify**

Run: `pnpm check`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/app/src/data/workflows.ts
git commit -m "feat(workflows): add list and sparkline data queries"
```

---

### Task 3: Create workflows data layer — detail page queries

**Files:**
- Modify: `packages/app/src/data/workflows.ts`

**Step 1: Add detail page input schema and types**

Append to `packages/app/src/data/workflows.ts`:

```typescript
// --- Detail page types ---

export interface WorkflowStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  p95Duration: number;
  prevTotalRuns: number;
  prevSuccessRate: number;
  prevAvgDuration: number;
}

export interface WorkflowTrendPoint {
  date: string;
  totalRuns: number;
  successRate: number;
  successCount: number;
  failureCount: number;
}

export interface WorkflowDurationTrendPoint {
  date: string;
  avgDuration: number;
  p95Duration: number;
}

export interface WorkflowFailingJob {
  jobName: string;
  failureCount: number;
  totalRuns: number;
  successRate: number;
}

export interface WorkflowFailureReason {
  pattern: string;
  count: number;
  lastOccurrence: string;
}

const WorkflowDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflowName: z.string(),
});
type WorkflowDetailInput = z.infer<typeof WorkflowDetailInputSchema>;
```

**Step 2: Implement `getWorkflowStats`**

```typescript
export const getWorkflowStats = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(data.timeRange);
    const rangeMs = toDate.getTime() - fromDate.getTime();
    const priorFromDate = new Date(fromDate.getTime() - rangeMs);
    const priorFromISO = priorFromDate.toISOString().replace("T", " ").replace("Z", "");

    const sql = `
      SELECT
        countIf(timestamp >= {fromTime:String}) as totalRuns,
        round(countIf(timestamp >= {fromTime:String} AND conclusion = 'success') * 100.0
          / nullIf(countIf(timestamp >= {fromTime:String}), 0), 1) as successRate,
        avgIf(duration, timestamp >= {fromTime:String}) as avgDuration,
        quantileIf(0.95)(duration, timestamp >= {fromTime:String}) as p95Duration,
        countIf(timestamp < {fromTime:String}) as prevTotalRuns,
        round(countIf(timestamp < {fromTime:String} AND conclusion = 'success') * 100.0
          / nullIf(countIf(timestamp < {fromTime:String}), 0), 1) as prevSuccessRate,
        avgIf(duration, timestamp < {fromTime:String}) as prevAvgDuration
      FROM (
        SELECT
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
          max(Timestamp) as timestamp,
          max(Duration) / 1000000 as duration
        FROM otel_traces
        WHERE Timestamp >= {priorFromTime:String} AND Timestamp <= {toTime:String}
          AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
          AND ResourceAttributes['cicd.pipeline.run.id'] != ''
          AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
        GROUP BY run_id
      )
    `;

    const result = await query<{
      totalRuns: string;
      successRate: string;
      avgDuration: string;
      p95Duration: string;
      prevTotalRuns: string;
      prevSuccessRate: string;
      prevAvgDuration: string;
    }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      priorFromTime: priorFromISO,
      workflowName: data.workflowName,
    });

    if (result.length === 0) {
      return {
        totalRuns: 0, successRate: 0, avgDuration: 0, p95Duration: 0,
        prevTotalRuns: 0, prevSuccessRate: 0, prevAvgDuration: 0,
      } satisfies WorkflowStats;
    }

    const row = result[0];
    return {
      totalRuns: Number(row.totalRuns),
      successRate: Number(row.successRate) || 0,
      avgDuration: Number(row.avgDuration),
      p95Duration: Number(row.p95Duration),
      prevTotalRuns: Number(row.prevTotalRuns),
      prevSuccessRate: Number(row.prevSuccessRate) || 0,
      prevAvgDuration: Number(row.prevAvgDuration),
    } satisfies WorkflowStats;
  });
```

**Step 3: Implement `getWorkflowSuccessRateTrend`**

```typescript
export const getWorkflowSuccessRateTrend = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
      SELECT
        date,
        count(*) as totalRuns,
        round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate,
        countIf(conclusion = 'success') as successCount,
        countIf(conclusion = 'failure') as failureCount
      FROM (
        SELECT
          toDate(max(Timestamp)) as date,
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion
        FROM otel_traces
        WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
          AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
          AND ResourceAttributes['cicd.pipeline.run.id'] != ''
          AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
        GROUP BY run_id
      )
      GROUP BY date
      ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
    `;

    const result = await query<{
      date: string;
      totalRuns: string;
      successRate: string;
      successCount: string;
      failureCount: string;
    }>(sql, { fromTime: fromISO, toTime: toISO, workflowName: data.workflowName });

    return result.map((row) => ({
      date: row.date,
      totalRuns: Number(row.totalRuns),
      successRate: Number(row.successRate) || 0,
      successCount: Number(row.successCount),
      failureCount: Number(row.failureCount),
    })) satisfies WorkflowTrendPoint[];
  });
```

**Step 4: Implement `getWorkflowDurationTrend`**

```typescript
export const getWorkflowDurationTrend = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
      SELECT
        toDate(Timestamp) as date,
        avg(Duration) / 1000000 as avgDuration,
        quantile(0.95)(Duration) / 1000000 as p95Duration
      FROM otel_traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
        AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
        AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
        AND SpanAttributes['citric.test.name'] = ''
      GROUP BY date
      ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
    `;

    const result = await query<{
      date: string;
      avgDuration: string;
      p95Duration: string;
    }>(sql, { fromTime: fromISO, toTime: toISO, workflowName: data.workflowName });

    return result.map((row) => ({
      date: row.date,
      avgDuration: Number(row.avgDuration),
      p95Duration: Number(row.p95Duration),
    })) satisfies WorkflowDurationTrendPoint[];
  });
```

**Step 5: Implement `getWorkflowTopFailingJobs`**

```typescript
export const getWorkflowTopFailingJobs = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
      SELECT
        ResourceAttributes['cicd.pipeline.task.name'] as jobName,
        countIf(ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure') as failureCount,
        count(*) as totalRuns,
        round(countIf(ResourceAttributes['cicd.pipeline.task.run.result'] = 'success') * 100.0
          / nullIf(count(*), 0), 1) as successRate
      FROM otel_traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
        AND ResourceAttributes['cicd.pipeline.task.name'] != ''
        AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
        AND SpanAttributes['citric.test.name'] = ''
      GROUP BY jobName
      HAVING failureCount > 0
      ORDER BY failureCount DESC
      LIMIT 10
    `;

    const result = await query<{
      jobName: string;
      failureCount: string;
      totalRuns: string;
      successRate: string;
    }>(sql, { fromTime: fromISO, toTime: toISO, workflowName: data.workflowName });

    return result.map((row) => ({
      jobName: row.jobName,
      failureCount: Number(row.failureCount),
      totalRuns: Number(row.totalRuns),
      successRate: Number(row.successRate) || 0,
    })) satisfies WorkflowFailingJob[];
  });
```

**Step 6: Implement `getWorkflowFailureReasons`**

```typescript
export const getWorkflowFailureReasons = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
      SELECT
        lower(trim(substring(StatusMessage, 1, 200))) as pattern,
        count(*) as count,
        max(Timestamp) as lastOccurrence
      FROM otel_traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
        AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
        AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
        AND StatusMessage != ''
      GROUP BY pattern
      ORDER BY count DESC
      LIMIT 10
    `;

    const result = await query<{
      pattern: string;
      count: string;
      lastOccurrence: string;
    }>(sql, { fromTime: fromISO, toTime: toISO, workflowName: data.workflowName });

    return result.map((row) => ({
      pattern: row.pattern,
      count: Number(row.count),
      lastOccurrence: row.lastOccurrence,
    })) satisfies WorkflowFailureReason[];
  });
```

**Step 7: Implement `getWorkflowRecentRuns`**

Reuses the `RunListItem` type from `runs-list.ts` for compatibility with `RunsTable`.

```typescript
import type { RunListItem } from "./runs-list";

export const getWorkflowRecentRuns = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
      SELECT
        TraceId as trace_id,
        anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
        anyLast(toUInt32OrZero(ResourceAttributes['citric.github.workflow_job.run_attempt'])) as run_attempt,
        anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
        anyLast(ResourceAttributes['vcs.repository.name']) as repo,
        anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
        max(ResourceAttributes['cicd.pipeline.result']) as conclusion,
        max(Duration) / 1000000 as duration,
        max(Timestamp) as timestamp,
        max(ResourceAttributes['cicd.pipeline.task.run.sender.login']) as sender,
        count(*) as jobCount
      FROM otel_traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
        AND ResourceAttributes['cicd.pipeline.run.id'] != ''
        AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
      GROUP BY trace_id
      ORDER BY timestamp DESC
      LIMIT 10
    `;

    const result = await query<{
      trace_id: string;
      run_id: string;
      run_attempt: string;
      workflowName: string;
      repo: string;
      branch: string;
      conclusion: string;
      duration: string;
      timestamp: string;
      sender: string;
      jobCount: string;
    }>(sql, { fromTime: fromISO, toTime: toISO, workflowName: data.workflowName });

    return result.map((row) => ({
      traceId: row.trace_id,
      runId: row.run_id,
      runAttempt: Number(row.run_attempt),
      workflowName: row.workflowName || "Workflow",
      repo: row.repo,
      branch: row.branch,
      conclusion: row.conclusion,
      duration: Number(row.duration),
      timestamp: row.timestamp,
      sender: row.sender,
      jobCount: Number(row.jobCount),
    })) satisfies RunListItem[];
  });
```

**Step 8: Add detail page query option factories**

```typescript
export const workflowStatsOptions = (input: { timeRange: { from: string; to: string }; workflowName: string }) =>
  queryOptions({
    queryKey: ["workflows", "stats", input],
    queryFn: () => getWorkflowStats({ data: input }),
  });

export const workflowSuccessRateTrendOptions = (input: { timeRange: { from: string; to: string }; workflowName: string }) =>
  queryOptions({
    queryKey: ["workflows", "successRateTrend", input],
    queryFn: () => getWorkflowSuccessRateTrend({ data: input }),
    staleTime: 60_000,
  });

export const workflowDurationTrendOptions = (input: { timeRange: { from: string; to: string }; workflowName: string }) =>
  queryOptions({
    queryKey: ["workflows", "durationTrend", input],
    queryFn: () => getWorkflowDurationTrend({ data: input }),
    staleTime: 60_000,
  });

export const workflowTopFailingJobsOptions = (input: { timeRange: { from: string; to: string }; workflowName: string }) =>
  queryOptions({
    queryKey: ["workflows", "topFailingJobs", input],
    queryFn: () => getWorkflowTopFailingJobs({ data: input }),
    staleTime: 60_000,
  });

export const workflowFailureReasonsOptions = (input: { timeRange: { from: string; to: string }; workflowName: string }) =>
  queryOptions({
    queryKey: ["workflows", "failureReasons", input],
    queryFn: () => getWorkflowFailureReasons({ data: input }),
    staleTime: 60_000,
  });

export const workflowRecentRunsOptions = (input: { timeRange: { from: string; to: string }; workflowName: string }) =>
  queryOptions({
    queryKey: ["workflows", "recentRuns", input],
    queryFn: () => getWorkflowRecentRuns({ data: input }),
  });
```

**Step 9: Verify**

Run: `pnpm check`
Expected: PASS

**Step 10: Commit**

```bash
git add packages/app/src/data/workflows.ts
git commit -m "feat(workflows): add detail page data queries"
```

---

### Task 4: Create workflows filter bar component

**Files:**
- Create: `packages/app/src/components/workflows/workflows-filter-bar.tsx`

**Step 1: Create the filter bar**

This is simpler than RunsFilterBar — just a repo dropdown and a text search input.

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WorkflowsFilterBarProps {
  repos: string[];
  repo?: string;
  search?: string;
  onRepoChange: (value: string | undefined) => void;
  onSearchChange: (value: string) => void;
}

export function WorkflowsFilterBar({
  repos,
  repo,
  search,
  onRepoChange,
  onSearchChange,
}: WorkflowsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={repo || "__all__"}
        onValueChange={(v) =>
          onRepoChange(v === "__all__" || v == null ? undefined : v)
        }
      >
        <SelectTrigger className="w-45">
          <SelectValue placeholder="All repos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All repos</SelectItem>
          {repos.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <input
        type="text"
        placeholder="Search workflows..."
        value={search || ""}
        onChange={(e) => onSearchChange(e.target.value)}
        className="border-input bg-background placeholder:text-muted-foreground h-9 rounded-md border px-3 text-sm"
      />
    </div>
  );
}
```

**Step 2: Verify**

Run: `pnpm check`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/app/src/components/workflows/workflows-filter-bar.tsx
git commit -m "feat(workflows): add filter bar component"
```

---

### Task 5: Create workflows table component

**Files:**
- Create: `packages/app/src/components/workflows/workflows-table.tsx`

**Step 1: Create the table with sparkline backgrounds and deltas**

Each metric cell (Runs, Success Rate, Avg Duration) has:
- The value displayed as text
- A period-over-period delta indicator (`+12%` / `-5%`)
- A sparkline rendered at low opacity behind the cell content

Reference the dashboard stat card pattern: sparklines use `Sparkline` component at low opacity in an absolute-positioned container.

```typescript
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Sparkline } from "@/components/ui/sparkline";
import type { WorkflowListItem, WorkflowSparklineData } from "@/data/workflows";
import {
  formatDuration,
  formatRelativeTime,
  getSuccessRateVariant,
} from "@/lib/formatting";

interface WorkflowsTableProps {
  data: WorkflowListItem[];
  sparklines: WorkflowSparklineData[];
}

function DeltaIndicator({
  current,
  previous,
  format = "percent",
}: {
  current: number;
  previous: number;
  format?: "percent" | "absolute" | "duration";
}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <span className="text-green-600 text-xs">new</span>;

  const delta = format === "absolute"
    ? current - previous
    : ((current - previous) / previous) * 100;

  if (Math.abs(delta) < 0.5) return null;

  const isPositive = delta > 0;
  // For duration, positive = bad (slower). For runs and success rate, positive = good.
  const isGood = format === "duration" ? !isPositive : isPositive;

  const formatted = format === "duration"
    ? `${isPositive ? "+" : ""}${Math.round(delta)}%`
    : `${isPositive ? "+" : ""}${Math.round(delta)}%`;

  return (
    <span className={`text-xs ${isGood ? "text-green-600" : "text-red-600"}`}>
      {formatted}
    </span>
  );
}

function SparklineCell({
  children,
  sparkData,
  maxValue,
}: {
  children: React.ReactNode;
  sparkData: number[];
  maxValue?: number;
}) {
  return (
    <div className="relative">
      {sparkData.length > 0 && (
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <Sparkline data={sparkData} className="h-full w-full" maxValue={maxValue} />
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

export function WorkflowsTable({ data, sparklines }: WorkflowsTableProps) {
  if (data.length === 0) {
    return (
      <Empty>
        <EmptyDescription>No workflows found</EmptyDescription>
      </Empty>
    );
  }

  const sparklineMap = new Map(
    sparklines.map((s) => [`${s.workflowName}:${s.repo}`, s]),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Workflow</th>
            <th className="pb-2 pr-4 font-medium">Repository</th>
            <th className="pb-2 pr-4 font-medium">Runs</th>
            <th className="pb-2 pr-4 font-medium">Success Rate</th>
            <th className="pb-2 pr-4 font-medium">Avg Duration</th>
            <th className="pb-2 font-medium">Last Run</th>
          </tr>
        </thead>
        <tbody>
          {data.map((wf) => {
            const spark = sparklineMap.get(`${wf.workflowName}:${wf.repo}`);
            return (
              <tr
                key={`${wf.workflowName}:${wf.repo}`}
                className="border-b last:border-0 hover:bg-muted/50"
              >
                <td className="py-2 pr-4">
                  <Link
                    to="/dashboard/workflows/$workflowName"
                    params={{ workflowName: wf.workflowName }}
                    className="font-medium hover:underline"
                  >
                    {wf.workflowName}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {wf.repo}
                </td>
                <td className="py-2 pr-4">
                  <SparklineCell
                    sparkData={spark?.buckets.map((b) => b.totalRuns) ?? []}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="tabular-nums">{wf.totalRuns}</span>
                      <DeltaIndicator
                        current={wf.totalRuns}
                        previous={wf.prevTotalRuns}
                        format="absolute"
                      />
                    </div>
                  </SparklineCell>
                </td>
                <td className="py-2 pr-4">
                  <SparklineCell
                    sparkData={spark?.buckets.map((b) => b.successRate) ?? []}
                    maxValue={100}
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge variant={getSuccessRateVariant(wf.successRate)}>
                        {wf.successRate}%
                      </Badge>
                      <DeltaIndicator
                        current={wf.successRate}
                        previous={wf.prevSuccessRate}
                        format="absolute"
                      />
                    </div>
                  </SparklineCell>
                </td>
                <td className="py-2 pr-4">
                  <SparklineCell
                    sparkData={spark?.buckets.map((b) => b.avgDuration) ?? []}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs tabular-nums">
                        {formatDuration(wf.avgDuration, "ms")}
                      </span>
                      <DeltaIndicator
                        current={wf.avgDuration}
                        previous={wf.prevAvgDuration}
                        format="duration"
                      />
                    </div>
                  </SparklineCell>
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {wf.lastRunAt ? formatRelativeTime(wf.lastRunAt) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 2: Verify**

Run: `pnpm check`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/app/src/components/workflows/workflows-table.tsx
git commit -m "feat(workflows): add table component with sparklines and deltas"
```

---

### Task 6: Create workflows list page route

**Files:**
- Create: `packages/app/src/routes/dashboard/workflows/index.tsx`

**Step 1: Create the route file**

Follow the exact same pattern as `packages/app/src/routes/dashboard/runs/index.tsx`: `createFileRoute` with `validateSearch`, `loaderDeps`, `loader`, `pendingComponent`.

```typescript
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WorkflowsFilterBar } from "@/components/workflows/workflows-filter-bar";
import { WorkflowsTable } from "@/components/workflows/workflows-table";
import { Pagination } from "@/components/runs-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { runFilterOptionsOptions } from "@/data/runs-list";
import { workflowsListOptions, workflowsSparklineOptions } from "@/data/workflows";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const Route = createFileRoute("/dashboard/workflows/")({
  staticData: { breadcrumb: "Workflows" },
  component: WorkflowsListPage,
  validateSearch: TimeRangeSearchSchema.extend({
    page: z.coerce.number().default(1),
    repo: z.string().optional(),
    search: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
    page: search.page,
    repo: search.repo,
    search: search.search,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const listInput = {
      timeRange: deps.timeRange,
      page: deps.page,
      repo: deps.repo,
      search: deps.search,
    };
    await Promise.all([
      queryClient.prefetchQuery(workflowsListOptions(listInput)),
      queryClient.prefetchQuery(runFilterOptionsOptions()),
    ]);
  },
  pendingComponent: WorkflowsListSkeleton,
});

function WorkflowsListPage() {
  const { from, to, page, repo, search } = Route.useSearch();
  const timeRange = { from, to };
  const listInput = { timeRange, page, repo, search };

  const { data: listResult } = useQuery(workflowsListOptions(listInput));
  const { data: filterOptions } = useQuery(runFilterOptionsOptions());
  const { data: sparklines } = useQuery(
    workflowsSparklineOptions({
      timeRange,
      workflows: listResult?.workflows.map((w) => ({
        workflowName: w.workflowName,
        repo: w.repo,
      })) ?? [],
    }),
  );

  const navigate = Route.useNavigate();

  if (!listResult) return null;

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates, page: 1 }) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
        <p className="text-muted-foreground">
          Aggregated view of your CI/CD workflows
        </p>
      </div>

      <WorkflowsFilterBar
        repos={filterOptions?.repos ?? []}
        repo={repo}
        search={search}
        onRepoChange={(v) => updateFilter({ repo: v })}
        onSearchChange={(v) => updateFilter({ search: v || undefined })}
      />

      <Card>
        <CardHeader>
          <CardTitle>All Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowsTable
            data={listResult.workflows}
            sparklines={sparklines ?? []}
          />
        </CardContent>
      </Card>

      <Pagination
        page={page}
        totalCount={listResult.totalCount}
        pageSize={20}
        onPageChange={(p) =>
          navigate({ search: (prev) => ({ ...prev, page: p }) })
        }
      />
    </div>
  );
}

function WorkflowsListSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-[180px]" />
        <Skeleton className="h-9 w-[200px]" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Verify the page loads**

Check the dev server (already running) — navigate to `http://localhost:3000/dashboard/workflows` in a browser and confirm the page renders.

Run: `pnpm check`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/app/src/routes/dashboard/workflows/index.tsx
git commit -m "feat(workflows): add workflows list page route"
```

---

### Task 7: Create workflow detail page route

**Files:**
- Create: `packages/app/src/routes/dashboard/workflows/$workflowName.tsx`

**Step 1: Create the detail route**

This page follows the dashboard overview pattern with `Panel` components. It has 4 KPI stat cards, 2 trend charts, 2 detail panels, and a recent runs section.

```typescript
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import { Line, XAxis, YAxis, ComposedChart, Bar } from "recharts";
import { SuccessRateMiniChart } from "@/components/dashboard/success-rate-mini-chart";
import { RunsTable } from "@/components/runs-list";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  ChartEmptyState,
  chartTooltipLabelFormatter,
  createChartTooltipFormatter,
  formatChartDate,
} from "@/components/ui/chart-helpers";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import {
  workflowDurationTrendOptions,
  workflowFailureReasonsOptions,
  workflowRecentRunsOptions,
  workflowStatsOptions,
  workflowSuccessRateTrendOptions,
  workflowTopFailingJobsOptions,
} from "@/data/workflows";
import {
  formatDuration,
  formatRelativeTime,
  getSuccessRateVariant,
} from "@/lib/formatting";
import { TimeRangeSearchSchema } from "@/lib/time-range";
import { useTimeRange } from "@/hooks/use-time-range";

export const Route = createFileRoute("/dashboard/workflows/$workflowName")({
  staticData: { breadcrumb: (params: { workflowName: string }) => decodeURIComponent(params.workflowName) },
  component: WorkflowDetailPage,
  validateSearch: TimeRangeSearchSchema,
  pendingComponent: WorkflowDetailSkeleton,
});

function DeltaIndicator({
  current,
  previous,
  invertColors = false,
}: {
  current: number;
  previous: number;
  invertColors?: boolean;
}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return null;

  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.5) return null;

  const isPositive = delta > 0;
  const isGood = invertColors ? !isPositive : isPositive;

  return (
    <span className={`text-xs font-normal ${isGood ? "text-green-600" : "text-red-600"}`}>
      {isPositive ? "+" : ""}{Math.round(delta)}%
    </span>
  );
}

// Duration chart config
const durationChartConfig = {
  avgDuration: {
    label: "Avg Duration",
    color: "hsl(217, 91%, 60%)",
  },
  p95Duration: {
    label: "p95 Duration",
    color: "hsl(var(--muted))",
  },
} satisfies ChartConfig;

const durationTooltipFormatter = createChartTooltipFormatter(
  durationChartConfig,
  (v) => formatDuration(Number(v), "ms"),
);

function WorkflowDetailPage() {
  const { workflowName } = Route.useParams();
  const decodedName = decodeURIComponent(workflowName);
  const { timeRange } = useTimeRange();
  const detailInput = { timeRange, workflowName: decodedName };

  const { data: stats } = useQuery(workflowStatsOptions(detailInput));
  const { data: successTrend } = useQuery(workflowSuccessRateTrendOptions(detailInput));
  const { data: durationTrend } = useQuery(workflowDurationTrendOptions(detailInput));
  const { data: failingJobs } = useQuery(workflowTopFailingJobsOptions(detailInput));
  const { data: failureReasons } = useQuery(workflowFailureReasonsOptions(detailInput));
  const { data: recentRuns } = useQuery(workflowRecentRunsOptions(detailInput));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{decodedName}</h1>
        <p className="text-muted-foreground">Workflow performance and trends</p>
      </div>

      {/* KPI stat cards */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="relative">
            {successTrend && successTrend.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
                <Sparkline data={successTrend.map((t) => t.totalRuns)} className="h-full w-full" />
              </div>
            )}
            <CardHeader className="relative pb-2">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">{`Total Runs`}</p>
                <Activity className="text-muted-foreground size-4" />
              </div>
              <p className="text-3xl font-semibold tabular-nums">
                {stats.totalRuns.toLocaleString()}
                {" "}
                <DeltaIndicator current={stats.totalRuns} previous={stats.prevTotalRuns} />
              </p>
            </CardHeader>
          </Card>

          <Card className="relative">
            {successTrend && successTrend.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
                <Sparkline data={successTrend.map((t) => t.successRate)} maxValue={100} className="h-full w-full" />
              </div>
            )}
            <CardHeader className="relative pb-2">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Success Rate</p>
                <TrendingUp className="text-muted-foreground size-4" />
              </div>
              <p className="text-3xl font-semibold tabular-nums">
                <span className={stats.successRate >= 80 ? "text-green-600" : stats.successRate >= 50 ? "text-yellow-600" : "text-red-600"}>
                  {stats.successRate}%
                </span>
                {" "}
                <DeltaIndicator current={stats.successRate} previous={stats.prevSuccessRate} />
              </p>
            </CardHeader>
          </Card>

          <Card className="relative">
            {durationTrend && durationTrend.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-15">
                <Sparkline data={durationTrend.map((t) => t.avgDuration)} className="h-full w-full" />
              </div>
            )}
            <CardHeader className="relative pb-2">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Avg Duration</p>
                <Clock className="text-muted-foreground size-4" />
              </div>
              <p className="text-3xl font-semibold tabular-nums">
                {formatDuration(stats.avgDuration, "ms")}
                {" "}
                <DeltaIndicator current={stats.avgDuration} previous={stats.prevAvgDuration} invertColors />
              </p>
              <p className="text-muted-foreground text-xs">
                p95: {formatDuration(stats.p95Duration, "ms")}
              </p>
            </CardHeader>
          </Card>

          <Card className="relative">
            <CardHeader className="relative pb-2">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">Est. Cost</p>
                <DollarSign className="text-muted-foreground size-4" />
              </div>
              <p className="text-3xl font-semibold tabular-nums text-muted-foreground">
                —
              </p>
              <p className="text-muted-foreground text-xs">
                coming soon
              </p>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Trend charts */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Success Rate Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {successTrend ? (
              successTrend.length > 0 ? (
                <SuccessRateMiniChart data={successTrend} />
              ) : (
                <ChartEmptyState message="No data available" />
              )
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Duration Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {durationTrend ? (
              durationTrend.length > 0 ? (
                <ChartContainer config={durationChartConfig} className="h-40 w-full">
                  <ComposedChart data={durationTrend} margin={{ left: -20, right: 4 }}>
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
                      tickFormatter={(v) => formatDuration(Number(v), "ms")}
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
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail panels */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Failing Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {failingJobs ? (
              failingJobs.length === 0 ? (
                <p className="text-muted-foreground text-sm">No failing jobs found</p>
              ) : (
                <div className="space-y-3">
                  {failingJobs.map((job) => (
                    <div key={job.jobName} className="flex items-center justify-between">
                      <div className="flex flex-col min-w-0 flex-1 mr-2">
                        <span className="text-sm font-medium truncate">{job.jobName}</span>
                        <span className="text-muted-foreground text-xs">
                          {job.totalRuns} runs · <Badge variant={getSuccessRateVariant(job.successRate)}>{job.successRate}%</Badge>
                        </span>
                      </div>
                      <Badge variant="destructive">{job.failureCount}x</Badge>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <Skeleton className="h-[200px] w-full" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Failure Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            {failureReasons ? (
              failureReasons.length === 0 ? (
                <p className="text-muted-foreground text-sm">No failure reasons found</p>
              ) : (
                <div className="space-y-3">
                  {failureReasons.map((reason) => (
                    <div key={reason.pattern} className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate flex-1 min-w-0">{reason.pattern}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground text-xs">
                          {formatRelativeTime(reason.lastOccurrence)}
                        </span>
                        <Badge variant="destructive">{reason.count}x</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <Skeleton className="h-[200px] w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Runs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <Link
            to="/dashboard/runs"
            search={{
              from: timeRange.from,
              to: timeRange.to,
              page: 1,
              workflowName: decodedName,
              repo: undefined,
              branch: undefined,
              conclusion: undefined,
              runId: undefined,
            }}
            className="text-muted-foreground hover:text-foreground text-xs ml-auto"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recentRuns ? (
            <RunsTable data={recentRuns} />
          ) : (
            <Skeleton className="h-[300px] w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowDetailSkeleton() {
  return (
    <div className="space-y-3">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-24" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
          <CardContent><Skeleton className="h-40 w-full" /></CardContent>
        </Card>
        <Card>
          <CardHeader><Skeleton className="h-5 w-36" /></CardHeader>
          <CardContent><Skeleton className="h-40 w-full" /></CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**Step 2: Verify the page loads**

Navigate to `http://localhost:3000/dashboard/workflows/<some-workflow-name>` and confirm it renders.

Run: `pnpm check`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/app/src/routes/dashboard/workflows/\$workflowName.tsx
git commit -m "feat(workflows): add workflow detail page route"
```

---

### Task 8: Final verification and cleanup

**Step 1: Run lint/format check**

Run: `pnpm check`
Expected: PASS

**Step 2: Run tests**

Run: `pnpm test`
Expected: All existing tests pass, no regressions

**Step 3: Manual verification**

1. Navigate to `/dashboard/workflows` — verify:
   - Workflows table loads with data
   - Sparkline backgrounds appear behind metric cells
   - Period-over-period deltas show with correct colors
   - Repo filter works
   - Search filter works
   - Pagination works
   - Clicking a workflow name navigates to detail page

2. Navigate to `/dashboard/workflows/<name>` — verify:
   - KPI cards show with sparkline backgrounds and deltas
   - Success Rate Trend chart renders
   - Duration Trend chart renders
   - Top Failing Jobs list populates
   - Failure Reasons list populates
   - Recent Runs table shows with working links
   - "View all" link goes to Runs page filtered by workflow

3. Verify sidebar navigation — "Workflows" appears between "Runs" and "Failures"

**Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "feat(workflows): final cleanup and verification"
```
