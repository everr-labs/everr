# Test Performance Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/dashboard/test-performance` page that lets users analyze test execution duration and failure patterns over time via scatter plot, KPIs, duration trend chart, and failures table.

**Architecture:** New route + data layer following existing flaky-tests pattern. Server functions with ClickHouse queries accept time range + filter params (repo, package, testName, branch). Page uses direct `useQuery` calls (not Panel component) since filters go beyond `TimeRangeInput`. Components live in `packages/app/src/components/test-performance/`.

**Tech Stack:** TanStack Router (file routes), TanStack Query, Recharts (ScatterChart, LineChart), ClickHouse, Zod, Tailwind CSS

---

## Task 1: Data Layer — Filter Options & Schema

**Files:**
- Create: `packages/app/src/data/test-performance.ts`

**Step 1: Create the data file with schema, filter builder, and filter option queries**

```typescript
// packages/app/src/data/test-performance.ts
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { testFullNameExpr } from "./sql-helpers";

// --- Schema ---

const TestPerformanceFilterSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
  pkg: z.string().optional(),
  testName: z.string().optional(),
  branch: z.string().optional(),
});
export type TestPerformanceFilterInput = z.infer<typeof TestPerformanceFilterSchema>;

// --- Filter condition builder (same pattern as flaky-tests.ts) ---

function buildFilterConditions(
  fromISO: string,
  toISO: string,
  data: TestPerformanceFilterInput,
): { conditions: string[]; params: Record<string, unknown> } {
  const conditions: string[] = [
    "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
    "SpanAttributes['citric.test.name'] != ''",
    "SpanAttributes['citric.test.result'] IN ('pass', 'fail')",
  ];
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
  };

  if (data.repo) {
    conditions.push("ResourceAttributes['vcs.repository.name'] = {repo:String}");
    params.repo = data.repo;
  }
  if (data.pkg) {
    conditions.push("SpanAttributes['citric.test.package'] = {pkg:String}");
    params.pkg = data.pkg;
  }
  if (data.testName) {
    conditions.push(`${testFullNameExpr(null)} ILIKE {testName:String}`);
    params.testName = `%${data.testName}%`;
  }
  if (data.branch) {
    conditions.push("ResourceAttributes['vcs.ref.head.name'] = {branch:String}");
    params.branch = data.branch;
  }

  return { conditions, params };
}

// --- Filter option queries ---

export interface TestPerformanceFilterOptions {
  repos: string[];
  branches: string[];
}

export const getTestPerfFilterOptions = createServerFn({ method: "GET" })
  .handler(async () => {
    const [repos, branches] = await Promise.all([
      query<{ repo: string }>(
        `SELECT DISTINCT ResourceAttributes['vcs.repository.name'] as repo
         FROM otel_traces
         WHERE Timestamp >= now() - INTERVAL 90 DAY
           AND ResourceAttributes['vcs.repository.name'] != ''
           AND SpanAttributes['citric.test.name'] != ''
         ORDER BY repo LIMIT 100`,
      ),
      query<{ branch: string }>(
        `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
         FROM otel_traces
         WHERE Timestamp >= now() - INTERVAL 90 DAY
           AND ResourceAttributes['vcs.ref.head.name'] != ''
           AND SpanAttributes['citric.test.name'] != ''
         ORDER BY branch LIMIT 100`,
      ),
    ]);
    return {
      repos: repos.map((r) => r.repo),
      branches: branches.map((b) => b.branch),
    } satisfies TestPerformanceFilterOptions;
  });

export const getTestPerfPackages = createServerFn({ method: "GET" })
  .inputValidator(z.object({ timeRange: TimeRangeSchema, repo: z.string().optional() }))
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const conditions = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "SpanAttributes['citric.test.name'] != ''",
      "SpanAttributes['citric.test.package'] != ''",
    ];
    const params: Record<string, unknown> = { fromTime: fromISO, toTime: toISO };
    if (data.repo) {
      conditions.push("ResourceAttributes['vcs.repository.name'] = {repo:String}");
      params.repo = data.repo;
    }
    const sql = `SELECT DISTINCT SpanAttributes['citric.test.package'] as pkg
                 FROM otel_traces WHERE ${conditions.join(" AND ")}
                 ORDER BY pkg LIMIT 200`;
    const result = await query<{ pkg: string }>(sql, params);
    return result.map((r) => r.pkg);
  });

// Query options factories (filter options)
export const testPerfFilterOptionsOptions = () =>
  queryOptions({
    queryKey: ["testPerf", "filterOptions"],
    queryFn: () => getTestPerfFilterOptions(),
    staleTime: 5 * 60_000,
  });

export const testPerfPackagesOptions = (input: { timeRange: { from: string; to: string }; repo?: string }) =>
  queryOptions({
    queryKey: ["testPerf", "packages", input],
    queryFn: () => getTestPerfPackages({ data: input }),
    staleTime: 60_000,
  });
```

