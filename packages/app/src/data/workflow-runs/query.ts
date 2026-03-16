import { pool } from "@/db/client";
import type {
  FilterOptions,
  RunListItem,
  RunsListResult,
} from "../runs-list/schemas";

const RECENT_COMPLETED_WINDOW_SQL = "INTERVAL '90 days'";

type ListWorkflowRunsInput = {
  tenantId: number;
  from: Date;
  to: Date;
  limit: number;
  offset: number;
  repo?: string;
  branch?: string;
  conclusion?: string;
  workflowName?: string;
  runId?: string;
};

type WorkflowRunRow = {
  traceId: string;
  runId: string | number;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  lastEventAt: string | Date;
  sender: string | null;
};

type FilterRow = {
  value: string;
};

export async function listWorkflowRuns(
  input: ListWorkflowRunsInput,
): Promise<RunsListResult> {
  const { whereClause, params } = buildListWhereClause(input);
  const timestampExpr = "COALESCE(run_completed_at, last_event_at)";

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
      [...params, input.limit, input.offset],
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
}

export async function getWorkflowRunFilterOptions(
  tenantId: number,
): Promise<FilterOptions> {
  const [repos, branches, workflowNames] = await Promise.all([
    pool.query<FilterRow>(
      `
        SELECT DISTINCT repository AS value
        FROM workflow_runs
        WHERE tenant_id = $1
          AND status = 'completed'
          AND repository != ''
          AND COALESCE(run_completed_at, last_event_at) >=
            NOW() - ${RECENT_COMPLETED_WINDOW_SQL}
        ORDER BY value
        LIMIT 100
      `,
      [tenantId],
    ),
    pool.query<FilterRow>(
      `
        SELECT DISTINCT ref AS value
        FROM workflow_runs
        WHERE tenant_id = $1
          AND status = 'completed'
          AND ref != ''
          AND COALESCE(run_completed_at, last_event_at) >=
            NOW() - ${RECENT_COMPLETED_WINDOW_SQL}
        ORDER BY value
        LIMIT 100
      `,
      [tenantId],
    ),
    pool.query<FilterRow>(
      `
        SELECT DISTINCT workflow_name AS value
        FROM workflow_runs
        WHERE tenant_id = $1
          AND status = 'completed'
          AND workflow_name != ''
          AND COALESCE(run_completed_at, last_event_at) >=
            NOW() - ${RECENT_COMPLETED_WINDOW_SQL}
        ORDER BY value
        LIMIT 100
      `,
      [tenantId],
    ),
  ]);

  return {
    repos: repos.rows.map((row) => row.value),
    branches: branches.rows.map((row) => row.value),
    workflowNames: workflowNames.rows.map((row) => row.value),
  } satisfies FilterOptions;
}

function buildListWhereClause(input: ListWorkflowRunsInput): {
  whereClause: string;
  params: unknown[];
} {
  const timestampExpr = "COALESCE(run_completed_at, last_event_at)";
  const clauses = [
    "tenant_id = $1",
    "status = 'completed'",
    `${timestampExpr} >= $2`,
    `${timestampExpr} <= $3`,
  ];
  const params: unknown[] = [input.tenantId, input.from, input.to];

  addOptionalEquals(clauses, params, "repository", input.repo);
  addOptionalEquals(clauses, params, "ref", input.branch);
  addOptionalEquals(clauses, params, "workflow_name", input.workflowName);

  if (input.conclusion) {
    params.push(denormalizeConclusion(input.conclusion));
    clauses.push(`conclusion = $${params.length}`);
  }

  if (input.runId) {
    params.push(input.runId);
    clauses.push(`run_id::text = $${params.length}`);
  }

  return {
    whereClause: clauses.join("\n        AND "),
    params,
  };
}

function addOptionalEquals(
  clauses: string[],
  params: unknown[],
  column: string,
  value: string | undefined,
) {
  if (!value) {
    return;
  }

  params.push(value);
  clauses.push(`${column} = $${params.length}`);
}

function mapWorkflowRunRow(row: WorkflowRunRow): RunListItem {
  const endedAt = toDateValue(row.completedAt ?? row.lastEventAt);
  const startedAt = row.startedAt ? toDateValue(row.startedAt) : endedAt;
  const conclusion = normalizeConclusion(row.conclusion);

  return {
    traceId: row.traceId,
    runId: String(row.runId),
    runAttempt: row.runAttempt,
    workflowName: row.workflowName || "Workflow",
    repo: row.repo,
    branch: row.branch || "—",
    conclusion,
    duration:
      conclusion === "skip" || conclusion === "skipped"
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
