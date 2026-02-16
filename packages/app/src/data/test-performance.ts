import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { leafTestFilter, testFullNameExpr } from "./sql-helpers";

// Filter input for test performance
export const TestPerformanceFilterSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
  pkg: z.string().optional(),
  testName: z.string().optional(),
  branch: z.string().optional(),
  path: z.string().optional(),
});
export type TestPerformanceFilterInput = z.infer<
  typeof TestPerformanceFilterSchema
>;

// Filter options (repos + branches that have test data)
export interface TestPerfFilterOptions {
  repos: string[];
  branches: string[];
}

interface BuildFilterResult {
  conditions: string[];
  params: Record<string, unknown>;
  /** Scope conditions to apply on the OUTER query using the test_full_name alias */
  scopeConditions: string[];
  /** When true, metrics should aggregate all leaf tests per run (package-level view) */
  aggregateByRun: boolean;
}

export function buildFilterConditions(
  fromISO: string,
  toISO: string,
  data: TestPerformanceFilterInput,
): BuildFilterResult {
  const conditions: string[] = [
    "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
    "SpanAttributes['citric.test.name'] != ''",
    "SpanAttributes['citric.test.result'] IN ('pass', 'fail')",
  ];
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
  };
  const scopeConditions: string[] = [];

  if (data.repo) {
    conditions.push(
      "ResourceAttributes['vcs.repository.name'] = {repo:String}",
    );
    params.repo = data.repo;
  }
  if (data.pkg) {
    conditions.push("SpanAttributes['citric.test.package'] = {pkg:String}");
    params.pkg = data.pkg;
  }
  if (data.testName) {
    conditions.push(
      "SpanAttributes['citric.test.name'] ILIKE {testName:String}",
    );
    params.testName = `%${data.testName}%`;
  }
  if (data.branch) {
    conditions.push(
      "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
    params.branch = data.branch;
  }

  if (data.path) {
    // name already contains the full test path for both vitest and Go tests
    conditions.push("SpanAttributes['citric.test.name'] = {exactPath:String}");
    params.exactPath = data.path;
  } else if (data.pkg) {
    // Package level: show direct children only (describe blocks / top-level tests)
    conditions.push("SpanAttributes['citric.test.parent_test'] = ''");
  } else {
    // Root level: show only leaf tests (exclude suites)
    scopeConditions.push(
      `test_full_name NOT IN (
        SELECT DISTINCT SpanAttributes['citric.test.parent_test']
        FROM otel_traces
        WHERE SpanAttributes['citric.test.parent_test'] != ''
          AND Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
      )`,
    );
  }

  // Package level without a specific path: aggregate per run
  const aggregateByRun = !!data.pkg && !data.path;

  return { conditions, params, scopeConditions, aggregateByRun };
}

/**
 * Resolves time range, builds filter conditions, and joins them into SQL fragments.
 * Shared boilerplate for stats, scatter, trend, and failures handlers.
 */
function prepareFilter(data: TestPerformanceFilterInput) {
  const { fromISO, toISO } = resolveTimeRange(data.timeRange);
  const filter = buildFilterConditions(fromISO, toISO, data);
  const whereClause = filter.conditions.join("\n\t\t\t\t\tAND ");
  const scopeWhere =
    filter.scopeConditions.length > 0
      ? `WHERE ${filter.scopeConditions.join("\n\t\t\t\t\tAND ")}`
      : "";
  return { ...filter, whereClause, scopeWhere, fromISO, toISO };
}

/**
 * Builds the inner deduplication subquery that collapses multiple spans for the
 * same (test_full_name, run_id, head_sha) into a single execution row.
 *
 * @param whereClause - SQL WHERE conditions
 * @param opts.includeResult - include test_result column (default true)
 * @param opts.includeTimestamp - include max(Timestamp) as timestamp
 * @param opts.includeMetadata - include branch, repo, trace_id columns
 */