**Step 2: Verify the file compiles**

Run: `cd /Users/elfo404/projects/citric && pnpm check`
Expected: No errors in `test-performance.ts`

**Step 3: Commit**

```bash
git add packages/app/src/data/test-performance.ts
git commit -m "feat(test-perf): add data layer schema, filter builder, and filter option queries"
```

---

## Task 2: Data Layer — Stats, Scatter, Trend, and Failures Queries

**Files:**
- Modify: `packages/app/src/data/test-performance.ts`

**Step 1: Add the stats query**

Append to `test-performance.ts`:

```typescript
// --- Stats (KPIs) ---

export interface TestPerformanceStats {
  totalExecutions: number;
  avgDuration: number;
  p95Duration: number;
  failureRate: number;
}

export const getTestPerfStats = createServerFn({ method: "GET" })
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { conditions, params } = buildFilterConditions(fromISO, toISO, data);
    const whereClause = conditions.join("\n\t\t\tAND ");

    const sql = `
      SELECT
        count(*) as total_executions,
        avg(test_duration) as avg_duration,
        quantile(0.95)(test_duration) as p95_duration,
        round(countIf(test_result = 'fail') * 100.0
          / nullIf(count(*), 0), 1) as failure_rate
      FROM (
        SELECT
          ${testFullNameExpr()},
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          ResourceAttributes['vcs.ref.head.revision'] as head_sha,
          anyLast(SpanAttributes['citric.test.result']) as test_result,
          anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration
        FROM otel_traces
        WHERE ${whereClause}
        GROUP BY test_full_name, run_id, head_sha
      )`;

    const result = await query<{
      total_executions: string;
      avg_duration: string;
      p95_duration: string;
      failure_rate: string;
    }>(sql, params);

    if (result.length === 0) {
      return { totalExecutions: 0, avgDuration: 0, p95Duration: 0, failureRate: 0 } satisfies TestPerformanceStats;
    }
    return {
      totalExecutions: Number(result[0].total_executions),
      avgDuration: Number(result[0].avg_duration),
      p95Duration: Number(result[0].p95_duration),
      failureRate: Number(result[0].failure_rate) || 0,
    } satisfies TestPerformanceStats;
  });
```

**Step 2: Add the scatter query**

