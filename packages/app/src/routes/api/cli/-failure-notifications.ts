import { isFailureConclusion } from "@/data/runs/schemas";
import { query } from "@/lib/clickhouse";
import { workOS } from "@/lib/workos";

const FAILURE_LIMIT = 100;
export const TIME_WINDOW_MINUTES = 30;
const FAILURE_RESULT_CONDITION = `
  (
    lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) IN ('failure', 'failed')
    OR lowerUTF8(ResourceAttributes['cicd.pipeline.result']) IN ('failure', 'failed')
  )
`;
const SUCCESS_RESULT_CONDITION = `
  (
    lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) = 'success'
    OR lowerUTF8(ResourceAttributes['cicd.pipeline.result']) = 'success'
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
  runId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failureTime: string;
};

type CandidateRunRow = {
  runId: string;
  repo: string;
  branch: string;
  startedAt: string;
};

export type FailureNotification = {
  dedupe_key: string;
  trace_id: string;
  repo: string;
  branch: string;
  workflow_name: string;
  failure_time: string;
  details_url: string;
  job_name?: string;
  step_number?: string;
  step_name?: string;
  auto_fix_prompt?: string;
};

export type TrayStatusResponse = {
  verified_match: boolean;
  unresolved_failures: FailureNotification[];
  failed_runs_dashboard_url: string;
  auto_fix_prompt: string;
};

type FailureNotificationsOptions = {
  gitEmail: string;
  origin: string;
  timeWindowMinutes: number;
  repo?: string;
  branch?: string;
  unresolvedOnly?: boolean;
  preloadNotificationContext?: boolean;
};

export async function getVerifiedCliUserEmail(
  userId: string,
  expectedGitEmail?: string,
): Promise<string | null> {
  const user = await workOS.userManagement.getUser(userId);
  if (!user.emailVerified) {
    return null;
  }

  const verifiedEmail = user.email.trim().toLowerCase();
  if (expectedGitEmail) {
    const requestedEmail = expectedGitEmail.trim().toLowerCase();
    if (verifiedEmail !== requestedEmail) {
      return null;
    }
  }

  return verifiedEmail;
}

export async function getFailureNotifications({
  gitEmail,
  origin,
  timeWindowMinutes,
  repo,
  branch,
  unresolvedOnly = false,
  preloadNotificationContext = false,
}: FailureNotificationsOptions): Promise<FailureNotification[]> {
  const failures = await loadFailureRuns({
    gitEmail,
    timeWindowMinutes,
    repo,
    branch,
  });
  if (failures.length === 0) {
    return [];
  }

  const unresolvedFailures = unresolvedOnly
    ? await filterUnresolvedFailures(failures, timeWindowMinutes)
    : failures;
  if (unresolvedFailures.length === 0) {
    return [];
  }

  const firstFailingStepByTraceId = await loadFirstFailingSteps(
    unresolvedFailures.map((row) => row.traceId),
  );

  const notifications = unresolvedFailures.map((row) => {
    const failingStep = firstFailingStepByTraceId.get(row.traceId);
    const detailsUrl = buildFailureDetailsUrl(origin, row.traceId, failingStep);

    return {
      dedupe_key: `${row.traceId}:${row.failureTime}`,
      trace_id: row.traceId,
      repo: row.repo,
      branch: row.branch,
      workflow_name: row.workflowName || "Workflow",
      failure_time: row.failureTime,
      details_url: detailsUrl,
      job_name: failingStep?.jobName,
      step_number: failingStep?.stepNumber,
      step_name: failingStep?.stepName,
    };
  });

  if (!preloadNotificationContext) {
    return notifications;
  }

  return notifications.map((notification) => ({
    ...notification,
    auto_fix_prompt: buildAutoFixPrompt([notification]),
  }));
}

export function buildFailedRunsDashboardUrl(origin: string): string {
  const url = new URL("/runs", origin);
  url.searchParams.set("conclusion", "failure");
  url.searchParams.set("from", `now-${TIME_WINDOW_MINUTES}m`);
  url.searchParams.set("to", "now");
  return url.toString();
}

export function buildAutoFixPrompt(failures: FailureNotification[]): string {
  if (failures.length === 0) {
    return "";
  }

  const failuresByRepo = new Map<string, FailureNotification[]>();
  for (const failure of failures) {
    const repoFailures = failuresByRepo.get(failure.repo);
    if (repoFailures) {
      repoFailures.push(failure);
    } else {
      failuresByRepo.set(failure.repo, [failure]);
    }
  }

  const sections = [
    "Investigate and fix these unresolved CI pipeline failures.",
    "Use Everr CLI from the current project directory before guessing.",
    "",
    "Required workflow:",
    "- Start by pulling logs with the exact `everr runs logs` command listed for each failure below.",
    "- Make the smallest repo-local fix that addresses the root cause.",
    "- Run the narrowest relevant test or check before finishing.",
    "- Work repo-by-repo. If a repo is not available locally, say so explicitly.",
    "",
    "Current unresolved failures:",
  ];

  for (const [repo, repoFailures] of failuresByRepo) {
    sections.push(``);
    sections.push(`Repo: ${repo}`);
    for (const failure of repoFailures) {
      const failingStep =
        failure.job_name && failure.step_number
          ? ` | step ${failure.job_name} #${failure.step_number}${failure.step_name ? ` (${failure.step_name})` : ""}`
          : "";
      sections.push(
        `- branch ${failure.branch} | workflow ${failure.workflow_name} | trace ${failure.trace_id} | failed at ${failure.failure_time}${failingStep}`,
      );
      const logsCommand = buildRunsLogsCommand(failure);
      if (logsCommand) {
        sections.push(`  logs: \`${logsCommand}\``);
      }
    }
  }

  sections.push("");
  sections.push(
    "Return a concise summary with root cause, code changes, verification, and any follow-up risk.",
  );

  return sections.join("\n");
}