function executionsSubquery(
  whereClause: string,
  opts: {
    includeResult?: boolean;
    includeTimestamp?: boolean;
    includeMetadata?: boolean;
  } = {},
): string {
  const {
    includeResult = true,
    includeTimestamp = false,
    includeMetadata = false,
  } = opts;

  const selects = [
    testFullNameExpr(),
    "ResourceAttributes['cicd.pipeline.run.id'] as run_id",
    "ResourceAttributes['vcs.ref.head.revision'] as head_sha",
  ];
  const groupBy = ["test_full_name", "run_id", "head_sha"];

  if (includeMetadata) {
    selects.push(
      "ResourceAttributes['vcs.ref.head.name'] as branch",
      "ResourceAttributes['vcs.repository.name'] as repo",
      "TraceId as trace_id",
    );
    groupBy.push("branch", "repo", "trace_id");
  }

  if (includeResult) {
    selects.push(
      "anyLast(SpanAttributes['citric.test.result']) as test_result",
    );
  }
  selects.push(
    "anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration",
  );
  if (includeTimestamp) {
    selects.push("max(Timestamp) as timestamp");
  }

  return `SELECT
						${selects.join(",\n\t\t\t\t\t\t")}
					FROM otel_traces
					WHERE ${whereClause}
					GROUP BY ${groupBy.join(", ")}`;
}

// Server function: filter options (repos + branches from last 90 days)
export const getTestPerfFilterOptions = createServerFn({
  method: "GET",
}).handler(async () => {
  const [repos, branches] = await Promise.all([
    query<{ repo: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.repository.name'] as repo
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.repository.name'] != ''
				AND SpanAttributes['citric.test.name'] != ''
			ORDER BY repo
			LIMIT 100`,
    ),
    query<{ branch: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.ref.head.name'] != ''
				AND SpanAttributes['citric.test.name'] != ''
			ORDER BY branch
			LIMIT 100`,
    ),
  ]);

  return {
    repos: repos.map((r) => r.repo),
    branches: branches.map((r) => r.branch),
  } satisfies TestPerfFilterOptions;
});

// Server function: packages filtered by time range and optional repo
const TestPerfPackagesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
});

export const getTestPerfPackages = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerfPackagesInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const conditions: string[] = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "SpanAttributes['citric.test.name'] != ''",
      "SpanAttributes['citric.test.package'] != ''",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
    };

    if (data.repo) {
      conditions.push(
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      );
      params.repo = data.repo;
    }

    const whereClause = conditions.join("\n\t\t\t\tAND ");

    const result = await query<{ pkg: string }>(
      `SELECT DISTINCT SpanAttributes['citric.test.package'] as pkg
			FROM otel_traces
			WHERE ${whereClause}
			ORDER BY pkg
			LIMIT 200`,
      params,
    );

    return result.map((r) => r.pkg);
  });

// Query option factories
export const testPerfFilterOptionsOptions = () =>
  queryOptions({
    queryKey: ["testPerf", "filterOptions"],
    queryFn: () => getTestPerfFilterOptions(),
    staleTime: 5 * 60_000,
  });

export const testPerfPackagesOptions = (
  input: z.infer<typeof TestPerfPackagesInputSchema>,
) =>
  queryOptions({
    queryKey: ["testPerf", "packages", input],
    queryFn: () => getTestPerfPackages({ data: input }),
    staleTime: 60_000,
  });

// --- Children (hierarchy browser) ---

export interface TestPerfChild {
  name: string;
  executions: number;
  avgDuration: number;
  p95Duration: number;
  failureRate: number;
}

const TestPerfChildrenInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
  pkg: z.string().optional(),
  branch: z.string().optional(),
  path: z.string().optional(),
});

