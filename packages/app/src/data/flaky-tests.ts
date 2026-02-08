import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import type { TimeRange, TimeRangeInput } from "./analytics";
import { timeRangeToDays } from "./analytics";
import { testFullNameExpr } from "./sql-helpers";

// Flaky test list item
export interface FlakyTest {
  repo: string;
  testPackage: string;
  testFullName: string;
  totalExecutions: number;
  failCount: number;
  passCount: number;
  skipCount: number;
  distinctRuns: number;
  distinctShas: number;
  failureRate: number;
  lastSeen: string;
  avgDuration: number;
}

export const getFlakyTests = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				repo, test_package, test_full_name,
				count(*) as total_executions,
				countIf(test_result = 'fail') as fail_count,
				countIf(test_result = 'pass') as pass_count,
				countIf(test_result = 'skip') as skip_count,
				uniqExact(run_id) as distinct_runs,
				uniqExact(head_sha) as distinct_shas,
				round(
					countIf(test_result = 'fail') * 100.0
					/ nullIf(countIf(test_result = 'fail') + countIf(test_result = 'pass'), 0),
					1
				) as failure_rate,
				max(timestamp) as last_seen,
				avg(test_duration) as avg_duration
			FROM (
				SELECT
					ResourceAttributes['vcs.repository.name'] as repo,
					SpanAttributes['citric.test.package'] as test_package,
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['citric.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
					max(Timestamp) as timestamp
				FROM otel_traces
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
					AND SpanAttributes['citric.test.name'] != ''
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail', 'skip')
				GROUP BY repo, test_package, test_full_name, run_id, head_sha
			)
			GROUP BY repo, test_package, test_full_name
			HAVING countIf(test_result = 'fail') > 0
				AND countIf(test_result = 'pass') > 0
			ORDER BY failure_rate DESC, total_executions DESC
			LIMIT 50
		`;

    const result = await query<{
      repo: string;
      test_package: string;
      test_full_name: string;
      total_executions: string;
      fail_count: string;
      pass_count: string;
      skip_count: string;
      distinct_runs: string;
      distinct_shas: string;
      failure_rate: string;
      last_seen: string;
      avg_duration: string;
    }>(sql);

    return result.map((row) => ({
      repo: row.repo,
      testPackage: row.test_package,
      testFullName: row.test_full_name,
      totalExecutions: Number(row.total_executions),
      failCount: Number(row.fail_count),
      passCount: Number(row.pass_count),
      skipCount: Number(row.skip_count),
      distinctRuns: Number(row.distinct_runs),
      distinctShas: Number(row.distinct_shas),
      failureRate: Number(row.failure_rate) || 0,
      lastSeen: row.last_seen,
      avgDuration: Number(row.avg_duration),
    })) satisfies FlakyTest[];
  });

// Summary stats
export interface FlakyTestSummary {
  flakyTestCount: number;
  totalTestCount: number;
  flakyPercentage: number;
}

export const getFlakyTestSummary = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				uniqExactIf(test_full_name, fail_count > 0 AND pass_count > 0) as flaky_test_count,
				uniqExact(test_full_name) as total_test_count,
				round(
					uniqExactIf(test_full_name, fail_count > 0 AND pass_count > 0) * 100.0
					/ nullIf(uniqExact(test_full_name), 0),
					1
				) as flaky_percentage
			FROM (
				SELECT
					${testFullNameExpr("test_full_name", "parent_test", "test_name")},
					countIf(test_result = 'fail') as fail_count,
					countIf(test_result = 'pass') as pass_count
				FROM (
					SELECT
						SpanAttributes['citric.test.parent_test'] as parent_test,
						SpanAttributes['citric.test.name'] as test_name,
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						ResourceAttributes['vcs.ref.head.revision'] as head_sha,
						anyLast(SpanAttributes['citric.test.result']) as test_result
					FROM otel_traces
					WHERE Timestamp >= now() - INTERVAL ${days} DAY
						AND SpanAttributes['citric.test.name'] != ''
						AND SpanAttributes['citric.test.result'] IN ('pass', 'fail', 'skip')
					GROUP BY parent_test, test_name, run_id, head_sha
				)
				GROUP BY test_full_name
			)
		`;

    const result = await query<{
      flaky_test_count: string;
      total_test_count: string;
      flaky_percentage: string;
    }>(sql);

    if (result.length === 0) {
      return {
        flakyTestCount: 0,
        totalTestCount: 0,
        flakyPercentage: 0,
      } satisfies FlakyTestSummary;
    }

    return {
      flakyTestCount: Number(result[0].flaky_test_count),
      totalTestCount: Number(result[0].total_test_count),
      flakyPercentage: Number(result[0].flaky_percentage) || 0,
    } satisfies FlakyTestSummary;
  });

