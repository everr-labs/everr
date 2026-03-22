import { pool } from "@/db/client";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import { runSummarySubquery } from "../run-query-helpers";
import type { FilterOptions, RunListItem, RunsListResult } from "./schemas";
import { RunsListInputSchema, SearchRunsInputSchema } from "./schemas";

const RECENT_COMPLETED_WINDOW_SQL = "INTERVAL '90 days'";

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

type FilterRow = {
  value: string;
};

export const getRunsList = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(RunsListInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const { fromDate, toDate } = resolveTimeRange(data.timeRange);
    const timestampExpr = "COALESCE(run_completed_at, last_event_at)";
    const clauses = [
      "tenant_id = $1",
      `${timestampExpr} >= $2`,
      `${timestampExpr} <= $3`,
    ];
    const params: unknown[] = [session.tenantId, fromDate, toDate];

    if (data.repo) {
      params.push(data.repo);
      clauses.push(`repository = $${params.length}`);
    }

    if (data.branch) {
      params.push(data.branch);
      clauses.push(`ref = $${params.length}`);
    }

    if (data.workflowName) {
      params.push(data.workflowName);
      clauses.push(`workflow_name = $${params.length}`);
    }

    if (data.conclusion) {
      params.push(denormalizeConclusion(data.conclusion));
      clauses.push(`conclusion = $${params.length}`);
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

export const getRunFilterOptions = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const [repos, branches, workflowNames] = await Promise.all([
    pool.query<FilterRow>(
      `
        SELECT DISTINCT repository AS value
        FROM workflow_runs
        WHERE tenant_id = $1
          AND repository != ''
          AND COALESCE(run_completed_at, last_event_at) >=
            NOW() - ${RECENT_COMPLETED_WINDOW_SQL}
        ORDER BY value
        LIMIT 100
      `,
      [session.tenantId],
    ),
    pool.query<FilterRow>(
      `
        SELECT DISTINCT ref AS value
        FROM workflow_runs
        WHERE tenant_id = $1
          AND ref != ''
          AND COALESCE(run_completed_at, last_event_at) >=
            NOW() - ${RECENT_COMPLETED_WINDOW_SQL}
        ORDER BY value
        LIMIT 100
      `,
      [session.tenantId],
    ),
    pool.query<FilterRow>(
      `
        SELECT DISTINCT workflow_name AS value
        FROM workflow_runs
        WHERE tenant_id = $1
          AND workflow_name != ''
          AND COALESCE(run_completed_at, last_event_at) >=
            NOW() - ${RECENT_COMPLETED_WINDOW_SQL}
        ORDER BY value
        LIMIT 100
      `,
      [session.tenantId],
    ),
  ]);

  return {
    repos: repos.rows.map((row) => row.value),
    branches: branches.rows.map((row) => row.value),
    workflowNames: workflowNames.rows.map((row) => row.value),
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