export const getTestPerfChildren = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerfChildrenInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const timeConditions = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "SpanAttributes['citric.test.name'] != ''",
      "SpanAttributes['citric.test.result'] IN ('pass', 'fail')",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
    };

    if (data.repo) {
      timeConditions.push(
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      );
      params.repo = data.repo;
    }
    if (data.branch) {
      timeConditions.push(
        "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
      );
      params.branch = data.branch;
    }

    const isRoot = !data.pkg;

    if (isRoot) {
      // Root level: return packages with aggregate leaf-only metrics
      timeConditions.push("SpanAttributes['citric.test.package'] != ''");
      timeConditions.push(leafTestFilter());
      const whereClause = timeConditions.join("\n\t\t\t\t\tAND ");

      const sql = `
				SELECT
					name,
					count(*) as executions,
					avg(test_duration) as avg_duration,
					quantile(0.95)(test_duration) as p95_duration,
					round(countIf(test_result = 'fail') * 100.0 / nullIf(count(), 0), 1) as failure_rate
				FROM (
					SELECT
						SpanAttributes['citric.test.package'] as name,
						${testFullNameExpr()},
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						ResourceAttributes['vcs.ref.head.revision'] as head_sha,
						anyLast(SpanAttributes['citric.test.result']) as test_result,
						anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration
					FROM otel_traces
					WHERE ${whereClause}
					GROUP BY name, test_full_name, run_id, head_sha
				)
				GROUP BY name
				ORDER BY name
			`;

      const result = await query<{
        name: string;
        executions: string;
        avg_duration: string;
        p95_duration: string;
        failure_rate: string;
      }>(sql, params);

      return result.map((row) => ({
        name: row.name,
        executions: Number(row.executions),
        avgDuration: Number(row.avg_duration),
        p95Duration: Number(row.p95_duration),
        failureRate: Number(row.failure_rate) || 0,
      })) satisfies TestPerfChild[];
    }

    // Package or deeper level: return direct children
    timeConditions.push("SpanAttributes['citric.test.package'] = {pkg:String}");
    params.pkg = data.pkg;

    const parentTest = data.path ?? "";
    timeConditions.push(
      "SpanAttributes['citric.test.parent_test'] = {parentTest:String}",
    );
    params.parentTest = parentTest;

    const whereClause = timeConditions.join("\n\t\t\t\t\tAND ");

    const sql = `
			SELECT
				name,
				count(*) as executions,
				avg(test_duration) as avg_duration,
				quantile(0.95)(test_duration) as p95_duration,
				round(countIf(test_result = 'fail') * 100.0 / nullIf(count(), 0), 1) as failure_rate
			FROM (
				SELECT
					SpanAttributes['citric.test.name'] as name,
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['citric.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration
				FROM otel_traces
				WHERE ${whereClause}
				GROUP BY name, test_full_name, run_id, head_sha
			)
			GROUP BY name
			ORDER BY name
		`;

    const result = await query<{
      name: string;
      executions: string;
      avg_duration: string;
      p95_duration: string;
      failure_rate: string;
    }>(sql, params);

    return result.map((row) => ({
      name: row.name,
      executions: Number(row.executions),
      avgDuration: Number(row.avg_duration),
      p95Duration: Number(row.p95_duration),
      failureRate: Number(row.failure_rate) || 0,
    })) satisfies TestPerfChild[];
  });

// --- Child types (determine which children are suites) ---

const TestPerfChildTypesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  childFullNames: z.array(z.string()),
});