```typescript
// --- Scatter plot data ---

export interface ScatterPoint {
  testName: string;
  duration: number;
  result: string;
  timestamp: string;
  branch: string;
  repo: string;
  traceId: string;
  commitSha: string;
}

export const getTestPerfScatter = createServerFn({ method: "GET" })
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { conditions, params } = buildFilterConditions(fromISO, toISO, data);
    const whereClause = conditions.join("\n\t\t\tAND ");

    const sql = `
      SELECT
        test_full_name,
        test_duration,
        test_result,
        timestamp,
        branch,
        repo,
        trace_id,
        head_sha
      FROM (
        SELECT
          ${testFullNameExpr()},
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          ResourceAttributes['vcs.ref.head.revision'] as head_sha,
          ResourceAttributes['vcs.ref.head.name'] as branch,
          ResourceAttributes['vcs.repository.name'] as repo,
          TraceId as trace_id,
          anyLast(SpanAttributes['citric.test.result']) as test_result,
          anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
          max(Timestamp) as timestamp
        FROM otel_traces
        WHERE ${whereClause}
        GROUP BY test_full_name, run_id, head_sha, branch, repo, trace_id
      )
      ORDER BY timestamp ASC
      LIMIT 1000`;

    const result = await query<{
      test_full_name: string;
      test_duration: string;
      test_result: string;
      timestamp: string;
      branch: string;
      repo: string;
      trace_id: string;
      head_sha: string;
    }>(sql, params);

    return result.map((r) => ({
      testName: r.test_full_name,
      duration: Number(r.test_duration),
      result: r.test_result,
      timestamp: r.timestamp,
      branch: r.branch,
      repo: r.repo,
      traceId: r.trace_id,
      commitSha: r.head_sha,
    })) satisfies ScatterPoint[];
  });
```

**Step 3: Add the trend query**

```typescript
// --- Duration trend ---

export interface TestPerfTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
}

export const getTestPerfTrend = createServerFn({ method: "GET" })
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { conditions, params } = buildFilterConditions(fromISO, toISO, data);
    const whereClause = conditions.join("\n\t\t\t\tAND ");

    const sql = `
      SELECT
        toDate(timestamp) as date,
        avg(test_duration) as avgDuration,
        quantile(0.5)(test_duration) as p50Duration,
        quantile(0.95)(test_duration) as p95Duration
      FROM (
        SELECT
          ${testFullNameExpr()},
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          ResourceAttributes['vcs.ref.head.revision'] as head_sha,
          anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
          max(Timestamp) as timestamp
        FROM otel_traces
        WHERE ${whereClause}
        GROUP BY test_full_name, run_id, head_sha
      )
      GROUP BY date
      ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1`;

    const result = await query<{
      date: string;
      avgDuration: string;
      p50Duration: string;
      p95Duration: string;
    }>(sql, params);

    return result.map((r) => ({
      date: r.date,
      avgDuration: Number(r.avgDuration),
      p50Duration: Number(r.p50Duration),
      p95Duration: Number(r.p95Duration),
    })) satisfies TestPerfTrendPoint[];
  });
```

**Step 4: Add the failures query**

```typescript
// --- Recent failures ---

export interface TestFailure {
  testName: string;
  duration: number;
  timestamp: string;
  branch: string;
  commitSha: string;
  traceId: string;
  repo: string;
}

export const getTestPerfFailures = createServerFn({ method: "GET" })
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { conditions, params } = buildFilterConditions(fromISO, toISO, data);
    // Override result filter to fail-only
    const failConditions = conditions.map((c) =>
      c === "SpanAttributes['citric.test.result'] IN ('pass', 'fail')"
        ? "SpanAttributes['citric.test.result'] = 'fail'"
        : c,
    );
    const whereClause = failConditions.join("\n\t\t\tAND ");

    const sql = `
      SELECT
        test_full_name,
        test_duration,
        timestamp,
        branch,
        head_sha,
        trace_id,
        repo
      FROM (
        SELECT
          ${testFullNameExpr()},
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          ResourceAttributes['vcs.ref.head.revision'] as head_sha,
          ResourceAttributes['vcs.ref.head.name'] as branch,
          ResourceAttributes['vcs.repository.name'] as repo,
          TraceId as trace_id,
          anyLast(SpanAttributes['citric.test.result']) as test_result,
          anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
          max(Timestamp) as timestamp
        FROM otel_traces
        WHERE ${whereClause}
        GROUP BY test_full_name, run_id, head_sha, branch, repo, trace_id
      )
      WHERE test_result = 'fail'
      ORDER BY timestamp DESC
      LIMIT 50`;

    const result = await query<{
      test_full_name: string;
      test_duration: string;
      timestamp: string;
      branch: string;
      head_sha: string;
      trace_id: string;
      repo: string;
    }>(sql, params);

    return result.map((r) => ({
      testName: r.test_full_name,
      duration: Number(r.test_duration),
      timestamp: r.timestamp,
      branch: r.branch,
      commitSha: r.head_sha,
      traceId: r.trace_id,
      repo: r.repo,
    })) satisfies TestFailure[];
  });
```

