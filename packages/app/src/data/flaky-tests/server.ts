import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import { testFullNameExpr } from "../sql-helpers";
import type {
  FlakinessTrendPoint,
  FlakyTest,
  FlakyTestFilterOptions,
  FlakyTestSummary,
  FlakyTestsFilterInput,
  RunnerFlakiness,
  TestDailyResult,
  TestExecution,
} from "./schemas";
import {
  FlakyTestsFilterInputSchema,
  TestDetailInputSchema,
  TestHistoryInputSchema,
} from "./schemas";

function buildFlakyTestConditions(
  fromISO: string,
  toISO: string,
  data: FlakyTestsFilterInput,
): { conditions: string[]; params: Record<string, unknown> } {
  const conditions: string[] = [
    "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
    "SpanAttributes['everr.test.name'] != ''",
    "SpanAttributes['everr.test.result'] IN ('pass', 'fail', 'skip')",
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
  if (data.branch) {
    conditions.push(
      "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
    params.branch = data.branch;
  }
  if (data.search) {
    conditions.push(`${testFullNameExpr(null)} ILIKE {search:String}`);
    params.search = `%${data.search}%`;
  }

  return { conditions, params };
}

export const getFlakyTestFilterOptions = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { clickhouse } }) => {
  const [repos, branches] = await Promise.all([
    clickhouse.query<{ repo: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.repository.name'] as repo
			FROM traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.repository.name'] != ''
				AND SpanAttributes['everr.test.name'] != ''
			ORDER BY repo
			LIMIT 100`,
    ),
    clickhouse.query<{ branch: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
			FROM traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.ref.head.name'] != ''
				AND SpanAttributes['everr.test.name'] != ''
			ORDER BY branch
			LIMIT 100`,
    ),
  ]);

  return {
    repos: repos.map((r) => r.repo),
    branches: branches.map((r) => r.branch),
  } satisfies FlakyTestFilterOptions;
});

export const getFlakyTests = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(FlakyTestsFilterInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { conditions, params } = buildFlakyTestConditions(
      fromISO,
      toISO,
      data,
    );
    const whereClause = conditions.join("\n\t\t\t\t\tAND ");

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
				avg(test_duration) as avg_duration,
				min(timestamp) as first_seen,
				round(
					countIf(test_result = 'fail' AND timestamp >= now() - INTERVAL 7 DAY) * 100.0
					/ nullIf(
						countIf(test_result = 'fail' AND timestamp >= now() - INTERVAL 7 DAY)
						+ countIf(test_result = 'pass' AND timestamp >= now() - INTERVAL 7 DAY),
						0
					),
					1
				) as recent_failure_rate
			FROM (
				SELECT
					ResourceAttributes['vcs.repository.name'] as repo,
					SpanAttributes['everr.test.package'] as test_package,
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['everr.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration,
					max(Timestamp) as timestamp
				FROM traces
				WHERE ${whereClause}
				GROUP BY repo, test_package, test_full_name, run_id, head_sha
			)
			GROUP BY repo, test_package, test_full_name
			HAVING countIf(test_result = 'fail') > 0
				AND countIf(test_result = 'pass') > 0
			ORDER BY failure_rate DESC, total_executions DESC
			LIMIT 50
		`;

    const result = await clickhouse.query<{
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
      first_seen: string;
      recent_failure_rate: string;
    }>(sql, params);

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
      firstSeen: row.first_seen,
      recentFailureRate: Number(row.recent_failure_rate) || 0,
    })) satisfies FlakyTest[];
  });

export const getFlakyTestSummary = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(FlakyTestsFilterInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { conditions, params } = buildFlakyTestConditions(
      fromISO,
      toISO,
      data,
    );
    const whereClause = conditions.join("\n\t\t\t\t\t\tAND ");

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
						SpanAttributes['everr.test.parent_test'] as parent_test,
						SpanAttributes['everr.test.name'] as test_name,
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						ResourceAttributes['vcs.ref.head.revision'] as head_sha,
						anyLast(SpanAttributes['everr.test.result']) as test_result
					FROM traces
					WHERE ${whereClause}
					GROUP BY parent_test, test_name, run_id, head_sha
				)
				GROUP BY test_full_name
			)
		`;

    const result = await clickhouse.query<{
      flaky_test_count: string;
      total_test_count: string;
      flaky_percentage: string;
    }>(sql, params);

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

export const getFlakinessTrend = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(FlakyTestsFilterInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { conditions, params } = buildFlakyTestConditions(
      fromISO,
      toISO,
      data,
    );
    const whereClause = conditions.join("\n\t\t\t\t\t\tAND ");

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
						anyLast(SpanAttributes['everr.test.result']) as test_result,
						max(Timestamp) as timestamp
					FROM traces
					WHERE ${whereClause}
					GROUP BY test_full_name, run_id, head_sha
				)
				GROUP BY date, test_full_name
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await clickhouse.query<{
      date: string;
      flaky_count: string;
      total_count: string;
      flaky_percentage: string;
    }>(sql, params);

    return result.map((row) => ({
      date: row.date,
      flakyCount: Number(row.flaky_count),
      totalCount: Number(row.total_count),
      flakyPercentage: Number(row.flaky_percentage) || 0,
    })) satisfies FlakinessTrendPoint[];
  });

