import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Task, TaskList } from "graphile-worker";
import { db } from "@/db/client";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { getTelemetryTracer } from "@/telemetry/node";
import { replayWebhookToCollector } from "./collector";
import { firstHeader } from "./headers";
import { COLLECTOR_TASK_IDENTIFIER, STATUS_TASK_IDENTIFIER } from "./identifiers";
import {
  eventAttributesFromQueuedEvent,
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
    // oxlint-disable-next-line typescript/consistent-type-assertions -- graphile-worker types the job payload as `unknown`; the enqueue side guarantees the WebhookJobData shape
    const data = payload as WebhookJobData;
    const eventType = firstHeader(data.headers, "x-github-event") ?? "";
    const body = Buffer.from(data.body, "base64");
    const parsed = parseQueuedWorkflowEvent(eventType, body);
    const jobId = helpers.job.id;
    const eventAttributes = eventAttributesFromQueuedEvent(parsed);

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
              serverLogger.info("github_events.jobs.stale_installation_dropped", {
                ...terminalAttributes,
                "error.message": err.message,
                "error.type": err.name,
              });
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
    handleStatusEvent(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- drizzle NodePgDatabase schema generic variance: the app db isn't assignable to handleStatusEvent's AnyDb (Record<string, never>) schema
      db as unknown as Parameters<typeof handleStatusEvent>[0],
      organizationId,
      parsed,
    ),
);

export const githubEventsTaskList: TaskList = {
  [COLLECTOR_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processCollectorTask),
  [STATUS_TASK_IDENTIFIER]: context.bind(ROOT_CONTEXT, processStatusTask),
};
