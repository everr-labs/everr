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
          message: z.string().nullish(),
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
      steps: z
        .array(
          z.object({
            number: z.number().int(),
            name: z.string(),
            status: z.string(),
            conclusion: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .optional(),
  repository: repositorySchema,
});

const deploymentSchema = z.object({
  action: z.string().optional(),
  installation: z
    .object({ id: z.number().int().positive().optional() })
    .optional(),
  repository: repositorySchema,
  deployment: z
    .object({
      id: z.number().int(),
      sha: z.string().nullish(),
      ref: z.string().nullish(),
      task: z.string().nullish(),
      environment: z.string().nullish(),
      created_at: z.string().nullish(),
      updated_at: z.string().nullish(),
      creator: z.object({ login: z.string().optional() }).nullish(),
    })
    .optional(),
  workflow_run: z
    .object({
      id: z.number().int(),
      run_attempt: z.number().int().optional(),
    })
    .optional(),
});

const deploymentStatusSchema = deploymentSchema.extend({
  deployment_status: z
    .object({
      id: z.number().int(),
      state: z.string(),
      environment_url: z.string().nullish(),
      target_url: z.string().nullish(),
      log_url: z.string().nullish(),
      description: z.string().nullish(),
      created_at: z.string().nullish(),
      updated_at: z.string().nullish(),
    })
    .optional(),
});

export type WorkflowRunPayload = z.infer<typeof workflowRunSchema>;
export type WorkflowJobPayload = z.infer<typeof workflowJobSchema>;
export type DeploymentPayload = z.infer<typeof deploymentSchema>;
export type DeploymentStatusPayload = z.infer<typeof deploymentStatusSchema>;
export type ParsedQueuedWorkflowEvent =
  | { eventType: "workflow_run"; payload: WorkflowRunPayload }
  | { eventType: "workflow_job"; payload: WorkflowJobPayload };
export type ParsedQueuedCollectorEvent =
  | ParsedQueuedWorkflowEvent
  | { eventType: "deployment"; payload: DeploymentPayload }
  | { eventType: "deployment_status"; payload: DeploymentStatusPayload };

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

export function parseQueuedCollectorEvent(
  eventType: string,
  body: Buffer,
): ParsedQueuedCollectorEvent {
  if (eventType === "deployment") {
    return {
      eventType,
      payload: parseJson(body, deploymentSchema, "deployment"),
    };
  }

  if (eventType === "deployment_status") {
    return {
      eventType,
      payload: parseJson(body, deploymentStatusSchema, "deployment_status"),
    };
  }

  return parseQueuedWorkflowEvent(eventType, body);
}

export function installationIdFromQueuedEvent(
  event: ParsedQueuedCollectorEvent,
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