**Step 5: Add all query option factories**

```typescript
// --- Query option factories ---

export const testPerfStatsOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "stats", input],
    queryFn: () => getTestPerfStats({ data: input }),
    staleTime: 60_000,
  });

export const testPerfScatterOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "scatter", input],
    queryFn: () => getTestPerfScatter({ data: input }),
    staleTime: 60_000,
  });

export const testPerfTrendOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "trend", input],
    queryFn: () => getTestPerfTrend({ data: input }),
    staleTime: 60_000,
  });

export const testPerfFailuresOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "failures", input],
    queryFn: () => getTestPerfFailures({ data: input }),
    staleTime: 60_000,
  });
```

**Step 6: Verify**

Run: `cd /Users/elfo404/projects/citric && pnpm check`
Expected: No errors

**Step 7: Commit**

```bash
git add packages/app/src/data/test-performance.ts
git commit -m "feat(test-perf): add stats, scatter, trend, and failures server functions"
```

---

## Task 3: Sidebar Navigation Entry

**Files:**
- Modify: `packages/app/src/lib/navigation.ts`

**Step 1: Add "Test Performance" to the Testing group**

In the `navMain` array, find the "Testing" group and add a new entry after "Flaky Tests":

```typescript
{
  title: "Test Performance",
  url: "/dashboard/test-performance",
},
```

The Testing group should now have 3 items: Test Results, Flaky Tests, Test Performance.

**Step 2: Verify**

Run: `cd /Users/elfo404/projects/citric && pnpm check`

**Step 3: Commit**

```bash
git add packages/app/src/lib/navigation.ts
git commit -m "feat(test-perf): add sidebar navigation entry"
```

---

## Task 4: Filter Bar Component

**Files:**
- Create: `packages/app/src/components/test-performance/filter-bar.tsx`
- Create: `packages/app/src/components/test-performance/index.ts`

**Step 1: Create the filter bar component**

Follow the exact pattern of `FlakyTestsFilterBar` but with repo, package, test name search, and branch toggle:

```typescript
// packages/app/src/components/test-performance/filter-bar.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TestPerformanceFilterOptions } from "@/data/test-performance";

interface TestPerfFilterBarProps {
  filterOptions: TestPerformanceFilterOptions;
  packages: string[];
  repo?: string;
  pkg?: string;
  testName?: string;
  branch?: string;
  onRepoChange: (value: string | undefined) => void;
  onPackageChange: (value: string | undefined) => void;
  onTestNameChange: (value: string) => void;
  onBranchChange: (value: string | undefined) => void;
}

export function TestPerfFilterBar({
  filterOptions,
  packages,
  repo,
  pkg,
  testName,
  branch,
  onRepoChange,
  onPackageChange,
  onTestNameChange,
  onBranchChange,
}: TestPerfFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={repo || "__all__"}
        onValueChange={(v) => onRepoChange(v === "__all__" ? undefined : v)}
      >
        <SelectTrigger className="w-45">
          <SelectValue placeholder="All repos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All repos</SelectItem>
          {filterOptions.repos.map((r) => (
            <SelectItem key={r} value={r}>{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={pkg || "__all__"}
        onValueChange={(v) => onPackageChange(v === "__all__" ? undefined : v)}
      >
        <SelectTrigger className="w-45">
          <SelectValue placeholder="All packages" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All packages</SelectItem>
          {packages.map((p) => (
            <SelectItem key={p} value={p}>{p}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={branch || "__all__"}
        onValueChange={(v) => onBranchChange(v === "__all__" ? undefined : v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All branches" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All branches</SelectItem>
          <SelectItem value="main">main only</SelectItem>
          {filterOptions.branches
            .filter((b) => b !== "main")
            .map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
        </SelectContent>
      </Select>

      <input
        type="text"
        placeholder="Search test name..."
        value={testName || ""}
        onChange={(e) => onTestNameChange(e.target.value)}
        className="border-input bg-background placeholder:text-muted-foreground h-9 rounded-md border px-3 text-sm"
      />
    </div>
  );
}
```

