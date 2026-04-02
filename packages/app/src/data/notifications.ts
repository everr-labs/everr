import { isFailureConclusion } from "@/data/runs/schemas";
import type { AuthContext } from "@/lib/auth-context";

const FAILURE_RESULT_CONDITION = `
  (
    lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) IN ('failure', 'failed')
    OR lowerUTF8(ResourceAttributes['cicd.pipeline.result']) IN ('failure', 'failed')
  )
`;

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
  failureTime: string;
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
  const failures = await loadFailureRunByTraceId(context, traceId);
  if (failures.length === 0) {
    return [];
  }

  const firstFailingStepByTraceId = await loadFirstFailingSteps(
    context,
    failures.map((row) => row.traceId),
  );

  return failures.map((row) => {
    const failingStep = firstFailingStepByTraceId.get(row.traceId);
    const detailsUrl = buildFailureDetailsUrl(origin, row.traceId, failingStep);

    return {
      dedupeKey: `${row.traceId}:${row.failureTime}`,
      traceId: row.traceId,
      repo: row.repo,
      branch: row.branch,
      workflowName: row.workflowName || "Workflow",
      failedAt: row.failureTime,
      detailsUrl,
      jobName: failingStep?.jobName,
      stepNumber: failingStep?.stepNumber,
      stepName: failingStep?.stepName,
    };
  });
}

async function loadFailureRunByTraceId(
  context: AuthContext,
  traceId: string,
): Promise<FailureRunRow[]> {
  return context.clickhouse.query<FailureRunRow>(
    `
      SELECT
        TraceId as traceId,
        anyLast(ResourceAttributes['vcs.repository.name']) as repo,
        anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
        anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
        max(Timestamp) as failureTime
      FROM traces
      WHERE ${FAILURE_RESULT_CONDITION}
        AND TraceId = {traceId:String}
      GROUP BY TraceId
      LIMIT 1
    `,
    { traceId },
  );
}

async function loadFirstFailingSteps(
  context: AuthContext,
  traceIds: string[],
): Promise<Map<string, FirstFailingStep>> {
  const clickhouse = context.clickhouse;
  if (traceIds.length === 0) {
    return new Map();
  }

  const [failedJobsResult, stepsResult] = await Promise.all([
    clickhouse.query<{
      trace_id: string;
      jobId: string;
    }>(
      `
        SELECT
          TraceId as trace_id,
          ResourceAttributes['cicd.pipeline.task.run.id'] as jobId
        FROM traces
        WHERE TraceId IN {traceIds:Array(String)}
          AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
        GROUP BY trace_id, jobId
        HAVING lowerUTF8(
          anyLast(ResourceAttributes['cicd.pipeline.task.run.result'])
        ) IN ('failure', 'failed')
      `,
      {
        traceIds,
      },
    ),
    clickhouse.query<{
      trace_id: string;
      jobId: string;
      jobName: string;
      stepName: string;
      stepNumber: string;
      conclusion: string;
    }>(
      `
        SELECT
          TraceId as trace_id,
          ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
          ResourceAttributes['cicd.pipeline.task.name'] as jobName,
          SpanAttributes['everr.github.workflow_job_step.number'] as stepNumber,
          anyLast(SpanName) as stepName,
          anyLast(StatusMessage) as conclusion
        FROM traces
        WHERE TraceId IN {traceIds:Array(String)}
          AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
          AND SpanAttributes['everr.github.workflow_job_step.number'] != ''
        GROUP BY trace_id, jobId, jobName, stepNumber
      `,
      {
        traceIds,
      },
    ),
  ]);

  const failedJobIdsByTraceId = new Map<string, Set<string>>();
  for (const row of failedJobsResult) {
    const current = failedJobIdsByTraceId.get(row.trace_id);
    if (current) {
      current.add(row.jobId);
      continue;
    }
    failedJobIdsByTraceId.set(row.trace_id, new Set([row.jobId]));
  }

  type StepCandidate = FirstFailingStep & {
    conclusion: string;
  };

  const failingByTraceId = new Map<string, StepCandidate>();
  const failedJobFallbackByTraceId = new Map<string, StepCandidate>();
  const anyStepFallbackByTraceId = new Map<string, StepCandidate>();

  for (const row of stepsResult) {
    const candidate: StepCandidate = {
      jobId: row.jobId,
      jobName: row.jobName,
      stepName: row.stepName,
      stepNumber: row.stepNumber,
      conclusion: row.conclusion,
    };

    if (isFailureConclusion(row.conclusion)) {
      updateBestStepCandidate(
        failingByTraceId,
        row.trace_id,
        candidate,
        compareFailingSteps,
      );
    }

    updateBestStepCandidate(
      anyStepFallbackByTraceId,
      row.trace_id,
      candidate,
      compareFallbackStepCandidates,
    );

    if (failedJobIdsByTraceId.get(row.trace_id)?.has(row.jobId)) {
      updateBestStepCandidate(
        failedJobFallbackByTraceId,
        row.trace_id,
        candidate,
        compareFallbackStepCandidates,
      );
    }
  }

  const firstFailingStepByTraceId = new Map<string, FirstFailingStep>();
  for (const traceId of traceIds) {
    const bestCandidate =
      failingByTraceId.get(traceId) ??
      failedJobFallbackByTraceId.get(traceId) ??
      anyStepFallbackByTraceId.get(traceId);
    if (!bestCandidate) {
      continue;
    }
    firstFailingStepByTraceId.set(traceId, {
      jobId: bestCandidate.jobId,
      jobName: bestCandidate.jobName,
      stepName: bestCandidate.stepName,
      stepNumber: bestCandidate.stepNumber,
    });
  }

  return firstFailingStepByTraceId;
}

function compareFailingSteps(a: FirstFailingStep, b: FirstFailingStep): number {
  const jobComparison = a.jobId.localeCompare(b.jobId);
  if (jobComparison !== 0) {
    return jobComparison;
  }

  return parseStepNumber(a.stepNumber) - parseStepNumber(b.stepNumber);
}

function compareFallbackStepCandidates(
  a: FirstFailingStep & { conclusion: string },
  b: FirstFailingStep & { conclusion: string },
): number {
  const jobComparison = a.jobId.localeCompare(b.jobId);
  if (jobComparison !== 0) {
    return jobComparison;
  }

  const skipComparison =
    Number(isSkippedConclusion(a.conclusion)) -
    Number(isSkippedConclusion(b.conclusion));
  if (skipComparison !== 0) {
    return skipComparison;
  }

  return parseStepNumber(b.stepNumber) - parseStepNumber(a.stepNumber);
}

function updateBestStepCandidate<T>(
  map: Map<string, T>,
  traceId: string,
  candidate: T,
  compare: (a: T, b: T) => number,
): void {
  const current = map.get(traceId);
  if (!current || compare(candidate, current) < 0) {
    map.set(traceId, candidate);
  }
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

function parseStepNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function isSkippedConclusion(value: string): boolean {
  return value.trim().toLowerCase() === "skip";
}
