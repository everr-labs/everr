import { z } from "zod";
import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import { pool } from "@/db/client";
import type { AuthContext } from "@/lib/auth-context";
import { normalizeTimestampToUtc } from "@/lib/formatting";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import { runSummarySubquery } from "../run-query-helpers";
import type { Job, LogEntry, Run, Span, Step } from "./schemas";

const DEFAULT_LOG_PAGE_SIZE = 1000;

function normalizeConclusion(conclusion: string | null): string {
  if (!conclusion) return "unknown";
  if (conclusion === "cancelled") return "cancellation";
  return conclusion;
}
const MAX_LOG_PAGE_SIZE = 5000;
const TEST_RESULT_TO_CONCLUSION: Record<string, string> = {
  pass: "success",
  fail: "failure",
  skip: "skip",
};

function mapLogRow(row: { timestamp: string; body: string }): LogEntry {
  return {
    timestamp: normalizeTimestampToUtc(row.timestamp),
    body: row.body,
  };
}

async function countStepLogs(
  context: AuthContext,
  params: { traceId: string; jobName: string; stepNumber: string },
): Promise<number> {
  const sql = `
    SELECT count() as cnt
    FROM logs
    WHERE TraceId = {traceId:String}
      AND ScopeAttributes['cicd.pipeline.task.name'] = {jobName:String}
      AND LogAttributes['everr.github.workflow_job_step.number'] = {stepNumber:String}
  `;
  const result = await context.clickhouse.query<{ cnt: string }>(sql, params);
  return result.length > 0 ? Number(result[0].cnt) : 0;
}

async function getRawStepLogs(
  context: AuthContext,
  params: {
    traceId: string;
    jobName: string;
    stepNumber: string;
    maxLines?: number;
    offsetLines?: number;
    useTail?: boolean;
  },
): Promise<LogEntry[]> {
  const clickhouse = context.clickhouse;
  const order = params.useTail ? "DESC" : "ASC";
  const limitClause =
    typeof params.maxLines === "number" ? "LIMIT {maxLines:UInt32}" : "";
  const offsetClause =
    typeof params.offsetLines === "number" ? "OFFSET {offsetLines:UInt32}" : "";
  const sql = `
		SELECT
			Timestamp as timestamp,
			Body as body
		FROM logs
		WHERE TraceId = {traceId:String}
			AND ScopeAttributes['cicd.pipeline.task.name'] = {jobName:String}
			AND LogAttributes['everr.github.workflow_job_step.number'] = {stepNumber:String}
		ORDER BY Timestamp ${order}
		${limitClause}
		${offsetClause}
	`;

  const result = await clickhouse.query<{
    timestamp: string;
    body: string;
  }>(sql, {
    traceId: params.traceId,
    jobName: params.jobName,
    stepNumber: params.stepNumber,
    maxLines: params.maxLines,
    offsetLines: params.offsetLines,
  });

  const logs = result.map(mapLogRow);

  return params.useTail ? logs.reverse() : logs;
}

export const getLatestRuns = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);
    const runSummarySql = runSummarySubquery({
      whereClause: `ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
				AND SpanAttributes['everr.test.name'] = ''
				AND Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}`,
      groupByExpr: "TraceId",
      groupByAlias: "trace_id",
      includeRunAttempt: true,
    });

    const sql = `
      SELECT *
      FROM (${runSummarySql})
		ORDER BY timestamp DESC
		LIMIT 10
	`;

    const result = await clickhouse.query<{
      trace_id: string;
      run_id: string;
      run_attempt: string;
      repo: string;
      branch: string;
      conclusion: string;
      workflowName: string;
      timestamp: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    return result.map((row) => ({
      traceId: row.trace_id,
      runId: row.run_id,
      runAttempt: Number(row.run_attempt),
      repo: row.repo,
      branch: row.branch,
      conclusion: row.conclusion,
      workflowName: row.workflowName || "Workflow",
      timestamp: row.timestamp,
    })) satisfies Run[];
  });