**Step 2: Create barrel export**

```typescript
// packages/app/src/components/test-performance/index.ts
export { TestPerfFilterBar } from "./filter-bar";
```

**Step 3: Verify**

Run: `cd /Users/elfo404/projects/citric && pnpm check`

**Step 4: Commit**

```bash
git add packages/app/src/components/test-performance/
git commit -m "feat(test-perf): add filter bar component"
```

---

## Task 5: Scatter Plot Component

**Files:**
- Create: `packages/app/src/components/test-performance/scatter-chart.tsx`
- Modify: `packages/app/src/components/test-performance/index.ts`

**Step 1: Create the scatter chart component**

Uses Recharts `ScatterChart` with two series (main vs other), color by result, shape by branch type. Includes custom tooltip and click handler.

```typescript
// packages/app/src/components/test-performance/scatter-chart.tsx
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { ChartEmptyState } from "@/components/ui/chart-helpers";
import type { ScatterPoint } from "@/data/test-performance";
import { formatDurationCompact } from "@/lib/formatting";

interface TestPerfScatterChartProps {
  data: ScatterPoint[];
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScatterPoint }> }) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-background border rounded-md p-2 text-xs shadow-md space-y-1">
      <p className="font-medium truncate max-w-64">{p.testName}</p>
      <p>Duration: {formatDurationCompact(p.duration, "s")}</p>
      <p>Result: <span className={p.result === "pass" ? "text-green-600" : "text-red-600"}>{p.result}</span></p>
      <p>Branch: {p.branch}</p>
      <p>Commit: {p.commitSha.slice(0, 7)}</p>
      <p>{formatTimestamp(p.timestamp)}</p>
    </div>
  );
}

const chartConfig = {
  mainPass: { label: "main (pass)", color: "hsl(142, 71%, 45%)" },
  mainFail: { label: "main (fail)", color: "hsl(0, 84%, 60%)" },
  otherPass: { label: "branch (pass)", color: "hsl(142, 71%, 45%)" },
  otherFail: { label: "branch (fail)", color: "hsl(0, 84%, 60%)" },
};

export function TestPerfScatterChart({ data }: TestPerfScatterChartProps) {
  const navigate = useNavigate();

  const { mainPass, mainFail, otherPass, otherFail } = useMemo(() => {
    const mainPass: Array<ScatterPoint & { ts: number }> = [];
    const mainFail: Array<ScatterPoint & { ts: number }> = [];
    const otherPass: Array<ScatterPoint & { ts: number }> = [];
    const otherFail: Array<ScatterPoint & { ts: number }> = [];

    for (const point of data) {
      const enriched = { ...point, ts: new Date(point.timestamp).getTime() };
      const isMain = point.branch === "main";
      const isPass = point.result === "pass";
      if (isMain && isPass) mainPass.push(enriched);
      else if (isMain && !isPass) mainFail.push(enriched);
      else if (!isMain && isPass) otherPass.push(enriched);
      else otherFail.push(enriched);
    }
    return { mainPass, mainFail, otherPass, otherFail };
  }, [data]);

  if (data.length === 0) {
    return <ChartEmptyState message="No test executions match the current filters" />;
  }

  const handleClick = (point: ScatterPoint) => {
    void navigate({ to: "/dashboard/runs/$traceId", params: { traceId: point.traceId } });
  };

  return (
    <ChartContainer config={chartConfig} className="h-[400px] w-full">
      <ScatterChart margin={{ left: 12, right: 12, top: 12, bottom: 12 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v) =>
            new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          }
          name="Time"
        />
        <YAxis
          dataKey="duration"
          type="number"
          tickFormatter={(v) => formatDurationCompact(v, "s")}
          name="Duration"
        />
        <ZAxis range={[30, 30]} />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Scatter
          name="main (pass)"
          data={mainPass}
          fill="hsl(142, 71%, 45%)"
          shape="circle"
          onClick={(e) => handleClick(e as unknown as ScatterPoint)}
          cursor="pointer"
        />
        <Scatter
          name="main (fail)"
          data={mainFail}
          fill="hsl(0, 84%, 60%)"
          shape="circle"
          onClick={(e) => handleClick(e as unknown as ScatterPoint)}
          cursor="pointer"
        />
        <Scatter
          name="branch (pass)"
          data={otherPass}
          fill="hsl(142, 71%, 45%)"
          shape="triangle"
          opacity={0.6}
          onClick={(e) => handleClick(e as unknown as ScatterPoint)}
          cursor="pointer"
        />
        <Scatter
          name="branch (fail)"
          data={otherFail}
          fill="hsl(0, 84%, 60%)"
          shape="triangle"
          opacity={0.6}
          onClick={(e) => handleClick(e as unknown as ScatterPoint)}
          cursor="pointer"
        />
      </ScatterChart>
    </ChartContainer>
  );
}
```

