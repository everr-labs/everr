import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { Task, TaskList } from "graphile-worker";
import { db } from "@/db/client";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { getTelemetryTracer } from "@/telemetry/node";
import { replayWebhookToCollector } from "./collector";
import { firstHeader } from "./headers";
import {
  COLLECTOR_TASK_IDENTIFIER,
  STATUS_TASK_IDENTIFIER,
} from "./identifiers";
import {
  installationIdFromQueuedEvent,
  parseQueuedWorkflowEvent,
} from "./payloads";
import { handleStatusEvent } from "./status-writer";
import { resolveOrganizationId } from "./tenant-resolver";
import type { WebhookJobData } from "./types";
import { StaleInstallationError, TerminalEventError } from "./types";

const tracer = getTelemetryTracer("everr-app.github_events");
const loggedStaleInstallationIds = new Set<number>();

type ParsedQueuedEvent = ReturnType<typeof parseQueuedWorkflowEvent>;

type WebhookTaskAction = (args: {
  body: Buffer;
  data: WebhookJobData;
  organizationId: string;
  parsed: ParsedQueuedEvent;
}) => Promise<void>;

function makeWebhookTask(
  spanName: string,
  terminalLogKey: string,
  action: WebhookTaskAction,
): Task {
  return async (payload, helpers) => {
    const data = payload as WebhookJobData;
    const eventType = firstHeader(data.headers, "x-github-event") ?? "";
    const body = Buffer.from(data.body, "base64");
    const parsed = parseQueuedWorkflowEvent(eventType, body);
    const jobId = helpers.job.id;
    const eventAttributes = eventDetailAttributes(parsed);

    await tracer.startActiveSpan(
      spanName,
      {
        attributes: {
          ...(eventType ? { "github.event.type": eventType } : {}),
          ...eventAttributes,
          "graphile_worker.job.id": jobId,
        },
        kind: SpanKind.INTERNAL,
      },
      async (span) => {
        try {
          const installationId = installationIdFromQueuedEvent(parsed);
          const organizationId = await resolveOrganizationId(installationId);
          span.setAttribute("everr.organization.id", organizationId);
          await action({ body, data, organizationId, parsed });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const terminalAttributes = {
            ...(eventType ? { "github.event.type": eventType } : {}),
            ...eventAttributes,
            ...installationAttribute(parsed),
            "graphile_worker.job.id": jobId,
          };

          if (error instanceof StaleInstallationError) {
            if (shouldLogStaleInstallation(parsed)) {
              serverLogger.info(
                "github_events.jobs.stale_installation_dropped",
                {
                  ...terminalAttributes,
                  "error.message": err.message,
                  "error.type": err.name,
                },
              );
            }
            return;
          }

          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `${err.name}: ${err.message}`,
          });

          if (error instanceof TerminalEventError) {
            serverLogger.error(terminalLogKey, {
              ...exceptionAttributes(error),
              ...terminalAttributes,
            });
            return;
          }

          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

function eventDetailAttributes(
  parsed: ParsedQueuedEvent,
): Record<string, string | number> {
  const attributes: Record<string, string | number> = {};

  if (parsed.payload.action) {
    attributes["github.event.action"] = parsed.payload.action;
  }
  const repository = parsed.payload.repository?.full_name;
  if (repository) {
    attributes["github.repository.full_name"] = repository;
  }

  if (parsed.eventType === "workflow_run") {
    const run = parsed.payload.workflow_run;
    if (run) {
      attributes["github.workflow_run.id"] = run.id;
      if (run.name) attributes["github.workflow_run.name"] = run.name;
      if (run.run_attempt) {
        attributes["github.workflow_run.run_attempt"] = run.run_attempt;
      }
    }
  } else {
    const job = parsed.payload.workflow_job;
    if (job) {
      attributes["github.workflow_job.id"] = job.id;
      attributes["github.workflow_run.id"] = job.run_id;
      if (job.workflow_name) {
        attributes["github.workflow_run.name"] = job.workflow_name;
      }
      if (job.run_attempt) {
        attributes["github.workflow_run.run_attempt"] = job.run_attempt;
      }
    }
  }

  return attributes;
}

function installationId(parsed: ParsedQueuedEvent): number | null {
  try {
    return installationIdFromQueuedEvent(parsed);
  } catch {
    return null;
  }
}

function installationAttribute(parsed: ParsedQueuedEvent) {
  const id = installationId(parsed);
  return id === null ? {} : { "github.installation.id": id };
}

function shouldLogStaleInstallation(parsed: ParsedQueuedEvent): boolean {
  const id = installationId(parsed);
  if (id === null) return true;
  if (loggedStaleInstallationIds.has(id)) return false;
  loggedStaleInstallationIds.add(id);
  return true;
}

const processCollectorTask = makeWebhookTask(
  "github_events.jobs.replay_webhook_to_collector",
  "github_events.jobs.collector_terminal_error",
  ({ body, data, organizationId }) =>
    replayWebhookToCollector({ headers: data.headers, body }, organizationId),
);

const processStatusTask = makeWebhookTask(
  "github_events.jobs.handle_status_event",
  "github_events.jobs.handle_status_terminal_error",
  ({ organizationId, parsed }) =>
    // biome-ignore lint/suspicious/noExplicitAny: db is badly typed
    handleStatusEvent(db as any, organizationId, parsed),
);

export const githubEventsTaskList: TaskList = {
  [COLLECTOR_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processCollectorTask),
  [STATUS_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processStatusTask),
};
