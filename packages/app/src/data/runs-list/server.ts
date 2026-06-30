import { bucketSeconds } from "@everr/ui/lib/bucket";
import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { pool } from "@/db/client";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { runSummarySubquery } from "../run-query-helpers";
import type {
  FilterOptions,
  RunHistogramBucket,
  RunListItem,
  RunsListInput,
  RunsListResult,
} from "./schemas";
import {
  RunsHistogramInputSchema,
  RunsListInputSchema,
  SearchRunsInputSchema,
} from "./schemas";

type RunsFilter = Omit<RunsListInput, "limit" | "offset" | "includeTotalCount">;

/**
 * Builds the shared `WHERE` clause (org scope + time range + active filters)
 * used by both the runs list and its volume histogram, so the two never drift
 * out of sync. Returns the clause plus its positional params; callers append
 * their own trailing params (limit/offset, bucket interval).
 */
function buildRunsFilterClause(data: RunsFilter, organizationId: string) {
  const { fromDate, toDate } = resolveTimeRange(data.timeRange);
  const clauses = [
    "organization_id = $1",
    "last_event_at >= $2",
    "last_event_at <= $3",
  ];
  const params: unknown[] = [organizationId, fromDate, toDate];

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

  if (data.authorEmails?.length) {
    params.push(data.authorEmails);
    clauses.push(`author_email = ANY($${params.length})`);
  }

  return {
    whereClause: clauses.join("\n          AND "),
    params,
    fromDate,
    toDate,
  };
}

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
  displayTitle: string | null;
  headSha: string;
};

export const getRunsList = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(RunsListInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const { whereClause, params } = buildRunsFilterClause(
      data,
      session.session.activeOrganizationId,
    );

    const rowsPromise = pool.query<WorkflowRunRow>(
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
            COALESCE(metadata->>'triggering_actor', metadata->>'actor') AS sender,
            COALESCE(metadata->>'head_commit_message', metadata->>'display_title') AS "displayTitle",
            sha AS "headSha"
          FROM workflow_runs
          WHERE ${whereClause}
          ORDER BY last_event_at DESC
          LIMIT $${params.length + 1}
          OFFSET $${params.length + 2}
        `,
      [...params, data.limit, data.offset],
    );

    // The total only feeds the list footer, which reads it from the first page,
    // so skip the extra count(*) on every later infinite-scroll page.
    const countPromise = data.includeTotalCount
      ? pool.query<{ count: string }>(
          `
          SELECT count(*) AS count
          FROM workflow_runs
          WHERE ${whereClause}
        `,
          params,
        )
      : null;

    const [rowsResult, countResult] = await Promise.all([
      rowsPromise,
      countPromise,
    ]);

    return {
      runs: rowsResult.rows.map(mapWorkflowRunRow),
      totalCount: countResult
        ? Number(countResult.rows[0]?.count ?? 0)
        : undefined,
    } satisfies RunsListResult;
  });

type RunHistogramRowRaw = {
  bucketEpoch: string | number;
  total: string | number;
  success: string | number;
  failure: string | number;
  cancellation: string | number;
  other: string | number;
};

export const getRunsHistogram = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(RunsHistogramInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const { whereClause, params, fromDate, toDate } = buildRunsFilterClause(
      data,
      session.session.activeOrganizationId,
    );
    const intervalSeconds = bucketSeconds(
      fromDate,
      toDate,
      data.histogramBuckets,
    );
    // Reuse one positional param for the interval in both the bucket floor and
    // the multiply-back; ::float8 keeps the division from truncating to int.
    const intervalParam = `$${params.length + 1}`;

    const result = await pool.query<RunHistogramRowRaw>(
      `
        SELECT
          (floor(extract(epoch FROM last_event_at) / ${intervalParam}::float8) * ${intervalParam}::float8)::bigint AS "bucketEpoch",
          count(*) AS total,
          count(*) FILTER (WHERE status = 'completed' AND conclusion = 'success') AS success,
          count(*) FILTER (WHERE status = 'completed' AND conclusion = 'failure') AS failure,
          count(*) FILTER (WHERE status = 'completed' AND conclusion = 'cancelled') AS cancellation,
          count(*) FILTER (
            WHERE NOT (status = 'completed' AND conclusion IN ('success', 'failure', 'cancelled'))
          ) AS other
        FROM workflow_runs
        WHERE ${whereClause}
        GROUP BY "bucketEpoch"
        ORDER BY "bucketEpoch" ASC
      `,
      [...params, intervalSeconds],
    );

    return fillRunHistogramBuckets(
      result.rows,
      fromDate,
      toDate,
      intervalSeconds,
    );
  });

function makeRunHistogramBucket(
  bucketMs: number,
  intervalMs: number,
  row?: RunHistogramRowRaw,
): RunHistogramBucket {
  const date = new Date(bucketMs);
  const endDate = new Date(bucketMs + intervalMs);
  return {
    timestamp: date.toISOString(),
    endTimestamp: endDate.toISOString(),
    total: Number(row?.total ?? 0),
    success: Number(row?.success ?? 0),
    failure: Number(row?.failure ?? 0),
    cancellation: Number(row?.cancellation ?? 0),
    other: Number(row?.other ?? 0),
  };
}

/**
 * Densifies the sparse grouped rows into one contiguous bucket per interval so
 * the chart shows gaps as empty bars instead of collapsing them.
 */
function fillRunHistogramBuckets(
  rows: RunHistogramRowRaw[],
  fromDate: Date,
  toDate: Date,
  intervalSeconds: number,
): RunHistogramBucket[] {
  const intervalMs = intervalSeconds * 1000;
  const startMs = Math.floor(fromDate.getTime() / intervalMs) * intervalMs;
  const endMs = Math.floor(toDate.getTime() / intervalMs) * intervalMs;
  const rowsByBucket = new Map(
    rows.map((row) => [Number(row.bucketEpoch) * 1000, row]),
  );
  const buckets: RunHistogramBucket[] = [];
  for (let bucketMs = startMs; bucketMs <= endMs; bucketMs += intervalMs) {
    buckets.push(
      makeRunHistogramBucket(bucketMs, intervalMs, rowsByBucket.get(bucketMs)),
    );
  }
  return buckets;
}

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
          WHERE organization_id = $1 AND status = 'completed' AND repository != ''
            AND last_event_at >= $2
            AND last_event_at <= $3
          LIMIT 100
        ) r) AS repos,
        (SELECT COALESCE(array_agg(v ORDER BY v), '{}') FROM (
          SELECT DISTINCT ref AS v FROM workflow_runs
          WHERE organization_id = $1 AND status = 'completed' AND ref != ''
            AND last_event_at >= $2
            AND last_event_at <= $3
          LIMIT 100
        ) b) AS branches,
        (SELECT COALESCE(array_agg(v ORDER BY v), '{}') FROM (
          SELECT DISTINCT workflow_name AS v FROM workflow_runs
          WHERE organization_id = $1 AND status = 'completed' AND workflow_name != ''
            AND last_event_at >= $2
            AND last_event_at <= $3
          LIMIT 100
        ) w) AS "workflowNames"
    `,
      [session.session.activeOrganizationId, fromDate, toDate],
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
    // Only an actively-running build ticks; queued/waiting runs (which may
    // still carry a start time) and completed runs use the static duration.
    runningSince:
      row.status === "in_progress" && row.startedAt
        ? toDateValue(row.startedAt).toISOString()
        : null,
    timestamp: endedAt.toISOString(),
    sender: row.sender ?? "",
    displayTitle: row.displayTitle ?? null,
    headSha: row.headSha,
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