// Flakiness trend (per-day)
export interface FlakinessTrendPoint {
  date: string;
  flakyCount: number;
  totalCount: number;
  flakyPercentage: number;
}

export const getFlakinessTrend = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				date,
				uniqExactIf(test_full_name, fail_count > 0 AND pass_count > 0) as flaky_count,
				uniqExact(test_full_name) as total_count,
				round(
					uniqExactIf(test_full_name, fail_count > 0 AND pass_count > 0) * 100.0
					/ nullIf(uniqExact(test_full_name), 0),
					1
				) as flaky_percentage
			FROM (
				SELECT
					toDate(timestamp) as date,
					test_full_name,
					countIf(test_result = 'fail') as fail_count,
					countIf(test_result = 'pass') as pass_count
				FROM (
					SELECT
						${testFullNameExpr()},
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						ResourceAttributes['vcs.ref.head.revision'] as head_sha,
						anyLast(SpanAttributes['citric.test.result']) as test_result,
						max(Timestamp) as timestamp
					FROM otel_traces
					WHERE Timestamp >= now() - INTERVAL ${days} DAY
						AND SpanAttributes['citric.test.name'] != ''
						AND SpanAttributes['citric.test.result'] IN ('pass', 'fail', 'skip')
					GROUP BY test_full_name, run_id, head_sha
				)
				GROUP BY date, test_full_name
			)
			GROUP BY date
			ORDER BY date ASC
		`;

    const result = await query<{
      date: string;
      flaky_count: string;
      total_count: string;
      flaky_percentage: string;
    }>(sql);

    return result.map((row) => ({
      date: row.date,
      flakyCount: Number(row.flaky_count),
      totalCount: Number(row.total_count),
      flakyPercentage: Number(row.flaky_percentage) || 0,
    })) satisfies FlakinessTrendPoint[];
  });

// Test detail history
export interface TestExecution {
  traceId: string;
  runId: string;
  runAttempt: number;
  headSha: string;
  headBranch: string;
  testResult: string;
  testDuration: number;
  runnerName: string;
  workflowName: string;
  jobName: string;
  timestamp: string;
}

export interface TestDetailInput {
  timeRange: TimeRange;
  repo: string;
  testFullName: string;
}

export const getTestHistory = createServerFn({
  method: "GET",
})
  .inputValidator((data: TestDetailInput) => data)
  .handler(async ({ data: { timeRange, repo, testFullName } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				trace_id,
				run_id,
				run_attempt,
				head_sha,
				head_branch,
				test_result,
				test_duration,
				runner_name,
				workflow_name,
				job_name,
				timestamp
			FROM (
				SELECT
					TraceId as trace_id,
					anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
					toUInt32OrZero(anyLast(ResourceAttributes['citric.github.workflow_job.run_attempt'])) as run_attempt,
					anyLast(ResourceAttributes['vcs.ref.head.revision']) as head_sha,
					anyLast(ResourceAttributes['vcs.ref.head.name']) as head_branch,
					anyLast(SpanAttributes['citric.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
					anyLast(ResourceAttributes['cicd.worker.name']) as runner_name,
					anyLast(ResourceAttributes['cicd.pipeline.name']) as workflow_name,
					anyLast(ResourceAttributes['cicd.pipeline.task.name']) as job_name,
					max(Timestamp) as timestamp
				FROM otel_traces
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
					AND SpanAttributes['citric.test.name'] != ''
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ${testFullNameExpr(null)} = {testFullName:String}
				GROUP BY trace_id
			)
			ORDER BY timestamp DESC
			LIMIT 100
		`;

    const result = await query<{
      trace_id: string;
      run_id: string;
      run_attempt: string;
      head_sha: string;
      head_branch: string;
      test_result: string;
      test_duration: string;
      runner_name: string;
      workflow_name: string;
      job_name: string;
      timestamp: string;
    }>(sql, { repo, testFullName });

    return result.map((row) => ({
      traceId: row.trace_id,
      runId: row.run_id,
      runAttempt: Number(row.run_attempt),
      headSha: row.head_sha,
      headBranch: row.head_branch,
      testResult: row.test_result,
      testDuration: Number(row.test_duration),
      runnerName: row.runner_name,
      workflowName: row.workflow_name,
      jobName: row.job_name,
      timestamp: row.timestamp,
    })) satisfies TestExecution[];
  });

