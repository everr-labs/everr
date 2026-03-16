import { z } from "zod";
import { TerminalEventError } from "./types";

const repositorySchema = z
  .object({
    id: z.number().int().positive().optional(),
    full_name: z.string().optional(),
    html_url: z.string().optional(),
  })
  .optional();

const workflowRunSchema = z.object({
  action: z.string().optional(),
  installation: z
    .object({
      id: z.number().int().positive().optional(),
    })
    .optional(),
  workflow_run: z
    .object({
      id: z.number().int(),
      run_attempt: z.number().int().optional(),
      name: z.string().nullish(),
      html_url: z.string().nullish(),
      head_commit: z
        .object({
          author: z
            .object({
              email: z.string().nullish(),
            })
            .optional(),
        })
        .optional(),
      head_branch: z.string().nullish(),
      head_sha: z.string().nullish(),
      conclusion: z.string().nullish(),
      created_at: z.string().nullish(),
      updated_at: z.string().nullish(),
      run_started_at: z.string().nullish(),
      event: z.string().nullish(),
      workflow_id: z.number().int().nullish(),
      display_title: z.string().nullish(),
      run_number: z.number().int().nullish(),
      path: z.string().nullish(),
      actor: z.object({ login: z.string() }).nullish(),
      triggering_actor: z.object({ login: z.string() }).nullish(),
      pull_requests: z.array(z.object({ number: z.number().int() })).nullish(),
      head_repository: z.object({ full_name: z.string().optional() }).nullish(),
    })
    .optional(),
  repository: repositorySchema,
});

const workflowJobSchema = z.object({
  action: z.string().optional(),
  installation: z
    .object({
      id: z.number().int().positive().optional(),
    })
    .optional(),
  workflow_job: z
    .object({
      id: z.number().int(),
      run_id: z.number().int(),
      run_attempt: z.number().int().optional(),
      name: z.string().nullish(),
      html_url: z.string().nullish(),
      head_branch: z.string().nullish(),
      head_sha: z.string().nullish(),
      conclusion: z.string().nullish(),
      created_at: z.string().nullish(),
      started_at: z.string().nullish(),
      completed_at: z.string().nullish(),
      workflow_name: z.string().nullish(),
      runner_name: z.string().nullish(),
      runner_labels: z.array(z.string()).nullish(),
      runner_group_name: z.string().nullish(),
    })
    .optional(),
  repository: repositorySchema,
});

export type WorkflowRunPayload = z.infer<typeof workflowRunSchema>;
export type WorkflowJobPayload = z.infer<typeof workflowJobSchema>;
export type ParsedQueuedWorkflowEvent =
  | { eventType: "workflow_run"; payload: WorkflowRunPayload }
  | { eventType: "workflow_job"; payload: WorkflowJobPayload };

function parseJson<T>(body: Buffer, schema: z.ZodSchema<T>, label: string): T {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body.toString("utf8"));
  } catch {
    throw new TerminalEventError(`invalid ${label} JSON payload`);
  }

  const parsed = schema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new TerminalEventError(`invalid ${label} payload shape`);
  }

  return parsed.data;
}

export function parseQueuedWorkflowEvent(
  eventType: string,
  body: Buffer,
): ParsedQueuedWorkflowEvent {
  if (eventType === "workflow_run") {
    return {
      eventType,
      payload: parseJson(body, workflowRunSchema, "workflow_run"),
    };
  }

  if (eventType === "workflow_job") {
    return {
      eventType,
      payload: parseJson(body, workflowJobSchema, "workflow_job"),
    };
  }

  throw new TerminalEventError(
    `unsupported workflow event type "${eventType}"`,
  );
}

export function installationIdFromQueuedEvent(
  event: ParsedQueuedWorkflowEvent,
): number {
  const installationId =
    event.payload.installation?.id && event.payload.installation.id > 0
      ? event.payload.installation.id
      : null;

  if (!installationId) {
    throw new TerminalEventError("missing installation.id");
  }

  return installationId;
}

export function repositoryIdFromQueuedEvent(
  event: ParsedQueuedWorkflowEvent,
): number | null {
  const repositoryId = event.payload.repository?.id;
  return repositoryId && repositoryId > 0 ? repositoryId : null;
}

function hasWorkflowPayload(event: ParsedQueuedWorkflowEvent): boolean {
  if (event.eventType === "workflow_run") {
    return Boolean(event.payload.workflow_run);
  }

  return Boolean(event.payload.workflow_job);
}

export function enqueueMetadataFromWebhookEvent(
  eventType: string,
  body: Buffer,
): {
  enqueue: boolean;
  repositoryId: number | null;
} {
  try {
    const event = parseQueuedWorkflowEvent(eventType, body);
    return {
      enqueue: hasWorkflowPayload(event),
      repositoryId: repositoryIdFromQueuedEvent(event),
    };
  } catch {
    return {
      enqueue: true,
      repositoryId: null,
    };
  }
}

export function repositoryHTMLURL(repository?: {
  full_name?: string;
  html_url?: string;
}): string {
  if (repository?.html_url) {
    return repository.html_url;
  }

  if (repository?.full_name) {
    return `https://github.com/${repository.full_name}`;
  }

  return "https://github.com";
}

export function parseTimestamp(
  ...values: Array<string | null | undefined>
): Date {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }

  return new Date();
}

export function mapConclusionToOutcome(
  conclusion: string | null | undefined,
): string {
  switch (conclusion ?? "") {
    case "success":
      return "success";
    case "failure":
      return "failure";
    case "cancelled":
      return "cancelled";
    case "timed_out":
    case "startup_failure":
      return "error";
    case "skipped":
    case "neutral":
      return "skipped";
    case "action_required":
      return "action_required";
    case "stale":
      return "stale";
    default:
      return "";
  }
}
