import { z } from "zod";
import { pool } from "@/db/client";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { runSummarySubquery } from "../run-query-helpers";
import type { FilterOptions, RunListItem, RunsListResult } from "./schemas";
import { RunsListInputSchema, SearchRunsInputSchema } from "./schemas";

type WorkflowRunRow = {
  traceId: string;
  runId: string | number;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  status: string;
  conclusion: string | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  lastEventAt: string | Date;
  sender: string | null;
};

export const getRunsList = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(RunsListInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const { fromDate, toDate } = resolveTimeRange(data.timeRange);
    const timestampExpr = "last_event_at";
    const clauses = [
      "tenant_id = $1",
      `${timestampExpr} >= $2`,
      `${timestampExpr} <= $3`,
    ];
    const params: unknown[] = [session.tenantId, fromDate, toDate];

    if (data.repos?.length) {
      params.push(data.repos);
      clauses.push(`repository = ANY($${params.length})`);
    }

    if (data.branches?.length) {
      params.push(data.branches);
      clauses.push(`ref = ANY($${params.length})`);
    }

    if (data.workflowNames?.length) {
      params.push(data.workflowNames);
      clauses.push(`workflow_name = ANY($${params.length})`);
    }

    if (data.conclusions?.length) {
      params.push(data.conclusions.map(denormalizeConclusion));
      clauses.push(`conclusion = ANY($${params.length})`);
    }

    if (data.runId) {
      params.push(data.runId);
      clauses.push(`run_id::text = $${params.length}`);
    }

    const whereClause = clauses.join("\n          AND ");

    const [rowsResult, countResult] = await Promise.all([
      pool.query<WorkflowRunRow>(
        `
          SELECT
            trace_id AS "traceId",
            run_id AS "runId",
            attempts AS "runAttempt",
            workflow_name AS "workflowName",
            repository AS repo,
            ref AS branch,
            status,
            conclusion,
            run_started_at AS "startedAt",
            run_completed_at AS "completedAt",
            last_event_at AS "lastEventAt",
            COALESCE(metadata->>'triggering_actor', metadata->>'actor') AS sender
          FROM workflow_runs
          WHERE ${whereClause}
          ORDER BY ${timestampExpr} DESC
          LIMIT $${params.length + 1}
          OFFSET $${params.length + 2}
        `,
        [...params, data.limit ?? 20, data.offset ?? 0],
      ),
      pool.query<{ count: string }>(
        `
          SELECT count(*) AS count
          FROM workflow_runs
          WHERE ${whereClause}
        `,
        params,
      ),
    ]);

    return {
      runs: rowsResult.rows.map(mapWorkflowRunRow),
      totalCount: Number(countResult.rows[0]?.count ?? 0),
    } satisfies RunsListResult;
  });

const RunFilterOptionsInputSchema = z.object({
  timeRange: TimeRangeSchema,
});

export const getRunFilterOptions = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(RunFilterOptionsInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const { fromDate, toDate } = resolveTimeRange(data.timeRange);
    const result = await pool.query<{
      repos: string[];
      branches: string[];
      workflowNames: string[];
    }>(
      `
      SELECT
        (SELECT COALESCE(array_agg(v ORDER BY v), '{}') FROM (
          SELECT DISTINCT repository AS v FROM workflow_runs
          WHERE tenant_id = $1 AND status = 'completed' AND repository != ''
            AND COALESCE(run_completed_at, last_event_at) >= $2
            AND COALESCE(run_completed_at, last_event_at) <= $3
          LIMIT 100
        ) r) AS repos,
        (SELECT COALESCE(array_agg(v ORDER BY v), '{}') FROM (
          SELECT DISTINCT ref AS v FROM workflow_runs
          WHERE tenant_id = $1 AND status = 'completed' AND ref != ''
            AND COALESCE(run_completed_at, last_event_at) >= $2
            AND COALESCE(run_completed_at, last_event_at) <= $3
          LIMIT 100
        ) b) AS branches,
        (SELECT COALESCE(array_agg(v ORDER BY v), '{}') FROM (
          SELECT DISTINCT workflow_name AS v FROM workflow_runs
          WHERE tenant_id = $1 AND status = 'completed' AND workflow_name != ''
            AND COALESCE(run_completed_at, last_event_at) >= $2
            AND COALESCE(run_completed_at, last_event_at) <= $3
          LIMIT 100
        ) w) AS "workflowNames"
    `,
      [session.tenantId, fromDate, toDate],
    );

    const row = result.rows[0];
    return {
      repos: row?.repos ?? [],
      branches: row?.branches ?? [],
      workflowNames: row?.workflowNames ?? [],
    } satisfies FilterOptions;
  });

export const searchRuns = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(SearchRunsInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const results = await clickhouse.query<{
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

function mapWorkflowRunRow(row: WorkflowRunRow): RunListItem {
  const endedAt = toDateValue(row.completedAt ?? row.lastEventAt);
  const startedAt = row.startedAt ? toDateValue(row.startedAt) : endedAt;
  const isCompleted = row.status === "completed";
  const conclusion = isCompleted
    ? normalizeConclusion(row.conclusion)
    : row.status;

  return {
    traceId: row.traceId,
    runId: String(row.runId),
    runAttempt: row.runAttempt,
    workflowName: row.workflowName || "Workflow",
    repo: row.repo,
    branch: row.branch || "—",
    conclusion,
    duration:
      !isCompleted || conclusion === "skip" || conclusion === "skipped"
        ? 0
        : Math.max(0, endedAt.getTime() - startedAt.getTime()),
    timestamp: endedAt.toISOString(),
    sender: row.sender ?? "",
  };
}

function normalizeConclusion(conclusion: string | null): string {
  if (!conclusion) {
    return "unknown";
  }

  if (conclusion === "cancelled") {
    return "cancellation";
  }

  return conclusion;
}

function denormalizeConclusion(conclusion: string): string {
  if (conclusion === "cancellation") {
    return "cancelled";
  }

  return conclusion;
}

function toDateValue(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
}
