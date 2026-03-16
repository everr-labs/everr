import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { runSummarySubquery } from "./run-query-helpers";

export interface RunListItem {
  traceId: string;
  runId: string;
  attempts: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
  headSha?: string;
  jobCount: number;
  failingSteps?: FailingStepSummary[];
}

export interface RunsListResult {
  runs: RunListItem[];
  totalCount: number;
}

export interface FailingStepSummary {
  jobName: string;
  jobId: string;
  stepNumber: number;
  stepName: string;
}

const RunsListInputSchema = z
  .object({
    timeRange: TimeRangeSchema,
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    repo: z.string().optional(),
    branch: z.string().optional(),
    conclusion: z.string().optional(),
    workflowName: z.string().optional(),
    runId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.page !== undefined && value.offset !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either page or offset, not both.",
        path: ["offset"],
      });
    }

    if (value.limit !== undefined && value.pageSize !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either limit or pageSize, not both.",
        path: ["limit"],
      });
    }
  });
export type RunsListInput = z.infer<typeof RunsListInputSchema>;

export const getRunsList = createServerFn({
  method: "GET",
})
  .inputValidator(RunsListInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const limit = data.limit ?? data.pageSize ?? 20;
    const offset = data.offset ?? ((data.page ?? 1) - 1) * limit;

    const conditions: string[] = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "ResourceAttributes['cicd.pipeline.run.id'] != ''",
      "ResourceAttributes['cicd.pipeline.task.run.result'] != ''",
      "SpanAttributes['everr.github.workflow_job_step.number'] = ''",
      "SpanAttributes['everr.test.name'] = ''",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
      limit,
      offset,
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
    if (data.conclusion) {
      params.conclusion = data.conclusion;
    }
    if (data.workflowName) {
      conditions.push(
        "ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}",
      );
      params.workflowName = data.workflowName;
    }
    if (data.runId) {
      conditions.push(
        "ResourceAttributes['cicd.pipeline.run.id'] = {runId:String}",
      );
      params.runId = data.runId;
    }

    const whereClause = conditions.join("\n\t\t\t\tAND ");
    const conclusionClause = data.conclusion
      ? "WHERE conclusion = {conclusion:String}"
      : "";
    const runSummarySql = runSummarySubquery({
      whereClause,
      groupByExpr: "TraceId",
      groupByAlias: "trace_id",
      includeRunAttempt: true,
      includeDuration: true,
      includeSender: true,
      includeHeadSha: true,
      includeJobCount: true,
    });

    const dataSql = `
        SELECT *
        FROM (${runSummarySql})
        ${conclusionClause}
				ORDER BY timestamp DESC
				LIMIT {limit:UInt32} OFFSET {offset:UInt32}
			`;

    const countSql = `
				SELECT count(*) as total
				FROM (
					SELECT trace_id
          FROM (${runSummarySql})
          ${conclusionClause}
				)
			`;

    const [dataResult, countResult] = await Promise.all([
      query<{
        trace_id: string;
        run_id: string;
        run_attempt: string;
        workflowName: string;
        repo: string;
        branch: string;
        conclusion: string;
        duration: string;
        timestamp: string;
        sender: string;
        headSha: string;
        jobCount: string;
      }>(dataSql, params),
      query<{ total: string }>(countSql, params),
    ]);

    const runs: RunListItem[] = dataResult.map((row) => ({
      traceId: row.trace_id,
      runId: row.run_id,
      attempts: Number(row.run_attempt),
      workflowName: row.workflowName || "Workflow",
      repo: row.repo,
      branch: row.branch,
      conclusion: row.conclusion,
      duration: Number(row.duration),
      timestamp: row.timestamp,
      sender: row.sender,
      headSha: row.headSha,
      jobCount: Number(row.jobCount),
    }));

    const failingTraceIds = runs
      .filter((run) => isFailingConclusion(run.conclusion))
      .map((run) => run.traceId);

    if (failingTraceIds.length > 0) {
      const failingStepsSql = `
        SELECT
            TraceId as trace_id,
            ResourceAttributes['cicd.pipeline.task.name'] as jobName,
            ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
            SpanAttributes['everr.github.workflow_job_step.number'] as stepNumber,
            anyLast(SpanName) as stepName
          FROM traces
          WHERE TraceId IN {traceIds:Array(String)}
            AND SpanAttributes['everr.github.workflow_job_step.number'] != ''
            AND lowerUTF8(StatusMessage) NOT IN ('success', 'skip')
          GROUP BY trace_id, jobName, jobId, stepNumber
      `;

      const failingStepsResult = await query<{
        trace_id: string;
        jobName: string;
        jobId: string;
        stepNumber: string;
        stepName: string;
      }>(failingStepsSql, { traceIds: failingTraceIds });

      const failingStepsByTraceId = new Map<string, FailingStepSummary[]>();
      for (const row of failingStepsResult) {
        const current = failingStepsByTraceId.get(row.trace_id) ?? [];
        current.push({
          jobName: row.jobName,
          jobId: row.jobId,
          stepNumber: Number(row.stepNumber),
          stepName: row.stepName,
        });
        failingStepsByTraceId.set(row.trace_id, current);
      }

      for (const run of runs) {
        if (!isFailingConclusion(run.conclusion)) {
          continue;
        }
        run.failingSteps = failingStepsByTraceId.get(run.traceId) ?? [];
        run.failingSteps.sort(
          (a, b) =>
            a.jobId.localeCompare(b.jobId) || a.stepNumber - b.stepNumber,
        );
      }
    }

    return {
      runs,
      totalCount: countResult.length > 0 ? Number(countResult[0].total) : 0,
    } satisfies RunsListResult;
  });

