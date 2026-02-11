import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange } from "@/lib/time-range";
import { type TimeRangeInput, TimeRangeInputSchema } from "./analytics";
import { testFullNameExpr } from "./sql-helpers";

export interface TestResultsSummary {
  totalTests: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  passRate: number;
}

export const getTestResultsSummary = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				uniqExact(test_full_name) as totalTests,
				countIf(test_result = 'pass') as passCount,
				countIf(test_result = 'fail') as failCount,
				countIf(test_result = 'skip') as skipCount,
				round(
					countIf(test_result = 'pass') * 100.0
					/ nullIf(countIf(test_result = 'pass') + countIf(test_result = 'fail'), 0),
					1
				) as passRate
			FROM (
				SELECT
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['citric.test.result']) as test_result
				FROM otel_traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail', 'skip')
				GROUP BY test_full_name, run_id, head_sha
			)
		`;

    const result = await query<{
      totalTests: string;
      passCount: string;
      failCount: string;
      skipCount: string;
      passRate: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    if (result.length === 0) {
      return {
        totalTests: 0,
        passCount: 0,
        failCount: 0,
        skipCount: 0,
        passRate: 0,
      } satisfies TestResultsSummary;
    }

    return {
      totalTests: Number(result[0].totalTests),
      passCount: Number(result[0].passCount),
      failCount: Number(result[0].failCount),
      skipCount: Number(result[0].skipCount),
      passRate: Number(result[0].passRate) || 0,
    } satisfies TestResultsSummary;
  });

export interface PackageResult {
  repo: string;
  testPackage: string;
  testCount: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  passRate: number;
  avgDuration: number;
  avgDurationTrend: number[];
}

export const getTestResultsByPackage = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			WITH executions AS (
				SELECT
					ResourceAttributes['vcs.repository.name'] as repo,
					SpanAttributes['citric.test.package'] as test_package,
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['citric.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
					toDate(max(Timestamp)) as exec_date
				FROM otel_traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail', 'skip')
				GROUP BY repo, test_package, test_full_name, run_id, head_sha
			),
			daily_pkg AS (
				SELECT repo, test_package, exec_date,
					avg(test_duration) as day_avg
				FROM executions
				GROUP BY repo, test_package, exec_date
			)
			SELECT
				e.repo as repo,
				e.test_package as test_package,
				uniqExact(e.test_full_name) as testCount,
				countIf(e.test_result = 'pass') as passCount,
				countIf(e.test_result = 'fail') as failCount,
				countIf(e.test_result = 'skip') as skipCount,
				round(
					countIf(e.test_result = 'pass') * 100.0
					/ nullIf(countIf(e.test_result = 'pass') + countIf(e.test_result = 'fail'), 0),
					1
				) as passRate,
				avg(e.test_duration) as avgDuration,
				(SELECT arrayMap(x -> round(x.2, 4), arraySort(x -> x.1, groupArray((exec_date, day_avg))))
				 FROM daily_pkg d WHERE d.repo = e.repo AND d.test_package = e.test_package
				) as avgDurationTrend
			FROM executions e
			GROUP BY e.repo, e.test_package
			ORDER BY failCount DESC, testCount DESC
			LIMIT 50
		`;

    const result = await query<{
      repo: string;
      test_package: string;
      testCount: string;
      passCount: string;
      failCount: string;
      skipCount: string;
      passRate: string;
      avgDuration: string;
      avgDurationTrend: number[];
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      repo: row.repo,
      testPackage: row.test_package,
      testCount: Number(row.testCount),
      passCount: Number(row.passCount),
      failCount: Number(row.failCount),
      skipCount: Number(row.skipCount),
      passRate: Number(row.passRate) || 0,
      avgDuration: Number(row.avgDuration),
      avgDurationTrend: row.avgDurationTrend,
    })) satisfies PackageResult[];
  });

export interface SlowestTest {
  repo: string;
  testPackage: string;
  testFullName: string;
  avgDuration: number;
  maxDuration: number;
  executionCount: number;
  avgDurationTrend: number[];
  maxDurationTrend: number[];
}

export const getSlowestTests = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			WITH executions AS (
				SELECT
					ResourceAttributes['vcs.repository.name'] as repo,
					SpanAttributes['citric.test.package'] as test_package,
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
					toDate(max(Timestamp)) as exec_date
				FROM otel_traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail')
				GROUP BY repo, test_package, test_full_name, run_id, head_sha
			),
			daily_test AS (
				SELECT repo, test_package, test_full_name, exec_date,
					avg(test_duration) as day_avg,
					max(test_duration) as day_max
				FROM executions
				GROUP BY repo, test_package, test_full_name, exec_date
			)
			SELECT
				e.repo as repo,
				e.test_package as test_package,
				e.test_full_name as test_full_name,
				avg(e.test_duration) as avgDuration,
				max(e.test_duration) as maxDuration,
				count(*) as executionCount,
				(SELECT arrayMap(x -> round(x.2, 4), arraySort(x -> x.1, groupArray((exec_date, day_avg))))
				 FROM daily_test d WHERE d.repo = e.repo AND d.test_full_name = e.test_full_name
				) as avgDurationTrend,
				(SELECT arrayMap(x -> round(x.2, 4), arraySort(x -> x.1, groupArray((exec_date, day_max))))
				 FROM daily_test d WHERE d.repo = e.repo AND d.test_full_name = e.test_full_name
				) as maxDurationTrend
			FROM executions e
			GROUP BY e.repo, e.test_package, e.test_full_name
			ORDER BY avgDuration DESC
			LIMIT 20
		`;

    const result = await query<{
      repo: string;
      test_package: string;
      test_full_name: string;
      avgDuration: string;
      maxDuration: string;
      executionCount: string;
      avgDurationTrend: number[];
      maxDurationTrend: number[];
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      repo: row.repo,
      testPackage: row.test_package,
      testFullName: row.test_full_name,
      avgDuration: Number(row.avgDuration),
      maxDuration: Number(row.maxDuration),
      executionCount: Number(row.executionCount),
      avgDurationTrend: row.avgDurationTrend,
      maxDurationTrend: row.maxDurationTrend,
    })) satisfies SlowestTest[];
  });

export interface TestDurationTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
}

export const getTestDurationTrend = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				toDate(timestamp) as date,
				avg(test_duration) as avgDuration,
				quantile(0.5)(test_duration) as p50Duration,
				quantile(0.95)(test_duration) as p95Duration
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					${testFullNameExpr()},
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
					max(Timestamp) as timestamp
				FROM otel_traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail')
				GROUP BY run_id, head_sha, test_full_name
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await query<{
      date: string;
      avgDuration: string;
      p50Duration: string;
      p95Duration: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      date: row.date,
      avgDuration: Number(row.avgDuration),
      p50Duration: Number(row.p50Duration),
      p95Duration: Number(row.p95Duration),
    })) satisfies TestDurationTrendPoint[];
  });

// Query options factories
export const testResultsSummaryOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["testResults", "summary", input],
    queryFn: () => getTestResultsSummary({ data: input }),
    staleTime: 60_000,
  });

export const testResultsByPackageOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["testResults", "byPackage", input],
    queryFn: () => getTestResultsByPackage({ data: input }),
    staleTime: 60_000,
  });

export const slowestTestsOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["testResults", "slowest", input],
    queryFn: () => getSlowestTests({ data: input }),
    staleTime: 60_000,
  });

export const testDurationTrendOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["testResults", "durationTrend", input],
    queryFn: () => getTestDurationTrend({ data: input }),
    staleTime: 60_000,
  });
