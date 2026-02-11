import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";

const RepoDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string(),
});
export type RepoDetailInput = z.infer<typeof RepoDetailInputSchema>;

export interface RepoStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
}

export const getRepoStats = createServerFn({
  method: "GET",
})
  .inputValidator(RepoDetailInputSchema)
  .handler(async ({ data: { timeRange, repo } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				count(*) as totalRuns,
				round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate,
				avg(duration) as avgDuration
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
					max(Duration) / 1000000 as duration
				FROM otel_traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				GROUP BY run_id
			)
		`;

    const result = await query<{
      totalRuns: string;
      successRate: string;
      avgDuration: string;
    }>(sql, { repo, fromTime: fromISO, toTime: toISO });

    if (result.length === 0) {
      return {
        totalRuns: 0,
        successRate: 0,
        avgDuration: 0,
      } satisfies RepoStats;
    }

    return {
      totalRuns: Number(result[0].totalRuns),
      successRate: Number(result[0].successRate) || 0,
      avgDuration: Number(result[0].avgDuration),
    } satisfies RepoStats;
  });

export interface RepoSuccessRatePoint {
  date: string;
  successRate: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
}

export const getRepoSuccessRateTrend = createServerFn({
  method: "GET",
})
  .inputValidator(RepoDetailInputSchema)
  .handler(async ({ data: { timeRange, repo } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				date,
				round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate,
				count(*) as totalRuns,
				countIf(conclusion = 'success') as successCount,
				countIf(conclusion = 'failure') as failureCount
			FROM (
				SELECT
					toDate(max(Timestamp)) as date,
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion
				FROM otel_traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				GROUP BY run_id
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await query<{
      date: string;
      successRate: string;
      totalRuns: string;
      successCount: string;
      failureCount: string;
    }>(sql, { repo, fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      date: row.date,
      successRate: Number(row.successRate) || 0,
      totalRuns: Number(row.totalRuns),
      successCount: Number(row.successCount),
      failureCount: Number(row.failureCount),
    })) satisfies RepoSuccessRatePoint[];
  });

export interface RepoDurationPoint {
  date: string;
  p50Duration: number;
  p95Duration: number;
}

export const getRepoDurationTrend = createServerFn({
  method: "GET",
})
  .inputValidator(RepoDetailInputSchema)
  .handler(async ({ data: { timeRange, repo } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				toDate(Timestamp) as date,
				quantile(0.5)(Duration) / 1000000 as p50Duration,
				quantile(0.95)(Duration) / 1000000 as p95Duration
			FROM otel_traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['vcs.repository.name'] = {repo:String}
				AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
				AND SpanAttributes['citric.test.name'] = ''
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await query<{
      date: string;
      p50Duration: string;
      p95Duration: string;
    }>(sql, { repo, fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      date: row.date,
      p50Duration: Number(row.p50Duration),
      p95Duration: Number(row.p95Duration),
    })) satisfies RepoDurationPoint[];
  });

export interface RepoRecentRun {
  traceId: string;
  runId: string;
  workflowName: string;
  branch: string;
  conclusion: string;
  timestamp: string;
  sender: string;
}

export const getRepoRecentRuns = createServerFn({
  method: "GET",
})
  .inputValidator(RepoDetailInputSchema)
  .handler(async ({ data: { timeRange, repo } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				TraceId as trace_id,
				anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
				anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
				anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
				max(Timestamp) as timestamp,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.sender.login']) as sender
			FROM otel_traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['vcs.repository.name'] = {repo:String}
				AND ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
				AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
			GROUP BY trace_id
			ORDER BY timestamp DESC
			LIMIT 20
		`;

    const result = await query<{
      trace_id: string;
      run_id: string;
      workflowName: string;
      branch: string;
      conclusion: string;
      timestamp: string;
      sender: string;
    }>(sql, { repo, fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      traceId: row.trace_id,
      runId: row.run_id,
      workflowName: row.workflowName || "Workflow",
      branch: row.branch,
      conclusion: row.conclusion,
      timestamp: row.timestamp,
      sender: row.sender,
    })) satisfies RepoRecentRun[];
  });

