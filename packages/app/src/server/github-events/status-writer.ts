import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { notifyWorkflowUpdate } from "@/db/notify";
import {
  type WorkflowJobMetadata,
  type WorkflowRunMetadata,
  workflowJobs,
  workflowRuns,
  type workflowStatusEnum,
} from "@/db/schema";
import {
  type ParsedQueuedWorkflowEvent,
  parseTimestamp,
  repositoryIdFromQueuedEvent,
} from "./payloads";
import { generateWorkflowTraceId } from "./trace-id";
import { TerminalEventError } from "./types";

type AnyDb = NodePgDatabase<Record<string, never>>;
type WorkflowStatus = (typeof workflowStatusEnum.enumValues)[number];
type WorkflowRunPayload = NonNullable<
  Extract<
    ParsedQueuedWorkflowEvent,
    { eventType: "workflow_run" }
  >["payload"]["workflow_run"]
>;
type WorkflowJobPayload = NonNullable<
  Extract<
    ParsedQueuedWorkflowEvent,
    { eventType: "workflow_job" }
  >["payload"]["workflow_job"]
>;

function parseOptionalTimestamp(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function requireRepositoryId(event: ParsedQueuedWorkflowEvent): number {
  const repositoryId = repositoryIdFromQueuedEvent(event);
  if (!repositoryId) {
    throw new TerminalEventError("workflow event missing repository.id");
  }

  return repositoryId;
}

function workflowRunStatus(action: string): WorkflowStatus {
  switch (action) {
    case "requested":
    case "waiting":
    case "queued":
    case "in_progress":
    case "completed":
      return action;
    default:
      throw new TerminalEventError(
        `unsupported workflow_run action "${action}"`,
      );
  }
}

function workflowJobStatus(action: string): WorkflowStatus {
  switch (action) {
    case "requested":
    case "waiting":
    case "queued":
    case "in_progress":
    case "completed":
      return action;
    default:
      throw new TerminalEventError(
        `unsupported workflow_job action "${action}"`,
      );
  }
}

function workflowRunLastEventAt(workflowRun: WorkflowRunPayload): Date {
  return parseTimestamp(
    workflowRun.updated_at,
    workflowRun.run_started_at,
    workflowRun.created_at,
  );
}

function workflowJobLastEventAt(workflowJob: WorkflowJobPayload): Date {
  return parseTimestamp(
    workflowJob.completed_at,
    workflowJob.started_at,
    workflowJob.created_at,
  );
}

export async function upsertWorkflowRun(
  db: AnyDb,
  tenantId: number,
  event: Extract<ParsedQueuedWorkflowEvent, { eventType: "workflow_run" }>,
) {
  const workflowRun = event.payload.workflow_run;
  if (!workflowRun) {
    throw new TerminalEventError("workflow_run payload missing workflow_run");
  }

  const action = event.payload.action ?? "";
  const status = workflowRunStatus(action);
  const repository = event.payload.repository?.full_name ?? "";
  const repositoryId = requireRepositoryId(event);
  const runAttempt = workflowRun.run_attempt ?? 1;
  const lastEventAt = workflowRunLastEventAt(workflowRun);
  const opTimestamp = new Date();
  const conclusion =
    status === "completed" ? (workflowRun.conclusion ?? null) : null;
  const startedAt = parseOptionalTimestamp(workflowRun.run_started_at);
  const completedAt =
    status === "completed"
      ? (parseOptionalTimestamp(workflowRun.updated_at) ?? lastEventAt)
      : null;

  const metadata: WorkflowRunMetadata = {
    event: workflowRun.event ?? undefined,
    workflow_id: workflowRun.workflow_id ?? undefined,
    display_title: workflowRun.display_title ?? undefined,
    run_number: workflowRun.run_number ?? undefined,
    path: workflowRun.path ?? undefined,
    actor: workflowRun.actor?.login ?? undefined,
    triggering_actor: workflowRun.triggering_actor?.login ?? undefined,
    pull_requests: workflowRun.pull_requests?.map((pr) => pr.number),
    head_repository: workflowRun.head_repository?.full_name ?? undefined,
    html_url: workflowRun.html_url ?? undefined,
  };

  const values = {
    tenantId,
    runId: workflowRun.id,
    attempts: runAttempt,
    traceId: generateWorkflowTraceId(repositoryId, workflowRun.id, runAttempt),
    workflowName: workflowRun.name ?? "",
    repository,
    sha: workflowRun.head_sha ?? "",
    ref: workflowRun.head_branch ?? "",
    status,
    conclusion,
    authorEmail: workflowRun.head_commit?.author?.email ?? null,
    startedAt,
    completedAt,
    lastEventAt,
    metadata,
    // Our DB write timestamps are distinct from GitHub event times.
    createdAt: opTimestamp,
    updatedAt: opTimestamp,
  };

  const result = await db
    .insert(workflowRuns)
    .values(values)
    .onConflictDoUpdate({
      target: [
        workflowRuns.tenantId,
        workflowRuns.runId,
        workflowRuns.attempts,
      ],
      set: {
        traceId: sql`excluded.trace_id`,
        workflowName: sql`excluded.workflow_name`,
        repository: sql`excluded.repository`,
        sha: sql`excluded.sha`,
        ref: sql`excluded.ref`,
        status: sql`excluded.status`,
        conclusion: sql`excluded.conclusion`,
        authorEmail: sql`excluded.author_email`,
        startedAt: sql`excluded.run_started_at`,
        completedAt: sql`excluded.run_completed_at`,
        lastEventAt: sql`excluded.last_event_at`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`excluded.last_event_at >= ${workflowRuns.lastEventAt}`,
    })
    .returning({ traceId: workflowRuns.traceId });

  if (result.length > 0 && values.sha) {
    void notifyWorkflowUpdate(db, {
      tenantId,
      traceId: values.traceId,
      runId: String(values.runId),
      sha: values.sha,
    });
  }
}

export async function upsertWorkflowJob(
  db: AnyDb,
  tenantId: number,
  event: Extract<ParsedQueuedWorkflowEvent, { eventType: "workflow_job" }>,
) {
  const workflowJob = event.payload.workflow_job;
  if (!workflowJob) {
    throw new TerminalEventError("workflow_job payload missing workflow_job");
  }

  const action = event.payload.action ?? "";
  const status = workflowJobStatus(action);
  const repository = event.payload.repository?.full_name ?? "";
  const repositoryId = requireRepositoryId(event);
  const runAttempt = workflowJob.run_attempt ?? 1;
  const lastEventAt = workflowJobLastEventAt(workflowJob);
  const opTimestamp = new Date();
  const conclusion =
    status === "completed" ? (workflowJob.conclusion ?? null) : null;
  const startedAt = parseOptionalTimestamp(workflowJob.started_at);
  const completedAt =
    status === "completed"
      ? (parseOptionalTimestamp(workflowJob.completed_at) ?? lastEventAt)
      : null;

  const metadata: WorkflowJobMetadata = {
    workflow_name: workflowJob.workflow_name ?? undefined,
    runner_name: workflowJob.runner_name ?? undefined,
    runner_labels: workflowJob.runner_labels ?? undefined,
    runner_group_name: workflowJob.runner_group_name ?? undefined,
    html_url: workflowJob.html_url ?? undefined,
  };

  const values = {
    tenantId,
    jobId: workflowJob.id,
    runId: workflowJob.run_id,
    attempts: runAttempt,
    traceId: generateWorkflowTraceId(
      repositoryId,
      workflowJob.run_id,
      runAttempt,
    ),
    jobName: workflowJob.name ?? "",
    repository,
    sha: workflowJob.head_sha ?? "",
    ref: workflowJob.head_branch ?? "",
    status,
    conclusion,
    startedAt,
    completedAt,
    lastEventAt,
    metadata,
    // Our DB write timestamps are distinct from GitHub event times.
    createdAt: opTimestamp,
    updatedAt: opTimestamp,
  };

  const result = await db
    .insert(workflowJobs)
    .values(values)
    .onConflictDoUpdate({
      target: [workflowJobs.tenantId, workflowJobs.jobId],
      set: {
        runId: sql`excluded.run_id`,
        attempts: sql`excluded.attempts`,
        traceId: sql`excluded.trace_id`,
        jobName: sql`excluded.job_name`,
        repository: sql`excluded.repository`,
        sha: sql`excluded.sha`,
        ref: sql`excluded.ref`,
        status: sql`excluded.status`,
        conclusion: sql`excluded.conclusion`,
        startedAt: sql`excluded.started_at`,
        completedAt: sql`excluded.completed_at`,
        lastEventAt: sql`excluded.last_event_at`,
        metadata: sql`excluded.metadata`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`excluded.last_event_at >= ${workflowJobs.lastEventAt}`,
    })
    .returning({ traceId: workflowJobs.traceId });

  if (result.length > 0 && values.sha) {
    void notifyWorkflowUpdate(db, {
      tenantId,
      traceId: values.traceId,
      runId: String(values.runId),
      sha: values.sha,
    });
  }
}

export async function handleStatusEvent(
  db: AnyDb,
  tenantId: number,
  event: ParsedQueuedWorkflowEvent,
) {
  if (event.eventType === "workflow_run") {
    await upsertWorkflowRun(db, tenantId, event);
  } else {
    await upsertWorkflowJob(db, tenantId, event);
  }
}