// Runner breakdown for a specific test
export interface RunnerFlakiness {
  runnerName: string;
  totalExecutions: number;
  failCount: number;
  passCount: number;
  failureRate: number;
  avgDuration: number;
}

export const getRunnerFlakiness = createServerFn({
  method: "GET",
})
  .inputValidator((data: TestDetailInput) => data)
  .handler(async ({ data: { timeRange, repo, testFullName } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				runner_name,
				count(*) as total_executions,
				countIf(test_result = 'fail') as fail_count,
				countIf(test_result = 'pass') as pass_count,
				round(
					countIf(test_result = 'fail') * 100.0
					/ nullIf(countIf(test_result = 'fail') + countIf(test_result = 'pass'), 0),
					1
				) as failure_rate,
				avg(test_duration) as avg_duration
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['citric.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration,
					anyLast(ResourceAttributes['cicd.worker.name']) as runner_name
				FROM otel_traces
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
					AND SpanAttributes['citric.test.name'] != ''
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ${testFullNameExpr(null)} = {testFullName:String}
					AND SpanAttributes['citric.test.result'] IN ('pass', 'fail')
				GROUP BY run_id, head_sha
			)
			GROUP BY runner_name
			ORDER BY failure_rate DESC, total_executions DESC
		`;

    const result = await query<{
      runner_name: string;
      total_executions: string;
      fail_count: string;
      pass_count: string;
      failure_rate: string;
      avg_duration: string;
    }>(sql, { repo, testFullName });

    return result.map((row) => ({
      runnerName: row.runner_name,
      totalExecutions: Number(row.total_executions),
      failCount: Number(row.fail_count),
      passCount: Number(row.pass_count),
      failureRate: Number(row.failure_rate) || 0,
      avgDuration: Number(row.avg_duration),
    })) satisfies RunnerFlakiness[];
  });

// Lightweight lookup for waterfall badge
export const getFlakyTestNames = createServerFn({
  method: "GET",
})
  .inputValidator((data: { repo: string }) => data)
  .handler(async ({ data: { repo } }) => {
    const sql = `
			SELECT DISTINCT test_full_name
			FROM (
				SELECT
					test_full_name,
					countIf(test_result = 'fail') as fail_count,
					countIf(test_result = 'pass') as pass_count
				FROM (
					SELECT
						${testFullNameExpr()},
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						ResourceAttributes['vcs.ref.head.revision'] as head_sha,
						anyLast(SpanAttributes['citric.test.result']) as test_result
					FROM otel_traces
					WHERE Timestamp >= now() - INTERVAL 30 DAY
						AND SpanAttributes['citric.test.name'] != ''
						AND SpanAttributes['citric.test.result'] IN ('pass', 'fail')
						AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					GROUP BY test_full_name, run_id, head_sha
				)
				GROUP BY test_full_name
				HAVING fail_count > 0 AND pass_count > 0
			)
		`;

    const result = await query<{ test_full_name: string }>(sql, { repo });
    return result.map((row) => row.test_full_name);
  });
