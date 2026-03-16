import { query } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import { runSummarySubquery } from "../run-query-helpers";
import {
  getWorkflowRunFilterOptions,
  listWorkflowRuns,
} from "../workflow-runs/query";
import { RunsListInputSchema, SearchRunsInputSchema } from "./schemas";

export const getRunsList = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(RunsListInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const { fromDate, toDate } = resolveTimeRange(data.timeRange);

    return listWorkflowRuns({
      tenantId: session.tenantId,
      from: fromDate,
      to: toDate,
      limit: data.limit ?? 20,
      offset: data.offset ?? 0,
      repo: data.repo,
      branch: data.branch,
      conclusion: data.conclusion,
      workflowName: data.workflowName,
      runId: data.runId,
    });
  });

export const getRunFilterOptions = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) =>
  getWorkflowRunFilterOptions(session.tenantId),
);

export const searchRuns = createAuthenticatedServerFn({
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

    return results.map((row) => ({
      traceId: row.trace_id,
      runId: row.run_id,
      workflowName: row.workflowName || "Workflow",
      repo: row.repo,
      branch: row.branch,
      conclusion: row.conclusion,
      timestamp: row.timestamp,
    }));
  });