export const getTestPerfChildTypes = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerfChildTypesInputSchema)
  .handler(async ({ data }) => {
    if (data.childFullNames.length === 0) return [] as string[];

    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
			SELECT DISTINCT SpanAttributes['citric.test.parent_test'] as parent_test
			FROM otel_traces
			WHERE SpanAttributes['citric.test.parent_test'] IN ({childFullNames:Array(String)})
				AND SpanAttributes['citric.test.parent_test'] != ''
				AND Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
		`;

    const result = await query<{ parent_test: string }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      childFullNames: data.childFullNames,
    });

    return result.map((r) => r.parent_test);
  });

export const testPerfChildrenOptions = (
  input: z.infer<typeof TestPerfChildrenInputSchema>,
) =>
  queryOptions({
    queryKey: ["testPerf", "children", input],
    queryFn: () => getTestPerfChildren({ data: input }),
    staleTime: 60_000,
  });

export const testPerfChildTypesOptions = (
  input: z.infer<typeof TestPerfChildTypesInputSchema>,
) =>
  queryOptions({
    queryKey: ["testPerf", "childTypes", input],
    queryFn: () => getTestPerfChildTypes({ data: input }),
    staleTime: 60_000,
    enabled: input.childFullNames.length > 0,
  });

// --- Stats ---

export interface TestPerformanceStats {
  totalExecutions: number;
  avgDuration: number;
  p95Duration: number;
  failureRate: number;
}

export const getTestPerfStats = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { whereClause, scopeWhere, params } = prepareFilter(data);
    const inner = executionsSubquery(whereClause);

    const sql = `
			SELECT
				count(*) as total_executions,
				avg(test_duration) as avg_duration,
				quantile(0.95)(test_duration) as p95_duration,
				round(
					countIf(test_result = 'fail') * 100.0
					/ nullIf(countIf(test_result = 'fail') + countIf(test_result = 'pass'), 0),
					1
				) as failure_rate
			FROM (
				SELECT test_full_name, test_result, test_duration
				FROM (${inner})
				${scopeWhere}
			)
		`;

    const result = await query<{
      total_executions: string;
      avg_duration: string;
      p95_duration: string;
      failure_rate: string;
    }>(sql, params);

    if (result.length === 0) {
      return {
        totalExecutions: 0,
        avgDuration: 0,
        p95Duration: 0,
        failureRate: 0,
      } satisfies TestPerformanceStats;
    }

    return {
      totalExecutions: Number(result[0].total_executions),
      avgDuration: Number(result[0].avg_duration),
      p95Duration: Number(result[0].p95_duration),
      failureRate: Number(result[0].failure_rate) || 0,
    } satisfies TestPerformanceStats;
  });

// --- Scatter ---

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

export const getTestPerfScatter = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { whereClause, scopeWhere, params, aggregateByRun } =
      prepareFilter(data);
    const inner = executionsSubquery(whereClause, {
      includeMetadata: true,
      includeTimestamp: true,
    });

    let sql: string;

    if (aggregateByRun) {
      // Package level: one dot per CI run, sum leaf-test durations
      sql = `
				SELECT
					{pkg:String} as test_full_name,
					sum(test_duration) as test_duration,
					if(countIf(test_result = 'fail') > 0, 'fail', 'pass') as test_result,
					max(timestamp) as timestamp,
					branch,
					repo,
					any(trace_id) as trace_id,
					head_sha
				FROM (
					SELECT test_full_name, test_duration, test_result, timestamp, branch, repo, trace_id, head_sha
					FROM (${inner})
					${scopeWhere}
				)
				GROUP BY branch, repo, head_sha
				ORDER BY timestamp ASC
				LIMIT 1000
			`;
    } else {
      sql = `
				SELECT test_full_name, test_duration, test_result, timestamp, branch, repo, trace_id, head_sha
				FROM (${inner})
				${scopeWhere}
				ORDER BY timestamp ASC
				LIMIT 1000
			`;
    }

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

    return result.map((row) => ({
      testName: row.test_full_name,
      duration: Number(row.test_duration),
      result: row.test_result,
      timestamp: row.timestamp,
      branch: row.branch,
      repo: row.repo,
      traceId: row.trace_id,
      commitSha: row.head_sha,
    })) satisfies ScatterPoint[];
  });

// --- Trend ---

export interface TestPerfTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
}

export const getTestPerfTrend = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { whereClause, scopeWhere, params } = prepareFilter(data);
    const inner = executionsSubquery(whereClause, {
      includeResult: false,
      includeTimestamp: true,
    });

    const sql = `
			SELECT
				toDate(timestamp) as date,
				avg(test_duration) as avg_duration,
				quantile(0.5)(test_duration) as p50_duration,
				quantile(0.95)(test_duration) as p95_duration
			FROM (
				SELECT test_full_name, test_duration, timestamp
				FROM (${inner})
				${scopeWhere}
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await query<{
      date: string;
      avg_duration: string;
      p50_duration: string;
      p95_duration: string;
    }>(sql, params);

    return result.map((row) => ({
      date: row.date,
      avgDuration: Number(row.avg_duration),
      p50Duration: Number(row.p50_duration),
      p95Duration: Number(row.p95_duration),
    })) satisfies TestPerfTrendPoint[];
  });

// --- Failures ---

export interface TestFailure {
  testName: string;
  duration: number;
  timestamp: string;
  branch: string;
  commitSha: string;
  traceId: string;
  repo: string;
}

export const getTestPerfFailures = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(async ({ data }) => {
    const { whereClause, scopeConditions, params } = prepareFilter(data);
    const inner = executionsSubquery(whereClause, {
      includeMetadata: true,
      includeTimestamp: true,
    });
    const scopeFilters = [...scopeConditions, "test_result = 'fail'"];
    const failuresWhere = `WHERE ${scopeFilters.join("\n\t\t\t\t\tAND ")}`;

    const sql = `
			SELECT test_full_name, test_duration, timestamp, branch, head_sha, trace_id, repo
			FROM (${inner})
			${failuresWhere}
			ORDER BY timestamp DESC
			LIMIT 50
		`;

    const result = await query<{
      test_full_name: string;
      test_duration: string;
      timestamp: string;
      branch: string;
      head_sha: string;
      trace_id: string;
      repo: string;
    }>(sql, params);

    return result.map((row) => ({
      testName: row.test_full_name,
      duration: Number(row.test_duration),
      timestamp: row.timestamp,
      branch: row.branch,
      commitSha: row.head_sha,
      traceId: row.trace_id,
      repo: row.repo,
    })) satisfies TestFailure[];
  });

// Query option factories for stats, scatter, trend, failures

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