**Step 2: Add export to barrel**

Add to `index.ts`: `export { TestPerfScatterChart } from "./scatter-chart";`

**Step 3: Verify**

Run: `cd /Users/elfo404/projects/citric && pnpm check`

**Step 4: Commit**

```bash
git add packages/app/src/components/test-performance/
git commit -m "feat(test-perf): add scatter chart component"
```

---

## Task 6: Failures Table Component

**Files:**
- Create: `packages/app/src/components/test-performance/failures-table.tsx`
- Modify: `packages/app/src/components/test-performance/index.ts`

**Step 1: Create the failures table**

```typescript
// packages/app/src/components/test-performance/failures-table.tsx
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TestFailure } from "@/data/test-performance";
import { formatDuration, formatRelativeTime } from "@/lib/formatting";

interface FailuresTableProps {
  data: TestFailure[];
}

export function TestPerfFailuresTable({ data }: FailuresTableProps) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-8 text-center">
        No failures in the selected time range
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Test Name</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead>Commit</TableHead>
          <TableHead className="w-10">Run</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={`${row.traceId}-${row.testName}`}>
            <TableCell className="font-mono text-xs max-w-64 truncate" title={row.testName}>
              {row.testName}
            </TableCell>
            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
              {formatRelativeTime(row.timestamp)}
            </TableCell>
            <TableCell className="tabular-nums text-xs">
              {formatDuration(row.duration, "s")}
            </TableCell>
            <TableCell className="text-xs">{row.branch}</TableCell>
            <TableCell className="font-mono text-xs">{row.commitSha.slice(0, 7)}</TableCell>
            <TableCell>
              <Link
                to="/dashboard/runs/$traceId"
                params={{ traceId: row.traceId }}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

**Step 2: Add export**

Add to `index.ts`: `export { TestPerfFailuresTable } from "./failures-table";`

**Step 3: Verify**

Run: `cd /Users/elfo404/projects/citric && pnpm check`

**Step 4: Commit**

```bash
git add packages/app/src/components/test-performance/
git commit -m "feat(test-perf): add failures table component"
```

---

## Task 7: Route File — Full Page Assembly

**Files:**
- Create: `packages/app/src/routes/dashboard/test-performance.tsx`

**Step 1: Create the route file**

This is the main page that wires everything together. Follows the flaky-tests pattern with `validateSearch`, `loaderDeps`, `loader`, `pendingComponent`, and `useQuery` calls.

```typescript
// packages/app/src/routes/dashboard/test-performance.tsx
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TestPerfFilterBar, TestPerfScatterChart, TestPerfFailuresTable } from "@/components/test-performance";
import { TestDurationTrendChart } from "@/components/results/test-duration-trend-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  testPerfFilterOptionsOptions,
  testPerfPackagesOptions,
  testPerfStatsOptions,
  testPerfScatterOptions,
  testPerfTrendOptions,
  testPerfFailuresOptions,
} from "@/data/test-performance";
import { TimeRangeSearchSchema } from "@/lib/time-range";
import { formatDurationCompact } from "@/lib/formatting";

