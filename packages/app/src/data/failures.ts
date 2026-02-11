import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange } from "@/lib/time-range";
import { type TimeRangeInput, TimeRangeInputSchema } from "./analytics";

export interface FailurePattern {
  pattern: string;
  count: number;
  affectedRepos: string[];
  sampleTraceIds: string[];
  sampleRunIds: string[];
  sampleJobNames: string[];
  lastOccurrence: string;
}

export const getFailurePatterns = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				lower(trim(substring(StatusMessage, 1, 200))) as pattern,
				count(*) as count,
				groupUniqArray(10)(ResourceAttributes['vcs.repository.name']) as affectedRepos,
				groupArray(10)(TraceId) as sampleTraceIds,
				groupArray(10)(ResourceAttributes['cicd.pipeline.run.id']) as sampleRunIds,
				groupArray(10)(ResourceAttributes['cicd.pipeline.task.name']) as sampleJobNames,
				max(Timestamp) as lastOccurrence
			FROM otel_traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
				AND StatusMessage != ''
			GROUP BY pattern
			ORDER BY count DESC
			LIMIT 30
		`;

    const result = await query<{
      pattern: string;
      count: string;
      affectedRepos: string[];
      sampleTraceIds: string[];
      sampleRunIds: string[];
      sampleJobNames: string[];
      lastOccurrence: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      pattern: row.pattern,
      count: Number(row.count),
      affectedRepos: row.affectedRepos,
      sampleTraceIds: row.sampleTraceIds,
      sampleRunIds: row.sampleRunIds,
      sampleJobNames: row.sampleJobNames,
      lastOccurrence: row.lastOccurrence,
    })) satisfies FailurePattern[];
  });

export interface FailureTrendPoint {
  date: string;
  totalFailures: number;
  uniquePatterns: number;
}

export const getFailureTrend = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				toDate(Timestamp) as date,
				count(*) as totalFailures,
				uniqExact(lower(trim(substring(StatusMessage, 1, 200)))) as uniquePatterns
			FROM otel_traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
				AND StatusMessage != ''
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await query<{
      date: string;
      totalFailures: string;
      uniquePatterns: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      date: row.date,
      totalFailures: Number(row.totalFailures),
      uniquePatterns: Number(row.uniquePatterns),
    })) satisfies FailureTrendPoint[];
  });

export interface FailureByRepo {
  repo: string;
  failureCount: number;
  topPattern: string;
}

export const getFailuresByRepo = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
			SELECT
				ResourceAttributes['vcs.repository.name'] as repo,
				count(*) as failureCount,
				topK(1)(lower(trim(substring(StatusMessage, 1, 200)))) as topPatterns
			FROM otel_traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
				AND StatusMessage != ''
				AND ResourceAttributes['vcs.repository.name'] != ''
			GROUP BY repo
			ORDER BY failureCount DESC
			LIMIT 20
		`;

    const result = await query<{
      repo: string;
      failureCount: string;
      topPatterns: string[];
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      repo: row.repo,
      failureCount: Number(row.failureCount),
      topPattern: row.topPatterns[0] || "",
    })) satisfies FailureByRepo[];
  });

// Query options factories
export const failurePatternsOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["failures", "patterns", input],
    queryFn: () => getFailurePatterns({ data: input }),
    staleTime: 60_000,
  });

export const failureTrendOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["failures", "trend", input],
    queryFn: () => getFailureTrend({ data: input }),
    staleTime: 60_000,
  });

export const failuresByRepoOptions = (input: TimeRangeInput) =>
  queryOptions({
    queryKey: ["failures", "byRepo", input],
    queryFn: () => getFailuresByRepo({ data: input }),
    staleTime: 60_000,
  });
