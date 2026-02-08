import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import type { TimeRangeInput } from "./analytics";
import { timeRangeToDays } from "./analytics";
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
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

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
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
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
    }>(sql);

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
}

export const getTestResultsByPackage = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				repo,
				test_package,
				uniqExact(test_full_name) as testCount,
				countIf(test_result = 'pass') as passCount,
				countIf(test_result = 'fail') as failCount,
				countIf(test_result = 'skip') as skipCount,
				round(
					countIf(test_result = 'pass') * 100.0
					/ nullIf(countIf(test_result = 'pass') + countIf(test_result = 'fail'), 0),
					1
				) as passRate,
				avg(test_duration) as avgDuration
			FROM (
				SELECT
					ResourceAttributes['vcs.repository.name'] as repo,
					SpanAttributes['citric.test.package'] as test_package,
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['citric.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration
				FROM otel_traces
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail', 'skip')
				GROUP BY repo, test_package, test_full_name, run_id, head_sha
			)
			GROUP BY repo, test_package
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
    }>(sql);

    return result.map((row) => ({
      repo: row.repo,
      testPackage: row.test_package,
      testCount: Number(row.testCount),
      passCount: Number(row.passCount),
      failCount: Number(row.failCount),
      skipCount: Number(row.skipCount),
      passRate: Number(row.passRate) || 0,
      avgDuration: Number(row.avgDuration),
    })) satisfies PackageResult[];
  });

export interface SlowestTest {
  repo: string;
  testPackage: string;
  testFullName: string;
  avgDuration: number;
  maxDuration: number;
  executionCount: number;
}

export const getSlowestTests = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				repo,
				test_package,
				test_full_name,
				avg(test_duration) as avgDuration,
				max(test_duration) as maxDuration,
				count(*) as executionCount
			FROM (
				SELECT
					ResourceAttributes['vcs.repository.name'] as repo,
					SpanAttributes['citric.test.package'] as test_package,
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration
				FROM otel_traces
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail')
				GROUP BY repo, test_package, test_full_name, run_id, head_sha
			)
			GROUP BY repo, test_package, test_full_name
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
    }>(sql);

    return result.map((row) => ({
      repo: row.repo,
      testPackage: row.test_package,
      testFullName: row.test_full_name,
      avgDuration: Number(row.avgDuration),
      maxDuration: Number(row.maxDuration),
      executionCount: Number(row.executionCount),
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
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

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
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail')
				GROUP BY run_id, head_sha, test_full_name
			)
			GROUP BY date
			ORDER BY date ASC
		`;

    const result = await query<{
      date: string;
      avgDuration: string;
      p50Duration: string;
      p95Duration: string;
    }>(sql);

    return result.map((row) => ({
      date: row.date,
      avgDuration: Number(row.avgDuration),
      p50Duration: Number(row.p50Duration),
      p95Duration: Number(row.p95Duration),
    })) satisfies TestDurationTrendPoint[];
  });
