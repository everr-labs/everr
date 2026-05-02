import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import {
  type DurationTrendPoint,
  type SuccessRatePoint,
  TimeRangeInputSchema,
} from "./schemas";

// Duration Trends
export const getDurationTrends = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				toDate(Timestamp) as date,
				avg(Duration) / 1000000 as avgDuration,
				quantile(0.5)(Duration) / 1000000 as p50Duration,
				quantile(0.95)(Duration) / 1000000 as p95Duration,
				count(*) as runCount
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
				AND SpanAttributes['everr.test.name'] = ''
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await clickhouse.query<{
      date: string;
      avgDuration: string;
      p50Duration: string;
      p95Duration: string;
      runCount: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      date: row.date,
      avgDuration: Number(row.avgDuration),
      p50Duration: Number(row.p50Duration),
      p95Duration: Number(row.p95Duration),
      runCount: Number(row.runCount),
    })) satisfies DurationTrendPoint[];
  });

// Success Rate Trends
export const getSuccessRateTrends = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
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
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				GROUP BY run_id
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await clickhouse.query<{
      date: string;
      successRate: string;
      totalRuns: string;
      successCount: string;
      failureCount: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      date: row.date,
      successRate: Number(row.successRate) || 0,
      totalRuns: Number(row.totalRuns),
      successCount: Number(row.successCount),
      failureCount: Number(row.failureCount),
    })) satisfies SuccessRatePoint[];
  });
