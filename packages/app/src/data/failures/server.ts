import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import type {
  FailureByRepo,
  FailurePattern,
  FailureTrendPoint,
} from "./schemas";

export const getFailurePatterns = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(
    async ({
      data: { timeRange },
      context: {
        clickhouse: { query },
      },
    }) => {
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
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
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
    },
  );

export const getFailureTrend = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(
    async ({
      data: { timeRange },
      context: {
        clickhouse: { query },
      },
    }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);

      const sql = `
			SELECT
				toDate(Timestamp) as date,
				count(*) as totalFailures,
				uniqExact(lower(trim(substring(StatusMessage, 1, 200)))) as uniquePatterns
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
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
    },
  );

export const getFailuresByRepo = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(
    async ({
      data: { timeRange },
      context: {
        clickhouse: { query },
      },
    }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);

      const sql = `
			SELECT
				ResourceAttributes['vcs.repository.name'] as repo,
				count(*) as failureCount,
				topK(1)(lower(trim(substring(StatusMessage, 1, 200)))) as topPatterns
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
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
    },
  );