function isFailingConclusion(conclusion: string): boolean {
  const normalized = conclusion.trim().toLowerCase();
  return normalized === "failure" || normalized === "failed";
}

export interface FilterOptions {
  repos: string[];
  branches: string[];
  workflowNames: string[];
}

export const getRunFilterOptions = createServerFn({
  method: "GET",
}).handler(async () => {
  const [repos, branches, workflowNames] = await Promise.all([
    query<{ repo: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.repository.name'] as repo
			FROM traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.repository.name'] != ''
			ORDER BY repo
			LIMIT 100`,
    ),
    query<{ branch: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
			FROM traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.ref.head.name'] != ''
			ORDER BY branch
			LIMIT 100`,
    ),
    query<{ workflowName: string }>(
      `SELECT DISTINCT ResourceAttributes['cicd.pipeline.name'] as workflowName
			FROM traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['cicd.pipeline.name'] != ''
			ORDER BY workflowName
			LIMIT 100`,
    ),
  ]);

  return {
    repos: repos.map((r) => r.repo),
    branches: branches.map((r) => r.branch),
    workflowNames: workflowNames.map((r) => r.workflowName),
  } satisfies FilterOptions;
});

export interface RunSearchResult {
  traceId: string;
  runId: string;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  timestamp: string;
}

const SearchRunsInputSchema = z.object({
  query: z.string().min(1),
});

export const searchRuns = createServerFn({
  method: "GET",
})
  .inputValidator(SearchRunsInputSchema)
  .handler(async ({ data }) => {
    const results = await query<{
      trace_id: string;
      run_id: string;
      workflowName: string;
      repo: string;
      branch: string;
      conclusion: string;
      timestamp: string;
    }>(
      `
      SELECT *
      FROM (
        ${runSummarySubquery({
          whereClause: `Timestamp >= now() - INTERVAL 90 DAY
            AND ResourceAttributes['cicd.pipeline.run.id'] != ''
            AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
            AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
            AND SpanAttributes['everr.test.name'] = ''
            AND (ResourceAttributes['cicd.pipeline.run.id'] LIKE {pattern:String}
              OR ResourceAttributes['cicd.pipeline.name'] ILIKE {pattern:String})`,
          groupByExpr: "TraceId",
          groupByAlias: "trace_id",
        })}
      )
      ORDER BY timestamp DESC
      LIMIT 5
      `,
      { pattern: `%${data.query}%` },
    );

    return results.map(
      (row): RunSearchResult => ({
        traceId: row.trace_id,
        runId: row.run_id,
        workflowName: row.workflowName || "Workflow",
        repo: row.repo,
        branch: row.branch,
        conclusion: row.conclusion,
        timestamp: row.timestamp,
      }),
    );
  });

// Query options factories
export const runsListOptions = (input: RunsListInput) =>
  queryOptions({
    queryKey: ["runs", "list", input],
    queryFn: () => getRunsList({ data: input }),
  });

export const runFilterOptionsOptions = () =>
  queryOptions({
    queryKey: ["runs", "filterOptions"],
    queryFn: () => getRunFilterOptions(),
    staleTime: 5 * 60_000,
  });

export const searchRunsOptions = (searchQuery: string) =>
  queryOptions({
    queryKey: ["runs", "search", searchQuery],
    queryFn: () => searchRuns({ data: { query: searchQuery } }),
    staleTime: 30_000,
  });
