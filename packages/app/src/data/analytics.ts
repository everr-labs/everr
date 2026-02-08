import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";

export type TimeRange = "7d" | "14d" | "30d" | "90d";

export interface TimeRangeInput {
  timeRange: TimeRange;
}

export function timeRangeToDays(range: TimeRange): number {
  const mapping: Record<TimeRange, number> = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
  };
  return mapping[range];
}

// Duration Trends
export interface DurationTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  runCount: number;
}

export const getDurationTrends = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				toDate(Timestamp) as date,
				avg(Duration) / 1000000 as avgDuration,
				quantile(0.5)(Duration) / 1000000 as p50Duration,
				quantile(0.95)(Duration) / 1000000 as p95Duration,
				count(*) as runCount
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL ${days} DAY
				AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
				AND SpanAttributes['citric.test.name'] = ''
			GROUP BY date
			ORDER BY date ASC
		`;

    const result = await query<{
      date: string;
      avgDuration: string;
      p50Duration: string;
      p95Duration: string;
      runCount: string;
    }>(sql);

    return result.map((row) => ({
      date: row.date,
      avgDuration: Number(row.avgDuration),
      p50Duration: Number(row.p50Duration),
      p95Duration: Number(row.p95Duration),
      runCount: Number(row.runCount),
    })) satisfies DurationTrendPoint[];
  });

// Queue Time Analysis
export interface QueueTimePoint {
  date: string;
  avgQueueTime: number;
  p50QueueTime: number;
  p95QueueTime: number;
  maxQueueTime: number;
}

export const getQueueTimeAnalysis = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				toDate(Timestamp) as date,
				avg(
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.started_at'])) -
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.created_at']))
				) * 1000 as avgQueueTime,
				quantile(0.5)(
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.started_at'])) -
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.created_at']))
				) * 1000 as p50QueueTime,
				quantile(0.95)(
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.started_at'])) -
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.created_at']))
				) * 1000 as p95QueueTime,
				max(
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.started_at'])) -
					toUnixTimestamp(parseDateTimeBestEffort(ResourceAttributes['citric.github.workflow_job.created_at']))
				) * 1000 as maxQueueTime
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL ${days} DAY
				AND ResourceAttributes['citric.github.workflow_job.created_at'] != ''
				AND ResourceAttributes['citric.github.workflow_job.started_at'] != ''
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
			GROUP BY date
			ORDER BY date ASC
		`;

    const result = await query<{
      date: string;
      avgQueueTime: string;
      p50QueueTime: string;
      p95QueueTime: string;
      maxQueueTime: string;
    }>(sql);

    return result.map((row) => ({
      date: row.date,
      avgQueueTime: Math.max(0, Number(row.avgQueueTime)),
      p50QueueTime: Math.max(0, Number(row.p50QueueTime)),
      p95QueueTime: Math.max(0, Number(row.p95QueueTime)),
      maxQueueTime: Math.max(0, Number(row.maxQueueTime)),
    })) satisfies QueueTimePoint[];
  });

// Success Rate Trends
export interface SuccessRatePoint {
  date: string;
  successRate: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
}

export const getSuccessRateTrends = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

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
				WHERE Timestamp >= now() - INTERVAL ${days} DAY
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				GROUP BY run_id
			)
			GROUP BY date
			ORDER BY date ASC
		`;

    const result = await query<{
      date: string;
      successRate: string;
      totalRuns: string;
      successCount: string;
      failureCount: string;
    }>(sql);

    return result.map((row) => ({
      date: row.date,
      successRate: Number(row.successRate) || 0,
      totalRuns: Number(row.totalRuns),
      successCount: Number(row.successCount),
      failureCount: Number(row.failureCount),
    })) satisfies SuccessRatePoint[];
  });

// Runner Utilization
export interface RunnerUtilization {
  labels: string;
  totalJobs: number;
  avgDuration: number;
  successRate: number;
  totalDuration: number;
}

export const getRunnerUtilization = createServerFn({
  method: "GET",
})
  .inputValidator((data: TimeRangeInput) => data)
  .handler(async ({ data: { timeRange } }) => {
    const days = timeRangeToDays(timeRange);

    const sql = `
			SELECT
				ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
				count(*) as totalJobs,
				avg(Duration) / 1000000 as avgDuration,
				round(countIf(ResourceAttributes['cicd.pipeline.task.run.result'] = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate,
				sum(Duration) / 1000000 as totalDuration
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL ${days} DAY
				AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
			GROUP BY labels
			ORDER BY totalJobs DESC
			LIMIT 20
		`;

    const result = await query<{
      labels: string;
      totalJobs: string;
      avgDuration: string;
      successRate: string;
      totalDuration: string;
    }>(sql);

    return result.map((row) => ({
      labels: row.labels,
      totalJobs: Number(row.totalJobs),
      avgDuration: Number(row.avgDuration),
      successRate: Number(row.successRate) || 0,
      totalDuration: Number(row.totalDuration),
    })) satisfies RunnerUtilization[];
  });
