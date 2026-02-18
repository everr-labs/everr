import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange } from "@/lib/time-range";
import { type TimeRangeInput, TimeRangeInputSchema } from "./analytics";
import { runSummarySubquery } from "./run-query-helpers";

export interface Run {
  traceId: string;
  runId: string;
  runAttempt: number;
  repo: string;
  branch: string;
  conclusion: string;
  workflowName: string;
  timestamp: string;
}

export interface Job {
  jobId: string;
  name: string;
  conclusion: string;
  duration: number; // ms
}

export interface Step {
  stepNumber: string;
  name: string;
  conclusion: string;
  duration: number; // ms
}

export interface LogEntry {
  timestamp: string;
  body: string;
}

export interface Span {
  spanId: string;
  parentSpanId: string;
  name: string;
  startTime: number; // Unix ms
  endTime: number; // Unix ms
  duration: number; // ms
  conclusion: string;
  jobId?: string;
  jobName?: string;
  stepNumber?: string;
  queueTime?: number; // ms - time spent waiting in queue (jobs only)
  // Job-specific attributes
  headBranch?: string;
  headSha?: string;
  runnerName?: string;
  labels?: string;
  sender?: string;
  runAttempt?: number;
  htmlUrl?: string;
  // Test-specific attributes
  testName?: string;
  testResult?: string;
  testDuration?: number;
  testFramework?: string;
  isSubtest?: boolean;
}

