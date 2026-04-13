import { pool } from "@/db/client";
import type { WorkflowJobStep } from "@/db/schema";
import type { AuthContext } from "@/lib/auth-context";

type FailureRow = {
  traceId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failureTime: Date;
  jobId: string | null;
  jobName: string | null;
  steps: WorkflowJobStep[] | null;
};

export type FailedJobInfo = {
  jobName: string;
  stepNumber: string;
  stepName?: string;
};

export type FailureNotification = {
  dedupeKey: string;
  traceId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failedAt: string;
  detailsUrl: string;
  failedJobs: FailedJobInfo[];
  /** @deprecated Legacy single-job field kept for backward compatibility. */
  jobName?: string;
  /** @deprecated Legacy single-job field kept for backward compatibility. */
  stepNumber?: string;
  /** @deprecated Legacy single-job field kept for backward compatibility. */
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
  const rows = await loadFailureWithJobs(tenantId, traceId);
  if (rows.length === 0) {
    return [];
  }

  // All rows share the same run-level fields; group the job rows.
  const run = rows[0];
  const failedAt =
    run.failureTime instanceof Date
      ? run.failureTime.toISOString()
      : String(run.failureTime);

  const jobRows = rows.filter(
    (r): r is FailureRow & { jobId: string; jobName: string } =>
      r.jobId != null && r.jobName != null,
  );

  const failedJobs = buildFailedJobInfos(jobRows);
  const firstFailingStep = findFirstFailingStep(jobRows);
  const detailsUrl = buildFailureDetailsUrl(
    origin,
    run.traceId,
    firstFailingStep,
  );

  return [
    {
      dedupeKey: `${run.traceId}:${failedAt}`,
      traceId: run.traceId,
      repo: run.repo,
      branch: run.branch,
      workflowName: run.workflowName || "Workflow",
      failedAt,
      detailsUrl,
      failedJobs,
      jobName: firstFailingStep?.jobName,
      stepNumber: firstFailingStep?.stepNumber,
      stepName: firstFailingStep?.stepName,
    },
  ];
}

async function loadFailureWithJobs(
  tenantId: number,
  traceId: string,
): Promise<FailureRow[]> {
  const result = await pool.query<FailureRow>(
    `
      SELECT
        r.trace_id      AS "traceId",
        r.repository    AS "repo",
        r.ref           AS "branch",
        r.workflow_name AS "workflowName",
        r.last_event_at AS "failureTime",
        j.job_id::text  AS "jobId",
        j.job_name      AS "jobName",
        j.metadata->'steps' AS "steps"
      FROM workflow_runs r
      LEFT JOIN workflow_jobs j
        ON  j.tenant_id = r.tenant_id
        AND j.trace_id  = r.trace_id
        AND j.conclusion = 'failure'
      WHERE r.tenant_id = $1
        AND r.trace_id  = $2
        AND r.conclusion = 'failure'
      ORDER BY j.started_at ASC NULLS LAST
    `,
    [tenantId, traceId],
  );
  return result.rows;
}

type FirstFailingStep = {
  jobId: string;
  jobName: string;
  stepName: string;
  stepNumber: string;
};

type JobRow = {
  jobId: string;
  jobName: string;
  steps: WorkflowJobStep[] | null;
};

function buildFailedJobInfos(jobs: JobRow[]): FailedJobInfo[] {
  const infos: FailedJobInfo[] = [];
  for (const job of jobs) {
    const step = findFirstFailingStepForJob(job);
    if (step) {
      infos.push({
        jobName: job.jobName,
        stepNumber: String(step.number),
        stepName: step.name || undefined,
      });
    }
  }
  return infos;
}

function findFirstFailingStep(jobs: JobRow[]): FirstFailingStep | undefined {
  for (const job of jobs) {
    const step = findFirstFailingStepForJob(job);
    if (step) {
      return toFirstFailingStep(job, step);
    }
  }
  return undefined;
}

function findFirstFailingStepForJob(job: JobRow): WorkflowJobStep | undefined {
  const steps = job.steps ?? [];

  const failed = steps
    .filter((s) => s.conclusion === "failure" || s.conclusion === "cancelled")
    .sort((a, b) => a.number - b.number)[0];
  if (failed) return failed;

  const nonSkipped = steps
    .filter((s) => s.conclusion !== "skipped")
    .sort((a, b) => b.number - a.number)[0];
  if (nonSkipped) return nonSkipped;

  return [...steps].sort((a, b) => b.number - a.number)[0];
}

function toFirstFailingStep(
  job: JobRow,
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