export const getRunDetails = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.string())
  .handler(async ({ data: traceId, context: { clickhouse, session } }) => {
    const [chResult, pgResult] = await Promise.all([
      clickhouse.query<{
        run_id: string;
        run_attempt: string;
        repo: string;
        branch: string;
        conclusion: string;
        workflowName: string;
        timestamp: string;
        pullRequestsUrl: string;
      }>(
        `SELECT
            anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
            anyLast(toUInt32OrZero(ResourceAttributes['everr.github.workflow_job.run_attempt'])) as run_attempt,
            anyLast(ResourceAttributes['vcs.repository.name']) as repo,
            anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
            coalesce(nullIf(argMaxIf(ResourceAttributes['cicd.pipeline.result'], Timestamp, ResourceAttributes['cicd.pipeline.result'] != ''), ''), argMaxIf(ResourceAttributes['cicd.pipeline.task.run.result'], Timestamp, ResourceAttributes['cicd.pipeline.task.run.result'] != '')) as conclusion,
            anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
            max(Timestamp) as timestamp,
            anyLast(ResourceAttributes['everr.git.pull_requests.url']) as pullRequestsUrl
          FROM traces
          WHERE TraceId = {traceId:String}`,
        { traceId },
      ),
      pool.query<{
        runId: string;
        runAttempt: number;
        workflowName: string;
        repo: string;
        branch: string;
        status: string;
        conclusion: string | null;
        startedAt: string | null;
        lastEventAt: string;
        htmlUrl: string | null;
        pullRequestNumbers: number[] | null;
      }>(
        `SELECT
           run_id::text AS "runId",
           attempts AS "runAttempt",
           workflow_name AS "workflowName",
           repository AS repo,
           ref AS branch,
           status,
           conclusion,
           run_started_at::text AS "startedAt",
           last_event_at::text AS "lastEventAt",
           metadata->>'html_url' AS "htmlUrl",
           ARRAY(SELECT jsonb_array_elements_text(metadata->'pull_requests')::int) AS "pullRequestNumbers"
         FROM workflow_runs
         WHERE tenant_id = $1 AND trace_id = $2`,
        [session.tenantId, traceId],
      ),
    ]);

    const ch = chResult.length > 0 && chResult[0].run_id ? chResult[0] : null;
    const pg = pgResult.rows[0] ?? null;

    if (!ch && !pg) return null;

    // Prefer ClickHouse for telemetry data, Postgres for live status
    if (ch) {
      const pgConclusion =
        pg && pg.status === "completed"
          ? normalizeConclusion(pg.conclusion)
          : pg?.status;

      return {
        traceId,
        runId: ch.run_id,
        runAttempt: Number(ch.run_attempt),
        repo: ch.repo,
        branch: ch.branch,
        conclusion: pgConclusion ?? ch.conclusion,
        workflowName: ch.workflowName || "Workflow",
        timestamp: ch.timestamp,
        htmlUrl: `https://github.com/${ch.repo}/actions/runs/${ch.run_id}`,
        pullRequestUrls: ch.pullRequestsUrl
          ? ch.pullRequestsUrl.split(";")
          : undefined,
      } satisfies Run;
    }

    // Fallback to Postgres when ClickHouse has no spans yet (fully in-progress run)
    // pg is guaranteed non-null: early return on !ch && !pg, and ch is falsy here
    if (!pg) return null;

    const effectiveConclusion =
      pg.status === "completed"
        ? normalizeConclusion(pg.conclusion)
        : pg.status;

    const pullRequestUrls = pg.pullRequestNumbers?.length
      ? pg.pullRequestNumbers.map(
          (n) => `https://github.com/${pg.repo}/pull/${n}`,
        )
      : undefined;

    return {
      traceId,
      runId: pg.runId,
      runAttempt: pg.runAttempt,
      repo: pg.repo,
      branch: pg.branch,
      conclusion: effectiveConclusion,
      workflowName: pg.workflowName || "Workflow",
      timestamp: pg.startedAt ?? pg.lastEventAt,
      htmlUrl: pg.htmlUrl ?? undefined,
      pullRequestUrls,
    } satisfies Run;
  });

export const getRunJobs = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.string())
  .handler(async ({ data: traceId, context: { clickhouse, session } }) => {
    const [chResult, pgResult] = await Promise.all([
      clickhouse.query<{
        jobId: string;
        name: string;
        conclusion: string;
        duration: string;
      }>(
        `SELECT
            ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
            anyLast(ResourceAttributes['cicd.pipeline.task.name']) as name,
            anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
            max(Duration) / 1000000 as duration
          FROM traces
          WHERE TraceId = {traceId:String}
            AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
          GROUP BY jobId
          ORDER BY min(Timestamp)`,
        { traceId },
      ),
      pool.query<{
        jobId: string;
        name: string;
        status: string;
        conclusion: string | null;
      }>(
        `SELECT job_id::text AS "jobId", job_name AS name, status, conclusion
         FROM workflow_jobs
         WHERE tenant_id = $1 AND trace_id = $2
         ORDER BY started_at NULLS LAST, job_name`,
        [session.tenantId, traceId],
      ),
    ]);

    const chJobs = chResult.map((row) => ({
      jobId: row.jobId,
      name: row.name,
      conclusion: row.conclusion,
      duration: Number(row.duration),
    }));

    // Append jobs from Postgres that aren't yet in ClickHouse
    // (covers both in-progress jobs and recently completed jobs pending ingestion)
    const chJobIds = new Set(chJobs.map((j) => j.jobId));
    const pgOnlyJobs = pgResult.rows
      .filter((j) => !chJobIds.has(j.jobId))
      .map((j) => ({
        jobId: j.jobId,
        name: j.name,
        conclusion:
          j.status === "completed"
            ? normalizeConclusion(j.conclusion)
            : j.status,
        duration: 0,
      }));

    return [...chJobs, ...pgOnlyJobs] satisfies Job[];
  });