export const getLatestRuns = createServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);
    const runSummarySql = runSummarySubquery({
      whereClause: `ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
				AND SpanAttributes['citric.test.name'] = ''
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

    const result = await query<{
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

export const getRunDetails = createServerFn({
  method: "GET",
})
  .inputValidator(z.string())
  .handler(async ({ data: traceId }) => {
    const sql = `
			SELECT
					anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
					anyLast(toUInt32OrZero(ResourceAttributes['citric.github.workflow_job.run_attempt'])) as run_attempt,
					anyLast(ResourceAttributes['vcs.repository.name']) as repo,
					anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
					coalesce(nullIf(argMaxIf(ResourceAttributes['cicd.pipeline.result'], Timestamp, ResourceAttributes['cicd.pipeline.result'] != ''), ''), argMaxIf(ResourceAttributes['cicd.pipeline.task.run.result'], Timestamp, ResourceAttributes['cicd.pipeline.task.run.result'] != '')) as conclusion,
					anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
					max(Timestamp) as timestamp
				FROM otel_traces
			WHERE TraceId = {traceId:String}
		`;

    const result = await query<{
      run_id: string;
      run_attempt: string;
      repo: string;
      branch: string;
      conclusion: string;
      workflowName: string;
      timestamp: string;
    }>(sql, { traceId });

    if (result.length === 0) {
      return null;
    }

    return {
      traceId,
      runId: result[0].run_id,
      runAttempt: Number(result[0].run_attempt),
      repo: result[0].repo,
      branch: result[0].branch,
      conclusion: result[0].conclusion,
      workflowName: result[0].workflowName || "Workflow",
      timestamp: result[0].timestamp,
    } satisfies Run;
  });

export const getRunJobs = createServerFn({
  method: "GET",
})
  .inputValidator(z.string())
  .handler(async ({ data: traceId }) => {
    const sql = `
			SELECT
					ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
					anyLast(ResourceAttributes['cicd.pipeline.task.name']) as name,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
					max(Duration) / 1000000 as duration
			FROM otel_traces
			WHERE TraceId = {traceId:String}
				AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
			GROUP BY jobId
			ORDER BY name
		`;

    const result = await query<{
      jobId: string;
      name: string;
      conclusion: string;
      duration: string;
    }>(sql, { traceId });

    return result.map((row) => ({
      jobId: row.jobId,
      name: row.name,
      conclusion: row.conclusion,
      duration: Number(row.duration),
    })) satisfies Job[];
  });

export const getJobSteps = createServerFn({
  method: "GET",
})
  .inputValidator(z.object({ traceId: z.string(), jobId: z.string() }))
  .handler(async ({ data: { traceId, jobId } }) => {
    const sql = `
			SELECT
					SpanName as name,
					SpanAttributes['citric.github.workflow_job_step.number'] as stepNumber,
					StatusMessage as conclusion,
					Duration / 1000000 as duration
			FROM otel_traces
			WHERE TraceId = {traceId:String}
				AND ResourceAttributes['cicd.pipeline.task.run.id'] = {jobId:String}
				AND SpanAttributes['citric.github.workflow_job_step.number'] != ''
			ORDER BY toUInt32OrZero(stepNumber)
		`;

    const result = await query<{
      name: string;
      stepNumber: string;
      conclusion: string;
      duration: string;
    }>(sql, { traceId, jobId });

    return result.map((row) => ({
      stepNumber: row.stepNumber,
      name: row.name,
      conclusion: row.conclusion,
      duration: Number(row.duration),
    })) satisfies Step[];
  });

export const getAllJobsSteps = createServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({ traceId: z.string(), jobIds: z.array(z.string()) }),
  )
  .handler(async ({ data: { traceId, jobIds } }) => {
    if (jobIds.length === 0) {
      return {};
    }

    const result: Record<string, Step[]> = {};
    const sql = `
      SELECT
        ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
        SpanName as name,
        SpanAttributes['citric.github.workflow_job_step.number'] as stepNumber,
        StatusMessage as conclusion,
        Duration / 1000000 as duration
      FROM otel_traces
      WHERE TraceId = {traceId:String}
        AND ResourceAttributes['cicd.pipeline.task.run.id'] IN {jobIds:Array(String)}
        AND SpanAttributes['citric.github.workflow_job_step.number'] != ''
      ORDER BY jobId, toUInt32OrZero(stepNumber)
    `;
    const rows = await query<{
      jobId: string;
      name: string;
      stepNumber: string;
      conclusion: string;
      duration: string;
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
      });
    }

    return result;
  });

export const getStepLogs = createServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      traceId: z.string(),
      jobName: z.string(),
      stepNumber: z.string(),
    }),
  )
  .handler(async ({ data: { traceId, jobName, stepNumber } }) => {
    // Note: Logs use job name in ScopeAttributes, not job ID
    const sql = `
			SELECT
				Timestamp as timestamp,
				Body as body
			FROM otel_logs
			WHERE TraceId = {traceId:String}
				AND ScopeAttributes['cicd.pipeline.task.name'] = {jobName:String}
				AND LogAttributes['citric.github.workflow_job_step.number'] = {stepNumber:String}
			ORDER BY Timestamp ASC
			LIMIT 1000
		`;

    const result = await query<{
      timestamp: string;
      body: string;
    }>(sql, { traceId, jobName, stepNumber });

    return result.map((row) => ({
      timestamp: row.timestamp,
      body: row.body,
    })) satisfies LogEntry[];
  });

export const getRunSpans = createServerFn({
  method: "GET",
})
  .inputValidator(z.string())
  .handler(async ({ data: traceId }) => {
    const sql = `
			SELECT
				SpanId as spanId,
				ParentSpanId as parentSpanId,
				SpanName as name,
				toUnixTimestamp64Milli(Timestamp) as startTime,
				toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000) as endTime,
				intDiv(Duration, 1000000) as duration,
				StatusMessage as conclusion,
				ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
				ResourceAttributes['cicd.pipeline.task.name'] as jobName,
				SpanAttributes['citric.github.workflow_job_step.number'] as stepNumber,
				ResourceAttributes['citric.github.workflow_job.created_at'] as createdAt,
				ResourceAttributes['citric.github.workflow_job.started_at'] as startedAt,
				ResourceAttributes['vcs.ref.head.name'] as headBranch,
				ResourceAttributes['vcs.ref.head.revision'] as headSha,
				ResourceAttributes['cicd.worker.name'] as runnerName,
				ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
				ResourceAttributes['cicd.pipeline.task.run.sender.login'] as sender,
				ResourceAttributes['citric.github.workflow_job.run_attempt'] as runAttempt,
				ResourceAttributes['cicd.pipeline.task.run.url.full'] as htmlUrl,
				SpanAttributes['citric.test.name'] as testName,
				SpanAttributes['citric.test.result'] as testResult,
				SpanAttributes['citric.test.duration_seconds'] as testDuration,
				SpanAttributes['citric.test.framework'] as testFramework,
				SpanAttributes['citric.test.is_subtest'] as isSubtest
			FROM otel_traces
			WHERE TraceId = {traceId:String}
			ORDER BY startTime ASC
		`;

    const result = await query<{
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
      isSubtest: string;
    }>(sql, { traceId });

    const TEST_RESULT_TO_CONCLUSION: Record<string, string> = {
      pass: "success",
      fail: "failure",
      skip: "skip",
    };

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
        isSubtest: row.isSubtest === "true" || row.isSubtest === "1",
      };
    }) satisfies Span[];
  });

// Query options factories
export const latestRunsOptions = ({ timeRange }: TimeRangeInput) =>
  queryOptions({
    queryKey: ["runs", "latest", timeRange],
    queryFn: () => getLatestRuns({ data: { timeRange } }),
  });

export const runDetailsOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["runs", "details", traceId],
    queryFn: () => getRunDetails({ data: traceId }),
    staleTime: 60_000,
  });

export const runJobsOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["runs", "jobs", traceId],
    queryFn: () => getRunJobs({ data: traceId }),
    staleTime: 60_000,
  });

export const allJobsStepsOptions = (input: {
  traceId: string;
  jobIds: string[];
}) =>
  queryOptions({
    queryKey: ["runs", "allJobsSteps", input.traceId, input.jobIds],
    queryFn: () => getAllJobsSteps({ data: input }),
    staleTime: 60_000,
  });

export const stepLogsOptions = (input: {
  traceId: string;
  jobName: string;
  stepNumber: string;
}) =>
  queryOptions({
    queryKey: [
      "runs",
      "stepLogs",
      input.traceId,
      input.jobName,
      input.stepNumber,
    ],
    queryFn: () => getStepLogs({ data: input }),
    staleTime: 60_000,
  });

export const runSpansOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["runs", "spans", traceId],
    queryFn: () => getRunSpans({ data: traceId }),
    staleTime: 60_000,
  });
