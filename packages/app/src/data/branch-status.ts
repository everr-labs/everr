import { pool } from "@/db/client";
import type { WorkflowJobStep } from "@/db/schema";

export type FirstFailingStep = {
  stepNumber: number;
  stepName: string;
};

export type FailingJob = {
  id: string;
  name: string;
  firstFailingStep: FirstFailingStep | null;
};

export type BranchStatusRun = {
  traceId: string;
  runId: string;
  workflowName: string;
  conclusion: string | null;
  startedAt: string;
  durationSeconds: number | null;
  activeJobs: string[];
  failingJobs: FailingJob[];
};

export type BranchStatusResponse = {
  state: "pending" | "running" | "completed";
  active: BranchStatusRun[];
  completed: BranchStatusRun[];
};

type BranchStatusInput = {
  tenantId: number;
  repo: string;
  branch?: string;
  commit: string;
  attempt?: number;
};

type WorkflowRunRow = {
  runId: string | number;
  traceId: string;
  workflowName: string;
  status: string;
  conclusion: string | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  lastEventAt: string | Date;
  attempts: number;
};

type WorkflowJobRow = {
  traceId: string;
  jobName: string;
  status: string;
};

type FailedJobRow = {
  traceId: string;
  jobId: string;
  jobName: string;
  steps: WorkflowJobStep[] | null;
};

const WATCH_LOOKBACK_SQL = "INTERVAL '14 days'";

export async function getBranchStatus({
  tenantId,
  repo,
  branch,
  commit,
  attempt,
}: BranchStatusInput): Promise<BranchStatusResponse> {
  const matchingRunsParams: (string | number)[] = [tenantId, repo, commit];
  let matchingRunsBranchClause = "";
  if (branch) {
    matchingRunsParams.push(branch);
    matchingRunsBranchClause = `AND ref = $${matchingRunsParams.length}`;
  }
  let matchingRunsAttemptClause = "";
  if (attempt !== undefined) {
    matchingRunsParams.push(attempt);
    matchingRunsAttemptClause = `AND attempts = $${matchingRunsParams.length}`;
  }

  const matchingRuns = await pool.query<WorkflowRunRow>(
    `
      SELECT
        run_id AS "runId",
        trace_id AS "traceId",
        workflow_name AS "workflowName",
        status,
        conclusion,
        run_started_at AS "startedAt",
        run_completed_at AS "completedAt",
        last_event_at AS "lastEventAt",
        attempts
      FROM workflow_runs
      WHERE tenant_id = $1
        AND repository = $2
        AND sha = $3
        ${matchingRunsBranchClause}
        ${matchingRunsAttemptClause}
        AND last_event_at >= NOW() - ${WATCH_LOOKBACK_SQL}
      ORDER BY run_id ASC, attempts DESC, last_event_at DESC
    `,
    matchingRunsParams,
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

  const jobs =
    activeTraceIds.length === 0
      ? { rows: [] as WorkflowJobRow[] }
      : await pool.query<WorkflowJobRow>(
          `
            SELECT
              trace_id AS "traceId",
              job_name AS "jobName",
              status
            FROM workflow_jobs
            WHERE tenant_id = $1
              AND trace_id = ANY($2::text[])
              AND status != 'completed'
            ORDER BY trace_id ASC, job_name ASC
          `,
          [tenantId, activeTraceIds],
        );

  const activeJobNamesByTraceId = groupActiveJobNames(jobs.rows);

  const failedTraceIds = runs
    .filter((run) => run.status === "completed" && run.conclusion === "failure")
    .map((run) => run.traceId);

  const failedJobs =
    failedTraceIds.length === 0
      ? { rows: [] as FailedJobRow[] }
      : await pool.query<FailedJobRow>(
          `
            SELECT
              trace_id AS "traceId",
              job_id AS "jobId",
              job_name AS "jobName",
              metadata->'steps' AS "steps"
            FROM workflow_jobs
            WHERE tenant_id = $1
              AND trace_id = ANY($2::text[])
              AND conclusion = 'failure'
            ORDER BY trace_id ASC, started_at ASC
          `,
          [tenantId, failedTraceIds],
        );

  const failingJobsByTraceId = buildFailingJobsByTraceId(failedJobs.rows);

  const active: BranchStatusRun[] = [];
  const completed: BranchStatusRun[] = [];

  for (const run of runs) {
    const isCompleted = run.status === "completed";
    const branchStatusRun: BranchStatusRun = {
      traceId: run.traceId,
      runId: String(run.runId),
      workflowName: run.workflowName,
      conclusion: isCompleted ? run.conclusion : null,
      startedAt: run.startedAt
        ? new Date(run.startedAt).toISOString()
        : new Date(run.lastEventAt).toISOString(),
      durationSeconds: isCompleted ? computeDurationSeconds(run) : null,
      activeJobs: isCompleted
        ? []
        : (activeJobNamesByTraceId.get(run.traceId) ?? []),
      failingJobs: failingJobsByTraceId.get(run.traceId) ?? [],
    };

    if (run.status === "completed") {
      completed.push(branchStatusRun);
    } else {
      active.push(branchStatusRun);
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

function buildFailingJobsByTraceId(
  rows: FailedJobRow[],
): Map<string, FailingJob[]> {
  const result = new Map<string, FailingJob[]>();
  for (const row of rows) {
    const failingStep = (row.steps ?? [])
      .filter((s) => s.conclusion === "failure" || s.conclusion === "cancelled")
      .sort((a, b) => a.number - b.number)[0];
    const job: FailingJob = {
      id: String(row.jobId),
      name: row.jobName,
      firstFailingStep: failingStep
        ? { stepNumber: failingStep.number, stepName: failingStep.name }
        : null,
    };
    const existing = result.get(row.traceId) ?? [];
    existing.push(job);
    result.set(row.traceId, existing);
  }
  return result;
}

function groupActiveJobNames(rows: WorkflowJobRow[]): Map<string, string[]> {
  const namesByTraceId = new Map<string, string[]>();

  for (const row of rows) {
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
    "status" | "startedAt" | "completedAt" | "lastEventAt"
  >,
): number {
  const startedAtMs = toTimestampMs(run.startedAt ?? run.lastEventAt);
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