export const getJobSteps = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ traceId: z.string(), jobId: z.string() }))
  .handler(async ({ data: { traceId, jobId }, context: { clickhouse } }) => {
    const sql = `
			SELECT
					SpanName as name,
					SpanAttributes['everr.github.workflow_job_step.number'] as stepNumber,
					StatusMessage as conclusion,
					Duration / 1000000 as duration,
					toUnixTimestamp64Milli(Timestamp) as startTime,
					toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000) as endTime
			FROM traces
			WHERE TraceId = {traceId:String}
				AND ResourceAttributes['cicd.pipeline.task.run.id'] = {jobId:String}
				AND SpanAttributes['everr.github.workflow_job_step.number'] != ''
			ORDER BY toUInt32OrZero(stepNumber)
		`;

    const result = await clickhouse.query<{
      name: string;
      stepNumber: string;
      conclusion: string;
      duration: string;
      startTime: string;
      endTime: string;
    }>(sql, { traceId, jobId });

    return result.map((row) => ({
      stepNumber: row.stepNumber,
      name: row.name,
      conclusion: row.conclusion,
      duration: Number(row.duration),
      startTime: Number(row.startTime),
      endTime: Number(row.endTime),
    })) satisfies Step[];
  });

export const getAllJobsSteps = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({ traceId: z.string(), jobIds: z.array(z.string()) }),
  )
  .handler(async ({ data: { traceId, jobIds }, context: { clickhouse } }) => {
    if (jobIds.length === 0) {
      return {};
    }

    const result: Record<string, Step[]> = {};
    const sql = `
      SELECT
        ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
        SpanName as name,
        SpanAttributes['everr.github.workflow_job_step.number'] as stepNumber,
        StatusMessage as conclusion,
        Duration / 1000000 as duration,
        toUnixTimestamp64Milli(Timestamp) as startTime,
        toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000) as endTime
      FROM traces
      WHERE TraceId = {traceId:String}
        AND ResourceAttributes['cicd.pipeline.task.run.id'] IN {jobIds:Array(String)}
        AND SpanAttributes['everr.github.workflow_job_step.number'] != ''
      ORDER BY jobId, toUInt32OrZero(stepNumber)
    `;
    const rows = await clickhouse.query<{
      jobId: string;
      name: string;
      stepNumber: string;
      conclusion: string;
      duration: string;
      startTime: string;
      endTime: string;
    }>(sql, { traceId, jobIds });

    for (const row of rows) {
      if (!result[row.jobId]) {
        result[row.jobId] = [];
      }
      result[row.jobId].push({
        stepNumber: row.stepNumber,
        name: row.name,
        conclusion: row.conclusion,
        duration: Number(row.duration),
        startTime: Number(row.startTime),
        endTime: Number(row.endTime),
      });
    }

    return result;
  });

export const getStepLogs = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      traceId: z.string(),
      jobName: z.string(),
      stepNumber: z.string(),
      tail: z.number().int().min(1).max(MAX_LOG_PAGE_SIZE).optional(),
      limit: z.number().int().min(1).max(MAX_LOG_PAGE_SIZE).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const totalCount = await countStepLogs(context, {
      traceId: data.traceId,
      jobName: data.jobName,
      stepNumber: data.stepNumber,
    });

    if (
      data.tail !== undefined ||
      (data.limit === undefined && data.offset === undefined)
    ) {
      const maxLines = data.tail ?? DEFAULT_LOG_PAGE_SIZE;
      const logs = await getRawStepLogs(context, {
        traceId: data.traceId,
        jobName: data.jobName,
        stepNumber: data.stepNumber,
        maxLines,
        offsetLines: data.offset,
        useTail: true,
      });
      const startOffset = Math.max(0, totalCount - maxLines);
      return { logs, totalCount, offset: startOffset };
    }

    const offset = data.offset ?? 0;
    const logs = await getRawStepLogs(context, {
      traceId: data.traceId,
      jobName: data.jobName,
      stepNumber: data.stepNumber,
      maxLines: data.limit ?? DEFAULT_LOG_PAGE_SIZE,
      offsetLines: offset,
    });
    return { logs, totalCount, offset };
  });

