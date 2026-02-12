import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange } from "@/lib/time-range";
import { type TimeRangeInput, TimeRangeInputSchema } from "./analytics";

export interface DashboardStats {
  totalJobRuns: number;
  successfulRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  successRate: number;
}

export interface Repository {
  name: string;
  totalRuns: number;
  lastRunAt: string;
  successRate: number;
}

export interface RecentActivity {
  date: string;
  runCount: number;
  successCount: number;
  failureCount: number;
}

export const getDashboardStats = createServerFn({
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
			countIf(conclusion = 'cancelled') as cancelledRuns
		FROM (
			SELECT
				ResourceAttributes['cicd.pipeline.run.id'] as run_id,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion
			FROM otel_traces
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

export const getRepositories = createServerFn({
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
			FROM otel_traces
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

export const getRecentActivity = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
		SELECT
			date,
			count(*) as runCount,
			countIf(conclusion = 'success') as successCount,
			countIf(conclusion = 'failure') as failureCount
		FROM (
			SELECT
				toDate(max(Timestamp)) as date,
				ResourceAttributes['cicd.pipeline.run.id'] as run_id,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion
			FROM otel_traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
			GROUP BY run_id
		)
		GROUP BY date
		ORDER BY date DESC
	`;

    const result = await query<{
      date: string;
      runCount: string;
      successCount: string;
      failureCount: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      date: row.date,
      runCount: Number(row.runCount),
      successCount: Number(row.successCount),
      failureCount: Number(row.failureCount),
    })) satisfies RecentActivity[];
  });

// Query options factories
export const dashboardStatsOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "stats", timeRange],
    queryFn: () => getDashboardStats({ data: { timeRange } }),
  });

export const repositoriesOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "repositories", timeRange],
    queryFn: () => getRepositories({ data: { timeRange } }),
  });

export const recentActivityOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["dashboard", "recentActivity", timeRange],
    queryFn: () => getRecentActivity({ data: { timeRange } }),
  });
