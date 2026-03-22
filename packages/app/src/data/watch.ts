import { pool } from "@/db/client";

export type WatchRun = {
  runId: string;
  workflowName: string;
  conclusion: string | null;
  durationSeconds: number;
  expectedDurationSeconds: number | null;
  activeJobs: string[];
};

export type WatchResponse = {
  state: "pending" | "running" | "completed";
  active: WatchRun[];
  completed: WatchRun[];
};

type WatchStatusInput = {
  tenantId: number;
  repo: string;
  branch: string;
  commit: string;
};

type WorkflowRunRow = {
  runId: string | number;
  traceId: string;
  workflowName: string;
  status: string;
  conclusion: string | null;
  createdAt: string | Date;
  completedAt: string | Date | null;
  lastEventAt: string | Date;
  attempts: number;
};

type WorkflowJobRow = {
  traceId: string;
  jobName: string;
  status: string;
};

const WATCH_LOOKBACK_SQL = "INTERVAL '14 days'";

const BASELINE_LOOKBACK_SQL = "INTERVAL '30 days'";

export async function getWatchStatus({
  tenantId,
  repo,
  branch,
  commit,
}: WatchStatusInput): Promise<WatchResponse> {
  const matchingRuns = await pool.query<WorkflowRunRow>(
    `
      SELECT
        run_id AS "runId",
        trace_id AS "traceId",
        workflow_name AS "workflowName",
        status,
        conclusion,
        created_at AS "createdAt",
        run_completed_at AS "completedAt",
        last_event_at AS "lastEventAt",
        attempts
      FROM workflow_runs
      WHERE tenant_id = $1
        AND repository = $2
        AND ref = $3
        AND sha = $4
        AND last_event_at >= NOW() - ${WATCH_LOOKBACK_SQL}
      ORDER BY run_id ASC, attempts DESC, last_event_at DESC
    `,
    [tenantId, repo, branch, commit],
  );

  const runs = latestRunAttempts(matchingRuns.rows);
  if (runs.length === 0) {
    return {
      state: "pending",
      active: [],
      completed: [],
    };
  }

  const activeTraceIds = runs
    .filter((run) => run.status !== "completed")
    .map((run) => run.traceId);

  const [baselineRuns, jobs] = await Promise.all([
    pool.query<WorkflowRunRow>(
      `
        SELECT
          run_id AS "runId",
          trace_id AS "traceId",
          workflow_name AS "workflowName",
          status,
          conclusion,
          created_at AS "createdAt",
          run_completed_at AS "completedAt",
          last_event_at AS "lastEventAt",
          attempts
        FROM workflow_runs
        WHERE tenant_id = $1
          AND repository = $2
          AND ref = $3
          AND status = 'completed'
          AND run_completed_at IS NOT NULL
          AND last_event_at >= NOW() - ${BASELINE_LOOKBACK_SQL}
        ORDER BY run_id ASC, attempts DESC, last_event_at DESC
      `,
      [tenantId, repo, branch],
    ),
    activeTraceIds.length === 0
      ? Promise.resolve({ rows: [] as WorkflowJobRow[] })
      : pool.query<WorkflowJobRow>(
          `
            SELECT
              trace_id AS "traceId",
              job_name AS "jobName",
              status
            FROM workflow_jobs
            WHERE tenant_id = $1
              AND trace_id = ANY($2::text[])
            ORDER BY trace_id ASC, job_name ASC
          `,
          [tenantId, activeTraceIds],
        ),
  ]);

  const expectedDurationByWorkflow = buildExpectedDurationByWorkflow(
    baselineRuns.rows,
  );
  const activeJobNamesByTraceId = groupActiveJobNames(jobs.rows);

  const active: WatchRun[] = [];
  const completed: WatchRun[] = [];

  for (const run of runs) {
    const watchRun: WatchRun = {
      runId: String(run.runId),
      workflowName: run.workflowName,
      conclusion: run.status === "completed" ? run.conclusion : null,
      durationSeconds: computeDurationSeconds(run),
      expectedDurationSeconds:
        expectedDurationByWorkflow.get(run.workflowName) ?? null,
      activeJobs: activeJobNamesByTraceId.get(run.traceId) ?? [],
    };

    if (run.status === "completed") {
      completed.push(watchRun);
    } else {
      active.push(watchRun);
    }
  }

  return {
    state: active.length > 0 ? "running" : "completed",
    active,
    completed,
  };
}

function latestRunAttempts<
  T extends { runId: string | number; lastEventAt: string | Date },
>(rows: T[]): T[] {
  const latestByRunId = new Map<string, T>();
  for (const row of rows) {
    const key = String(row.runId);
    if (!latestByRunId.has(key)) {
      latestByRunId.set(key, row);
    }
  }

  return Array.from(latestByRunId.values()).sort(
    (left, right) =>
      toTimestampMs(right.lastEventAt) - toTimestampMs(left.lastEventAt),
  );
}

function buildExpectedDurationByWorkflow(
  rows: WorkflowRunRow[],
): Map<string, number> {
  const durationsByWorkflow = new Map<string, number[]>();

  for (const run of latestRunAttempts(rows)) {
    const workflowDurations = durationsByWorkflow.get(run.workflowName) ?? [];
    if (workflowDurations.length >= 3) {
      continue;
    }

    workflowDurations.push(computeDurationSeconds(run));
    durationsByWorkflow.set(run.workflowName, workflowDurations);
  }

  return new Map(
    Array.from(durationsByWorkflow.entries()).map(
      ([workflowName, durations]) => [
        workflowName,
        Math.round(
          durations.reduce((sum, duration) => sum + duration, 0) /
            durations.length,
        ),
      ],
    ),
  );
}

function groupActiveJobNames(rows: WorkflowJobRow[]): Map<string, string[]> {
  const namesByTraceId = new Map<string, string[]>();

  for (const row of rows) {
    if (row.status === "completed") {
      continue;
    }

    const jobNames = namesByTraceId.get(row.traceId) ?? [];
    if (!jobNames.includes(row.jobName)) {
      jobNames.push(row.jobName);
      namesByTraceId.set(row.traceId, jobNames);
    }
  }

  return namesByTraceId;
}

function computeDurationSeconds(
  run: Pick<
    WorkflowRunRow,
    "status" | "createdAt" | "completedAt" | "lastEventAt"
  >,
): number {
  const startedAtMs = toTimestampMs(run.createdAt);
  const endedAtMs =
    run.status === "completed"
      ? toTimestampMs(run.completedAt ?? run.lastEventAt)
      : Date.now();

  return Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));
}

function toTimestampMs(value: string | Date | null): number {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    return value.valueOf();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