export const getRunSpans = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.string())
  .handler(async ({ data: traceId, context: { clickhouse } }) => {
    const sql = `
			SELECT
				SpanId as spanId,
				ParentSpanId as parentSpanId,
				SpanName as name,
				toUnixTimestamp64Milli(Timestamp) as startTime,
				toUnixTimestamp64Milli(Timestamp) + if(lowerUTF8(StatusMessage) = 'skip', toUInt64(0), intDiv(Duration, 1000000)) as endTime,
				if(lowerUTF8(StatusMessage) = 'skip', toUInt64(0), intDiv(Duration, 1000000)) as duration,
				StatusMessage as conclusion,
				ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
				ResourceAttributes['cicd.pipeline.task.name'] as jobName,
				SpanAttributes['everr.github.workflow_job_step.number'] as stepNumber,
				ResourceAttributes['everr.github.workflow_job.created_at'] as createdAt,
				ResourceAttributes['everr.github.workflow_job.started_at'] as startedAt,
				ResourceAttributes['vcs.ref.head.name'] as headBranch,
				ResourceAttributes['vcs.ref.head.revision'] as headSha,
				ResourceAttributes['cicd.worker.name'] as runnerName,
				ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
				ResourceAttributes['cicd.pipeline.task.run.sender.login'] as sender,
				ResourceAttributes['everr.github.workflow_job.run_attempt'] as runAttempt,
				ResourceAttributes['cicd.pipeline.task.run.url.full'] as htmlUrl,
				SpanAttributes['everr.test.name'] as testName,
				SpanAttributes['everr.test.result'] as testResult,
				SpanAttributes['everr.test.duration_seconds'] as testDuration,
				coalesce(
					nullIf(SpanAttributes['everr.test.framework'], ''),
					nullIf(ResourceAttributes['everr.test.framework'], ''),
					''
				) as testFramework,
				coalesce(
					nullIf(SpanAttributes['everr.test.language'], ''),
					nullIf(ResourceAttributes['everr.test.language'], ''),
					''
				) as testLanguage,
				SpanAttributes['everr.test.is_subtest'] as isSubtest,
				SpanAttributes['everr.test.is_suite'] as isSuite
			FROM traces
			WHERE TraceId = {traceId:String}
			ORDER BY startTime ASC
		`;

    const result = await clickhouse.query<{
      spanId: string;
      parentSpanId: string;
      name: string;
      startTime: string;
      endTime: string;
      duration: string;
      conclusion: string;
      jobId: string;
      jobName: string;
      stepNumber: string;
      createdAt: string;
      startedAt: string;
      headBranch: string;
      headSha: string;
      runnerName: string;
      labels: string;
      sender: string;
      runAttempt: string;
      htmlUrl: string;
      testName: string;
      testResult: string;
      testDuration: string;
      testFramework: string;
      testLanguage: string;
      isSubtest: string;
      isSuite: string;
    }>(sql, { traceId });

    return result.map((row) => {
      // Calculate queue time from created_at and started_at (ISO timestamps)
      let queueTime: number | undefined;
      if (row.createdAt && row.startedAt && !row.stepNumber) {
        const created = new Date(row.createdAt).getTime();
        const started = new Date(row.startedAt).getTime();
        if (!Number.isNaN(created) && !Number.isNaN(started)) {
          queueTime = started - created;
        }
      }

      // Only include job-specific attributes for job spans (not steps)
      const isJobSpan = !row.stepNumber;

      return {
        spanId: row.spanId,
        parentSpanId: row.parentSpanId,
        name: row.name,
        startTime: Number(row.startTime),
        endTime: Number(row.endTime),
        duration: Number(row.duration),
        conclusion:
          row.conclusion || TEST_RESULT_TO_CONCLUSION[row.testResult] || "",
        jobId: row.jobId || undefined,
        jobName: row.jobName || undefined,
        stepNumber: row.stepNumber || undefined,
        queueTime,
        // Job-specific attributes (only for job spans)
        headBranch: isJobSpan && row.headBranch ? row.headBranch : undefined,
        headSha: isJobSpan && row.headSha ? row.headSha : undefined,
        runnerName: isJobSpan && row.runnerName ? row.runnerName : undefined,
        labels: isJobSpan && row.labels ? row.labels : undefined,
        sender: isJobSpan && row.sender ? row.sender : undefined,
        runAttempt:
          isJobSpan && row.runAttempt ? Number(row.runAttempt) : undefined,
        htmlUrl: isJobSpan && row.htmlUrl ? row.htmlUrl : undefined,
        // Test-specific attributes
        testName: row.testName || undefined,
        testResult: row.testResult || undefined,
        testDuration: row.testDuration ? Number(row.testDuration) : undefined,
        testFramework: row.testFramework || undefined,
        testLanguage: row.testLanguage || undefined,
        isSubtest: row.isSubtest === "true" || row.isSubtest === "1",
        isSuite: row.isSuite === "true" || row.isSuite === "1",
      };
    }) satisfies Span[];
  });
