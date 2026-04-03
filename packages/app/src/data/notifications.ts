import { pool } from "@/db/client";
import type { WorkflowJobStep } from "@/db/schema";
import type { AuthContext } from "@/lib/auth-context";

type FirstFailingStep = {
  jobId: string;
  jobName: string;
  stepName: string;
  stepNumber: string;
};

type FailureRunRow = {
  traceId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failureTime: Date;
};

type FailedJobRow = {
  traceId: string;
  jobId: string;
  jobName: string;
  steps: WorkflowJobStep[] | null;
};

export type FailureNotification = {
  dedupeKey: string;
  traceId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failedAt: string;
  detailsUrl: string;
  jobName?: string;
  stepNumber?: string;
  stepName?: string;
};

type FailureNotificationsOptions = {
  context: AuthContext;
  origin: string;
  traceId: string;
};

export async function getFailureNotifications({
  context,
  origin,
  traceId,
}: FailureNotificationsOptions): Promise<FailureNotification[]> {
  const tenantId = context.session.tenantId;
  const failures = await loadFailureRunByTraceId(tenantId, traceId);
  if (failures.length === 0) {
    return [];
  }

  const firstFailingStepByTraceId = await loadFirstFailingSteps(
    tenantId,
    failures.map((row) => row.traceId),
  );

  return failures.map((row) => {
    const failingStep = firstFailingStepByTraceId.get(row.traceId);
    const detailsUrl = buildFailureDetailsUrl(origin, row.traceId, failingStep);
    const failedAt =
      row.failureTime instanceof Date
        ? row.failureTime.toISOString()
        : String(row.failureTime);

    return {
      dedupeKey: `${row.traceId}:${failedAt}`,
      traceId: row.traceId,
      repo: row.repo,
      branch: row.branch,
      workflowName: row.workflowName || "Workflow",
      failedAt,
      detailsUrl,
      jobName: failingStep?.jobName,
      stepNumber: failingStep?.stepNumber,
      stepName: failingStep?.stepName,
    };
  });
}

async function loadFailureRunByTraceId(
  tenantId: number,
  traceId: string,
): Promise<FailureRunRow[]> {
  const result = await pool.query<FailureRunRow>(
    `
      SELECT
        trace_id      AS "traceId",
        repository    AS "repo",
        ref           AS "branch",
        workflow_name AS "workflowName",
        last_event_at AS "failureTime"
      FROM workflow_runs
      WHERE tenant_id = $1
        AND trace_id = $2
        AND conclusion = 'failure'
      LIMIT 1
    `,
    [tenantId, traceId],
  );
  return result.rows;
}

async function loadFirstFailingSteps(
  tenantId: number,
  traceIds: string[],
): Promise<Map<string, FirstFailingStep>> {
  if (traceIds.length === 0) {
    return new Map();
  }

  const result = await pool.query<FailedJobRow>(
    `
      SELECT
        trace_id          AS "traceId",
        job_id::text      AS "jobId",
        job_name          AS "jobName",
        metadata->'steps' AS "steps"
      FROM workflow_jobs
      WHERE tenant_id = $1
        AND trace_id = ANY($2::text[])
        AND conclusion = 'failure'
      ORDER BY trace_id ASC, started_at ASC NULLS LAST
    `,
    [tenantId, traceIds],
  );

  return buildFirstFailingStepByTraceId(result.rows);
}

function buildFirstFailingStepByTraceId(
  rows: FailedJobRow[],
): Map<string, FirstFailingStep> {
  const jobsByTrace = new Map<string, FailedJobRow[]>();
  for (const row of rows) {
    const jobs = jobsByTrace.get(row.traceId) ?? [];
    jobs.push(row);
    jobsByTrace.set(row.traceId, jobs);
  }

  const result = new Map<string, FirstFailingStep>();
  for (const [traceId, jobs] of jobsByTrace) {
    const step = findFirstFailingStep(jobs);
    if (step) {
      result.set(traceId, step);
    }
  }
  return result;
}

function findFirstFailingStep(
  jobs: FailedJobRow[],
): FirstFailingStep | undefined {
  // Tier 1: first step with a failure or cancelled conclusion
  for (const job of jobs) {
    const step = (job.steps ?? [])
      // Treat cancelled steps as failures — consistent with branch-status.ts
      .filter((s) => s.conclusion === "failure" || s.conclusion === "cancelled")
      .sort((a, b) => a.number - b.number)[0];
    if (step) {
      return toFirstFailingStep(job, step);
    }
  }

  // Tier 2: last non-skipped step of the first failed job
  for (const job of jobs) {
    const step = (job.steps ?? [])
      // GitHub webhook steps use "skipped" (not "skip" which was a ClickHouse span artifact)
      .filter((s) => s.conclusion !== "skipped")
      .sort((a, b) => b.number - a.number)[0];
    if (step) {
      return toFirstFailingStep(job, step);
    }
  }

  // Tier 3: last step of the first failed job
  for (const job of jobs) {
    const step = (job.steps ?? []).sort((a, b) => b.number - a.number)[0];
    if (step) {
      return toFirstFailingStep(job, step);
    }
  }

  return undefined;
}

function toFirstFailingStep(
  job: FailedJobRow,
  step: WorkflowJobStep,
): FirstFailingStep {
  return {
    jobId: job.jobId,
    jobName: job.jobName,
    stepName: step.name,
    stepNumber: String(step.number),
  };
}

function buildFailureDetailsUrl(
  origin: string,
  traceId: string,
  failingStep?: FirstFailingStep,
): string {
  const runUrl = new URL(`/runs/${encodeURIComponent(traceId)}`, origin);
  if (!failingStep) {
    return runUrl.toString();
  }

  return new URL(
    `/runs/${encodeURIComponent(traceId)}/jobs/${encodeURIComponent(
      failingStep.jobId,
    )}/steps/${encodeURIComponent(failingStep.stepNumber)}`,
    origin,
  ).toString();
}
