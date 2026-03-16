import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import { query } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import type {
  DashboardDurationStats,
  DashboardStats,
  Repository,
  TopFailingJob,
  TopFailingWorkflow,
} from "./schemas";

export const getDashboardStats = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
		SELECT
			count(*) as totalJobRuns,
			countIf(conclusion = 'success') as successfulRuns,
			countIf(conclusion = 'failure') as failedRuns,
			countIf(conclusion = 'cancellation') as cancelledRuns
		FROM (
			SELECT
				ResourceAttributes['cicd.pipeline.run.id'] as run_id,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion
			FROM traces
			WHERE ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				AND Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
			GROUP BY run_id
		)
	`;

    const result = await query<{
      totalJobRuns: string;
      successfulRuns: string;
      failedRuns: string;
      cancelledRuns: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    if (result.length === 0) {
      return {
        totalJobRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        successRate: 0,
      } satisfies DashboardStats;
    }

    const stats = result[0];
    const total = Number(stats.totalJobRuns);
    const successful = Number(stats.successfulRuns);

    return {
      totalJobRuns: total,
      successfulRuns: successful,
      failedRuns: Number(stats.failedRuns),
      cancelledRuns: Number(stats.cancelledRuns),
      successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
    } satisfies DashboardStats;
  });

export const getRepositories = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
		SELECT
			name,
			count(*) as totalRuns,
			max(lastRunAt) as lastRunAt,
			round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate
		FROM (
			SELECT
				ResourceAttributes['vcs.repository.name'] as name,
				ResourceAttributes['cicd.pipeline.run.id'] as run_id,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
				max(Timestamp) as lastRunAt
			FROM traces
			WHERE ResourceAttributes['vcs.repository.name'] != ''
				AND ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				AND Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
			GROUP BY name, run_id
		)
		GROUP BY name
		ORDER BY lastRunAt DESC
		LIMIT 10
	`;

    const result = await query<{
      name: string;
      totalRuns: string;
      lastRunAt: string;
      successRate: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      name: row.name,
      totalRuns: Number(row.totalRuns),
      lastRunAt: row.lastRunAt,
      successRate: Number(row.successRate) || 0,
    })) satisfies Repository[];
  });

export const getDashboardDurationStats = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
		SELECT
			avg(Duration) / 1000000 as avgDuration,
			quantile(0.95)(Duration) / 1000000 as p95Duration
		FROM traces
		WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
			AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
			AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
			AND SpanAttributes['everr.test.name'] = ''
	`;

    const result = await query<{
      avgDuration: string;
      p95Duration: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    if (result.length === 0) {
      return {
        avgDuration: 0,
        p95Duration: 0,
      } satisfies DashboardDurationStats;
    }

    return {
      avgDuration: Number(result[0].avgDuration),
      p95Duration: Number(result[0].p95Duration),
    } satisfies DashboardDurationStats;
  });

export const getTopFailingJobs = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
		SELECT
			ResourceAttributes['cicd.pipeline.task.name'] as jobName,
			ResourceAttributes['vcs.repository.name'] as repo,
			count(*) as failureCount
		FROM traces
		WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
			AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
			AND ResourceAttributes['cicd.pipeline.task.name'] != ''
			AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
			AND SpanAttributes['everr.test.name'] = ''
		GROUP BY jobName, repo
		ORDER BY failureCount DESC
		LIMIT 5
	`;

    const result = await query<{
      jobName: string;
      repo: string;
      failureCount: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      jobName: row.jobName,
      repo: row.repo,
      failureCount: Number(row.failureCount),
    })) satisfies TopFailingJob[];
  });

export const getTopFailingWorkflows = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
		SELECT
			workflowName,
			repo,
			count(*) as failureCount
		FROM (
			SELECT
				ResourceAttributes['cicd.pipeline.run.id'] as runId,
				anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
				anyLast(ResourceAttributes['vcs.repository.name']) as repo,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
			GROUP BY runId
		)
		WHERE conclusion = 'failure'
		GROUP BY workflowName, repo
		ORDER BY failureCount DESC
		LIMIT 5
	`;

    const result = await query<{
      workflowName: string;
      repo: string;
      failureCount: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      workflowName: row.workflowName,
      repo: row.repo,
      failureCount: Number(row.failureCount),
    })) satisfies TopFailingWorkflow[];
  });