export interface TopFailingJob {
  jobName: string;
  workflowName: string;
  totalRuns: number;
  failureCount: number;
  failureRate: number;
}

export const getTopFailingJobs = createServerFn({
  method: "GET",
})
  .inputValidator(RepoDetailInputSchema)
  .handler(async ({ data: { timeRange, repo } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				ResourceAttributes['cicd.pipeline.task.name'] as jobName,
				anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
				count(*) as totalRuns,
				countIf(ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure') as failureCount,
				round(
					countIf(ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure') * 100.0
					/ nullIf(count(*), 0),
					1
				) as failureRate
			FROM otel_traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['vcs.repository.name'] = {repo:String}
				AND ResourceAttributes['cicd.pipeline.task.name'] != ''
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
			GROUP BY jobName
			HAVING failureCount > 0
			ORDER BY failureCount DESC
			LIMIT 10
		`;

    const result = await query<{
      jobName: string;
      workflowName: string;
      totalRuns: string;
      failureCount: string;
      failureRate: string;
    }>(sql, { repo, fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      jobName: row.jobName,
      workflowName: row.workflowName,
      totalRuns: Number(row.totalRuns),
      failureCount: Number(row.failureCount),
      failureRate: Number(row.failureRate) || 0,
    })) satisfies TopFailingJob[];
  });

export interface ActiveBranch {
  branch: string;
  latestConclusion: string;
  latestTraceId: string;
  latestRunId: string;
  latestTimestamp: string;
  totalRuns: number;
  successRate: number;
}

export const getActiveBranches = createServerFn({
  method: "GET",
})
  .inputValidator(RepoDetailInputSchema)
  .handler(async ({ data: { timeRange, repo } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				branch,
				argMax(conclusion, timestamp) as latestConclusion,
				argMax(trace_id, timestamp) as latestTraceId,
				argMax(run_id, timestamp) as latestRunId,
				max(timestamp) as latestTimestamp,
				count(*) as totalRuns,
				round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate
			FROM (
				SELECT
					ResourceAttributes['vcs.ref.head.name'] as branch,
					TraceId as trace_id,
					anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
					max(Timestamp) as timestamp
				FROM otel_traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				GROUP BY branch, trace_id
			)
			GROUP BY branch
			ORDER BY latestTimestamp DESC
			LIMIT 20
		`;

    const result = await query<{
      branch: string;
      latestConclusion: string;
      latestTraceId: string;
      latestRunId: string;
      latestTimestamp: string;
      totalRuns: string;
      successRate: string;
    }>(sql, { repo, fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      branch: row.branch,
      latestConclusion: row.latestConclusion,
      latestTraceId: row.latestTraceId,
      latestRunId: row.latestRunId,
      latestTimestamp: row.latestTimestamp,
      totalRuns: Number(row.totalRuns),
      successRate: Number(row.successRate) || 0,
    })) satisfies ActiveBranch[];
  });

// Query options factories
export const repoStatsOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "stats", input],
    queryFn: () => getRepoStats({ data: input }),
    staleTime: 60_000,
  });

export const repoSuccessRateTrendOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "successRateTrend", input],
    queryFn: () => getRepoSuccessRateTrend({ data: input }),
    staleTime: 60_000,
  });

export const repoDurationTrendOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "durationTrend", input],
    queryFn: () => getRepoDurationTrend({ data: input }),
    staleTime: 60_000,
  });

export const repoRecentRunsOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "recentRuns", input],
    queryFn: () => getRepoRecentRuns({ data: input }),
    staleTime: 60_000,
  });

export const topFailingJobsOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "topFailingJobs", input],
    queryFn: () => getTopFailingJobs({ data: input }),
    staleTime: 60_000,
  });

export const activeBranchesOptions = (input: RepoDetailInput) =>
  queryOptions({
    queryKey: ["repo", "activeBranches", input],
    queryFn: () => getActiveBranches({ data: input }),
    staleTime: 60_000,
  });
