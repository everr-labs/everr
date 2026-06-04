import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { type Job, PgBoss } from "pg-boss";
import { db, pool } from "@/db/client";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { getTelemetryTracer } from "@/telemetry/node";
import { replayWebhookToCollector } from "./collector";
import { GH_EVENTS_CONFIG } from "./config";
import { firstHeader } from "./headers";
import {
  installationIdFromQueuedEvent,
  parseQueuedWorkflowEvent,
} from "./payloads";
import { handleStatusEvent } from "./status-writer";
import { resolveOrganizationId } from "./tenant-resolver";
import type { WebhookJobData } from "./types";
import { TerminalEventError } from "./types";

let boss: PgBoss | undefined;
const tracer = getTelemetryTracer("everr-app.github_events");

function getBoss(): PgBoss | undefined {
  return boss;
}

function createBoss(): PgBoss {
  return new PgBoss({
    db: {
      executeSql: (text: string, values?: unknown[]) =>
        pool.query(text, values as unknown[]),
    },
    migrate: true,
  });
}

async function processCollectorJob(job: Job<WebhookJobData>): Promise<void> {
  const eventType = firstHeader(job.data.headers, "x-github-event") ?? "";
  const body = Buffer.from(job.data.body, "base64");
  const parsed = parseQueuedWorkflowEvent(eventType, body);

  await tracer.startActiveSpan(
    "replay github webhook to collector",
    {
      attributes: {
        ...(eventType ? { "github.event.type": eventType } : {}),
        "pg_boss.job.id": job.id,
      },
      kind: SpanKind.INTERNAL,
    },
    async (span) => {
      try {
        const installationId = installationIdFromQueuedEvent(parsed);
        const organizationId = await resolveOrganizationId(installationId);
        await replayWebhookToCollector(
          { headers: job.data.headers, body },
          organizationId,
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `${err.name}: ${err.message}`,
        });

        if (error instanceof TerminalEventError) {
          serverLogger.error("github_events.collector.terminal_error", {
            ...(eventType ? { "github.event.type": eventType } : {}),
            ...exceptionAttributes(error),
            "pg_boss.job.id": job.id,
          });
          return;
        }

        throw error;
      } finally {
        span.end();
      }
    },
  );
}

async function processStatusJob(job: Job<WebhookJobData>): Promise<void> {
  const eventType = firstHeader(job.data.headers, "x-github-event") ?? "";
  const body = Buffer.from(job.data.body, "base64");
  const parsed = parseQueuedWorkflowEvent(eventType, body);

  await tracer.startActiveSpan(
    "handle github status event",
    {
      attributes: {
        ...(eventType ? { "github.event.type": eventType } : {}),
        "pg_boss.job.id": job.id,
      },
      kind: SpanKind.INTERNAL,
    },
    async (span) => {
      try {
        const installationId = installationIdFromQueuedEvent(parsed);
        const organizationId = await resolveOrganizationId(installationId);
        // biome-ignore lint/suspicious/noExplicitAny: db is badly typed
        await handleStatusEvent(db as any, organizationId, parsed);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `${err.name}: ${err.message}`,
        });

        if (error instanceof TerminalEventError) {
          serverLogger.error("github_events.status.terminal_error", {
            ...(eventType ? { "github.event.type": eventType } : {}),
            ...exceptionAttributes(error),
            "pg_boss.job.id": job.id,
          });
          return;
        }

        throw error;
      } finally {
        span.end();
      }
    },
  );
}

const WORK_OPTS = { localConcurrency: GH_EVENTS_CONFIG.workerCount };

async function startGitHubEventsRuntime(): Promise<PgBoss> {
  if (boss) return boss;

  serverLogger.info("github_events.runtime.start");
  boss = createBoss();

  boss.on("error", (error) => {
    serverLogger.error(
      "github_events.pg_boss.error",
      exceptionAttributes(error),
    );
  });

  await boss.start();

  await Promise.all([
    boss.createQueue("gh-collector"),
    boss.createQueue("gh-status"),
  ]);

  boss.work<WebhookJobData>(
    "gh-collector",
    WORK_OPTS,
    context.bind(ROOT_CONTEXT, async (jobs) => {
      await Promise.all(
        jobs.map(async (job) => {
          try {
            await processCollectorJob(job);
          } catch (error) {
            if (error instanceof TerminalEventError) {
              serverLogger.error("github_events.collector.terminal_error", {
                ...exceptionAttributes(error),
                "pg_boss.job.id": job.id,
              });
              return;
            }
            throw error;
          }
        }),
      );
    }),
  );

  boss.work<WebhookJobData>(
    "gh-status",
    WORK_OPTS,
    context.bind(ROOT_CONTEXT, async (jobs) => {
      await Promise.all(
        jobs.map(async (job) => {
          try {
            await processStatusJob(job);
          } catch (error) {
            if (error instanceof TerminalEventError) {
              serverLogger.error("github_events.status.terminal_error", {
                ...exceptionAttributes(error),
                "pg_boss.job.id": job.id,
              });
              return;
            }
            throw error;
          }
        }),
      );
    }),
  );

  return boss;
}

export async function enqueueWebhookEvent(
  eventId: string,
  data: WebhookJobData,
): Promise<void> {
  let b = getBoss();
  if (!b) {
    b = await startGitHubEventsRuntime();
  }

  await Promise.all(
    (["gh-collector", "gh-status"] as const).map((queue) =>
      b.send(queue, data, {
        id: eventId,
        retryLimit: GH_EVENTS_CONFIG.maxAttempts,
        retryBackoff: true,
      }),
    ),
  );
}

async function stopGitHubEventsRuntime(): Promise<void> {
  const b = boss;
  boss = undefined;
  await b?.stop();
}

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    await stopGitHubEventsRuntime();
  });
}
