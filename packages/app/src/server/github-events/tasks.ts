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
  installationIdFromQueuedEvent,
  parseQueuedWorkflowEvent,
} from "./payloads";
import { handleStatusEvent } from "./status-writer";
import { resolveOrganizationId } from "./tenant-resolver";
import type { WebhookJobData } from "./types";
import { TerminalEventError } from "./types";

export const COLLECTOR_TASK_IDENTIFIER = "github-events/collector";
export const STATUS_TASK_IDENTIFIER = "github-events/status";
const tracer = getTelemetryTracer("everr-app.github_events");

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

    await tracer.startActiveSpan(
      spanName,
      {
        attributes: {
          ...(eventType ? { "github.event.type": eventType } : {}),
          "graphile_worker.job.id": jobId,
        },
        kind: SpanKind.INTERNAL,
      },
      async (span) => {
        try {
          const installationId = installationIdFromQueuedEvent(parsed);
          const organizationId = await resolveOrganizationId(installationId);
          await action({ body, data, organizationId, parsed });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `${err.name}: ${err.message}`,
          });

          if (error instanceof TerminalEventError) {
            serverLogger.error(terminalLogKey, {
              ...(eventType ? { "github.event.type": eventType } : {}),
              ...exceptionAttributes(error),
              "graphile_worker.job.id": jobId,
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