async function loadFailureRuns({
  gitEmail,
  timeWindowMinutes,
  repo,
  branch,
}: {
  gitEmail: string;
  timeWindowMinutes: number;
  repo?: string;
  branch?: string;
}): Promise<FailureRunRow[]> {
  const conditions = [
    `Timestamp >= now() - INTERVAL ${timeWindowMinutes} MINUTE`,
    "ResourceAttributes['cicd.pipeline.run.id'] != ''",
    "lowerUTF8(ResourceAttributes['vcs.ref.head.revision.author.email']) = lowerUTF8({gitEmail:String})",
    FAILURE_RESULT_CONDITION,
  ];
  const params: Record<string, unknown> = {
    gitEmail,
  };

  if (repo) {
    conditions.push(
      "ResourceAttributes['vcs.repository.name'] = {repo:String}",
    );
    params.repo = repo;
  }

  if (branch) {
    conditions.push(
      "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
    params.branch = branch;
  }

  return query<FailureRunRow>(
    `
      SELECT
        TraceId as traceId,
        anyLast(ResourceAttributes['cicd.pipeline.run.id']) as runId,
        anyLast(ResourceAttributes['vcs.repository.name']) as repo,
        anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
        anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
        max(Timestamp) as failureTime
      FROM traces
      WHERE ${conditions.join("\n        AND ")}
      GROUP BY TraceId
      ORDER BY failureTime DESC
      LIMIT ${FAILURE_LIMIT}
    `,
    params,
  );
}

async function loadFirstFailingSteps(
  traceIds: string[],
): Promise<Map<string, FirstFailingStep>> {
  if (traceIds.length === 0) {
    return new Map();
  }

  const [failedJobsResult, stepsResult] = await Promise.all([
    query<{
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
    query<{
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

async function filterUnresolvedFailures(
  failures: FailureRunRow[],
  timeWindowMinutes: number,
): Promise<FailureRunRow[]> {
  const successfulRuns = await loadSuccessfulRunsForScopes(
    failures,
    timeWindowMinutes,
  );
  const activeRuns = await loadActiveRunsForScopes(failures, timeWindowMinutes);
  const candidatesByScope = groupCandidateRunsByScope([
    ...successfulRuns,
    ...activeRuns,
  ]);

  return failures.filter((failure) => {
    const candidates = candidatesByScope.get(
      createScopeKey(failure.repo, failure.branch),
    );
    if (!candidates) {
      return true;
    }

    const failureTime = toTimestampMs(failure.failureTime);
    return !candidates.some(
      (candidate) =>
        candidate.runId !== failure.runId &&
        toTimestampMs(candidate.startedAt) > failureTime,
    );
  });
}

async function loadSuccessfulRunsForScopes(
  failures: FailureRunRow[],
  timeWindowMinutes: number,
): Promise<CandidateRunRow[]> {
  const scopeFilter = buildScopeFilter(
    failures.map((failure) => ({
      repo: failure.repo,
      branch: failure.branch,
    })),
    "ResourceAttributes['vcs.repository.name']",
    "ResourceAttributes['vcs.ref.head.name']",
  );

  return query<CandidateRunRow>(
    `
      SELECT
        anyLast(ResourceAttributes['cicd.pipeline.run.id']) as runId,
        anyLast(ResourceAttributes['vcs.repository.name']) as repo,
        anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
        min(Timestamp) as startedAt
      FROM traces
      WHERE Timestamp >= now() - INTERVAL ${timeWindowMinutes} MINUTE
        AND ResourceAttributes['cicd.pipeline.run.id'] != ''
        AND ${SUCCESS_RESULT_CONDITION}
        AND (${scopeFilter.clause})
      GROUP BY TraceId
    `,
    scopeFilter.params,
  );
}

async function loadActiveRunsForScopes(
  failures: FailureRunRow[],
  timeWindowMinutes: number,
): Promise<CandidateRunRow[]> {
  const scopeFilter = buildScopeFilter(
    failures.map((failure) => ({
      repo: failure.repo,
      branch: failure.branch,
    })),
    "repository",
    "ref",
  );

  return query<CandidateRunRow>(
    `
      SELECT
        subject_id as runId,
        repository as repo,
        ref as branch,
        min(event_time) as startedAt
      FROM app.cdevents
      WHERE event_kind = 'pipelinerun'
        AND event_time >= now() - INTERVAL ${timeWindowMinutes} MINUTE
        AND (${scopeFilter.clause})
      GROUP BY subject_id, repository, ref
      HAVING argMax(event_phase, event_time) != 'finished'
    `,
    scopeFilter.params,
  );
}

function groupCandidateRunsByScope(
  runs: CandidateRunRow[],
): Map<string, CandidateRunRow[]> {
  const grouped = new Map<string, CandidateRunRow[]>();
  for (const run of runs) {
    const key = createScopeKey(run.repo, run.branch);
    const scopeRuns = grouped.get(key);
    if (scopeRuns) {
      scopeRuns.push(run);
    } else {
      grouped.set(key, [run]);
    }
  }
  return grouped;
}

function buildScopeFilter(
  scopes: Array<{ repo: string; branch: string }>,
  repoField: string,
  branchField: string,
): { clause: string; params: Record<string, string> } {
  const uniqueScopes = Array.from(
    new Map(
      scopes.map((scope) => [createScopeKey(scope.repo, scope.branch), scope]),
    ).values(),
  );
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  uniqueScopes.forEach((scope, index) => {
    clauses.push(
      `(${repoField} = {repo${index}:String} AND ${branchField} = {branch${index}:String})`,
    );
    params[`repo${index}`] = scope.repo;
    params[`branch${index}`] = scope.branch;
  });

  return {
    clause: clauses.join(" OR "),
    params,
  };
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

function buildRunsLogsCommand(failure: FailureNotification): string | null {
  if (!failure.job_name || !failure.step_number) {
    return null;
  }

  return `everr runs logs --trace-id ${failure.trace_id} --job-name ${JSON.stringify(
    failure.job_name,
  )} --step-number ${failure.step_number}`;
}

function createScopeKey(repo: string, branch: string): string {
  return `${repo}\u0000${branch}`;
}

function toTimestampMs(value: string): number {
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}