export const Route = createFileRoute("/dashboard/test-performance")({
  staticData: { breadcrumb: "Test Performance" },
  component: TestPerformancePage,
  validateSearch: TimeRangeSearchSchema.extend({
    repo: z.string().optional(),
    pkg: z.string().optional(),
    testName: z.string().optional(),
    branch: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    timeRange: { from: search.from, to: search.to },
    repo: search.repo,
    pkg: search.pkg,
    testName: search.testName,
    branch: search.branch,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    const filterInput = {
      timeRange: deps.timeRange,
      repo: deps.repo,
      pkg: deps.pkg,
      testName: deps.testName,
      branch: deps.branch,
    };
    await Promise.all([
      queryClient.prefetchQuery(testPerfStatsOptions(filterInput)),
      queryClient.prefetchQuery(testPerfScatterOptions(filterInput)),
      queryClient.prefetchQuery(testPerfTrendOptions(filterInput)),
      queryClient.prefetchQuery(testPerfFailuresOptions(filterInput)),
      queryClient.prefetchQuery(testPerfFilterOptionsOptions()),
      queryClient.prefetchQuery(testPerfPackagesOptions({
        timeRange: deps.timeRange,
        repo: deps.repo,
      })),
    ]);
  },
  pendingComponent: TestPerformanceSkeleton,
});

function TestPerformancePage() {
  const { from, to, repo, pkg, testName, branch } = Route.useSearch();
  const timeRange = { from, to };
  const filterInput = { timeRange, repo, pkg, testName, branch };
  const navigate = Route.useNavigate();

  const { data: stats } = useQuery(testPerfStatsOptions(filterInput));
  const { data: scatter } = useQuery(testPerfScatterOptions(filterInput));
  const { data: trend } = useQuery(testPerfTrendOptions(filterInput));
  const { data: failures } = useQuery(testPerfFailuresOptions(filterInput));
  const { data: filterOptions } = useQuery(testPerfFilterOptionsOptions());
  const { data: packages } = useQuery(testPerfPackagesOptions({ timeRange, repo }));

  const updateFilter = (updates: Record<string, unknown>) => {
    navigate({ search: (prev) => ({ ...prev, ...updates }) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Test Performance</h1>
        <p className="text-muted-foreground">
          Analyze test execution duration and failure patterns over time
        </p>
      </div>

      <TestPerfFilterBar
        filterOptions={filterOptions ?? { repos: [], branches: [] }}
        packages={packages ?? []}
        repo={repo}
        pkg={pkg}
        testName={testName}
        branch={branch}
        onRepoChange={(v) => updateFilter({ repo: v, pkg: undefined })}
        onPackageChange={(v) => updateFilter({ pkg: v })}
        onTestNameChange={(v) => updateFilter({ testName: v || undefined })}
        onBranchChange={(v) => updateFilter({ branch: v })}
      />

      {/* KPI Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Executions</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats?.totalExecutions ?? "--"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Duration</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats ? formatDurationCompact(stats.avgDuration, "s") : "--"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>P95 Duration</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats ? formatDurationCompact(stats.p95Duration, "s") : "--"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failure Rate</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {stats ? `${stats.failureRate}%` : "--"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Scatter Plot */}
      <Card>
        <CardHeader>
          <CardTitle>Test Duration Distribution</CardTitle>
          <CardDescription>
            Each dot is one test execution. Color = outcome, shape = branch type (circle = main, triangle = other).
            Click a dot to view the CI run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestPerfScatterChart data={scatter ?? []} />
        </CardContent>
      </Card>

      {/* Duration Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Duration Trend</CardTitle>
          <CardDescription>
            Average, P50, and P95 test duration over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestDurationTrendChart data={trend ?? []} />
        </CardContent>
      </Card>

      {/* Failures Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Failures</CardTitle>
          <CardDescription>
            Most recent test failures with links to CI runs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestPerfFailuresTable data={failures ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}

function TestPerformanceSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-1 h-4 w-80" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Skeleton key={i} className="h-9 w-[160px]" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton items
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Verify the app compiles**

Run: `cd /Users/elfo404/projects/citric && pnpm check`

**Step 3: Manually verify in the browser**

- Navigate to `http://localhost:3000/dashboard/test-performance`
- Verify: page loads, sidebar entry visible, filter bar renders
- Verify: KPI cards show data or `--` if empty
- Verify: scatter plot renders with colored dots
- Verify: duration trend chart renders
- Verify: failures table renders with links
- Verify: clicking a scatter dot navigates to run detail page
- Verify: changing filters updates all panels

**Step 4: Commit**

```bash
git add packages/app/src/routes/dashboard/test-performance.tsx
git commit -m "feat(test-perf): add test performance page route"
```

---

## Task 8: Final Verification & Cleanup

**Step 1: Run lint/format check**

Run: `cd /Users/elfo404/projects/citric && pnpm check`
Expected: No errors

**Step 2: Run tests**

Run: `cd /Users/elfo404/projects/citric && pnpm test`
Expected: All existing tests pass (no new tests needed for this iteration — the feature is a new page with no complex logic beyond ClickHouse queries and UI rendering)

**Step 3: Visual QA in browser**

Verify the complete user flow:
1. Navigate to Test Performance from sidebar
2. Page loads with all panels
3. Select a repo filter → all panels update
4. Select a package → scatter plot narrows
5. Toggle branch to "main only" → only main branch data shown
6. Type in test name search → filters further
7. Scatter plot colors: green = pass, red = fail
8. Scatter plot shapes: circles = main, triangles = other branches
9. Click a scatter dot → navigates to run detail
10. Failures table shows clickable run links
11. Duration trend chart shows avg/p50/p95 lines
12. Time range picker (header) works with all filters

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(test-perf): address QA feedback"
```

---

## Notes for the implementer

**Key patterns to follow:**
- **Data file**: `packages/app/src/data/flaky-tests.ts` is the closest reference (has filter builder, filter options, multiple queries)
- **Route file**: `packages/app/src/routes/dashboard/flaky-tests/index.tsx` is the closest reference (has validateSearch with extended schema, filter bar, useQuery calls)
- **Chart components**: `packages/app/src/components/results/test-duration-trend-chart.tsx` for the trend chart pattern
- **Filter bar**: `packages/app/src/components/flaky-tests/flaky-tests-filter-bar.tsx` for the filter bar pattern

**The `TestDurationTrendChart` can be reused directly** for the duration trend panel since the `TestPerfTrendPoint` interface matches `TestDurationTrendPoint` (both have `date`, `avgDuration`, `p50Duration`, `p95Duration`).

**Panel component is NOT used** because the page's queries accept filter params beyond `TimeRangeInput`. The Panel component only passes `{ timeRange }` to query factories. Instead, use direct `useQuery` calls (same pattern as flaky-tests page).

**ClickHouse query notes:**
- Always group by `test_full_name, run_id, head_sha` in subqueries to deduplicate spans
- Use `anyLast()` for result/duration since a test may emit multiple spans
- Use `testFullNameExpr()` from `sql-helpers.ts` for consistent test name formatting
- Column aliases from subqueries can be referenced by name in outer queries — don't use map expressions