export const getTestHistory = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestHistoryInputSchema)
  .handler(
    async ({
      data: {
        timeRange,
        repo,
        testFullName,
        testModule,
        testName,
        limit = 100,
        offset = 0,
      },
      context: { clickhouse },
    }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);
      const whereConditions = [
        "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
        "SpanAttributes['everr.test.name'] != ''",
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      ];
      const params: Record<string, unknown> = {
        repo,
        fromTime: fromISO,
        toTime: toISO,
        limit,
        offset,
      };

      if (testFullName) {
        whereConditions.push(
          `${testFullNameExpr(null)} = {testFullName:String}`,
        );
        params.testFullName = testFullName;
      }
      if (testModule) {
        whereConditions.push(
          "SpanAttributes['everr.test.parent_test'] = {testModule:String}",
        );
        params.testModule = testModule;
      }
      if (testName) {
        whereConditions.push(
          "SpanAttributes['everr.test.name'] ILIKE {testNamePattern:String}",
        );
        params.testNamePattern = `%${testName}%`;
      }
      const whereClause = whereConditions.join("\n\t\t\t\t\tAND ");

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
					toUInt32OrZero(anyLast(ResourceAttributes['everr.github.workflow_job.run_attempt'])) as run_attempt,
					anyLast(ResourceAttributes['vcs.ref.head.revision']) as head_sha,
					anyLast(ResourceAttributes['vcs.ref.head.name']) as head_branch,
					anyLast(SpanAttributes['everr.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration,
					anyLast(ResourceAttributes['cicd.worker.name']) as runner_name,
					anyLast(ResourceAttributes['cicd.pipeline.name']) as workflow_name,
					anyLast(ResourceAttributes['cicd.pipeline.task.name']) as job_name,
					max(Timestamp) as timestamp
				FROM traces
				WHERE ${whereClause}
				GROUP BY trace_id
			)
			ORDER BY timestamp DESC
			LIMIT {limit:UInt32} OFFSET {offset:UInt32}
		`;

      const result = await clickhouse.query<{
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
      }>(sql, params);

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
    },
  );

export const getRunnerFlakiness = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestDetailInputSchema)
  .handler(
    async ({
      data: { timeRange, repo, testFullName },
      context: { clickhouse },
    }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);

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
					anyLast(SpanAttributes['everr.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration,
					anyLast(ResourceAttributes['cicd.worker.name']) as runner_name
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND SpanAttributes['everr.test.name'] != ''
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ${testFullNameExpr(null)} = {testFullName:String}
					AND SpanAttributes['everr.test.result'] IN ('pass', 'fail')
				GROUP BY run_id, head_sha
			)
			GROUP BY runner_name
			ORDER BY failure_rate DESC, total_executions DESC
		`;

      const result = await clickhouse.query<{
        runner_name: string;
        total_executions: string;
        fail_count: string;
        pass_count: string;
        failure_rate: string;
        avg_duration: string;
      }>(sql, { repo, testFullName, fromTime: fromISO, toTime: toISO });

      return result.map((row) => ({
        runnerName: row.runner_name,
        totalExecutions: Number(row.total_executions),
        failCount: Number(row.fail_count),
        passCount: Number(row.pass_count),
        failureRate: Number(row.failure_rate) || 0,
        avgDuration: Number(row.avg_duration),
      })) satisfies RunnerFlakiness[];
    },
  );

// Daily results for heatmap
export const getTestDailyResults = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestDetailInputSchema)
  .handler(
    async ({
      data: { timeRange, repo, testFullName },
      context: { clickhouse },
    }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);

      const sql = `
			SELECT
				toDate(timestamp) as date,
				countIf(test_result = 'pass') as pass_count,
				countIf(test_result = 'fail') as fail_count,
				countIf(test_result = 'skip') as skip_count
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['everr.test.result']) as test_result,
					max(Timestamp) as timestamp
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND SpanAttributes['everr.test.name'] != ''
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ${testFullNameExpr(null)} = {testFullName:String}
					AND SpanAttributes['everr.test.result'] IN ('pass', 'fail', 'skip')
				GROUP BY run_id, head_sha
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

      const result = await clickhouse.query<{
        date: string;
        pass_count: string;
        fail_count: string;
        skip_count: string;
      }>(sql, { repo, testFullName, fromTime: fromISO, toTime: toISO });

      return result.map((row) => ({
        date: row.date,
        passCount: Number(row.pass_count),
        failCount: Number(row.fail_count),
        skipCount: Number(row.skip_count),
      })) satisfies TestDailyResult[];
    },
  );

// Lightweight lookup for waterfall badge
export const getFlakyTestNames = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ repo: z.string() }))
  .handler(async ({ data: { repo }, context: { clickhouse } }) => {
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
						anyLast(SpanAttributes['everr.test.result']) as test_result
					FROM traces
					WHERE Timestamp >= now() - INTERVAL 30 DAY
						AND SpanAttributes['everr.test.name'] != ''
						AND SpanAttributes['everr.test.result'] IN ('pass', 'fail')
						AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					GROUP BY test_full_name, run_id, head_sha
				)
				GROUP BY test_full_name
				HAVING fail_count > 0 AND pass_count > 0
			)
		`;

    const result = await clickhouse.query<{ test_full_name: string }>(sql, {
      repo,
    });
    return result.map((row) => row.test_full_name);
  });
