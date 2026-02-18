import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { runSummarySubquery } from "./run-query-helpers";

export interface RunListItem {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
  jobCount: number;
}

export interface RunsListResult {
  runs: RunListItem[];
  totalCount: number;
}

const RunsListInputSchema = z.object({
  timeRange: TimeRangeSchema,
  page: z.coerce.number().int().min(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  conclusion: z.string().optional(),
  workflowName: z.string().optional(),
  runId: z.string().optional(),
});
export type RunsListInput = z.infer<typeof RunsListInputSchema>;

export const getRunsList = createServerFn({
  method: "GET",
})
  .inputValidator(RunsListInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const pageSize = data.pageSize ?? 20;
    const offset = (data.page - 1) * pageSize;

    const conditions: string[] = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "ResourceAttributes['cicd.pipeline.run.id'] != ''",
      "ResourceAttributes['cicd.pipeline.task.run.result'] != ''",
      "SpanAttributes['citric.github.workflow_job_step.number'] = ''",
      "SpanAttributes['citric.test.name'] = ''",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
      pageSize,
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
      includeJobCount: true,
    });

    const dataSql = `
        SELECT *
        FROM (${runSummarySql})
        ${conclusionClause}
				ORDER BY timestamp DESC
				LIMIT {pageSize:UInt32} OFFSET {offset:UInt32}
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
        jobCount: string;
      }>(dataSql, params),
      query<{ total: string }>(countSql, params),
    ]);

    return {
      runs: dataResult.map((row) => ({
        traceId: row.trace_id,
        runId: row.run_id,
        runAttempt: Number(row.run_attempt),
        workflowName: row.workflowName || "Workflow",
        repo: row.repo,
        branch: row.branch,
        conclusion: row.conclusion,
        duration: Number(row.duration),
        timestamp: row.timestamp,
        sender: row.sender,
        jobCount: Number(row.jobCount),
      })),
      totalCount: countResult.length > 0 ? Number(countResult[0].total) : 0,
    } satisfies RunsListResult;
  });

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
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.repository.name'] != ''
			ORDER BY repo
			LIMIT 100`,
    ),
    query<{ branch: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.ref.head.name'] != ''
			ORDER BY branch
			LIMIT 100`,
    ),
    query<{ workflowName: string }>(
      `SELECT DISTINCT ResourceAttributes['cicd.pipeline.name'] as workflowName
			FROM otel_traces
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
            AND SpanAttributes['citric.github.workflow_job_step.number'] = ''
            AND SpanAttributes['citric.test.name'] = ''
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
