import { type Job, PgBoss } from "pg-boss";
import { db, pool } from "@/db/client";
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

export function getBoss(): PgBoss | undefined {
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
  const installationId = installationIdFromQueuedEvent(parsed);
  const organizationId = await resolveOrganizationId(installationId);
  await replayWebhookToCollector(
    { headers: job.data.headers, body },
    organizationId,
  );
}

async function processStatusJob(job: Job<WebhookJobData>): Promise<void> {
  const eventType = firstHeader(job.data.headers, "x-github-event") ?? "";
  const body = Buffer.from(job.data.body, "base64");
  const parsed = parseQueuedWorkflowEvent(eventType, body);
  const installationId = installationIdFromQueuedEvent(parsed);
  const organizationId = await resolveOrganizationId(installationId);
  // biome-ignore lint/suspicious/noExplicitAny: db is badly typed
  await handleStatusEvent(db as any, organizationId, parsed);
}

const WORK_OPTS = { localConcurrency: GH_EVENTS_CONFIG.workerCount };

export async function startGitHubEventsRuntime(): Promise<PgBoss> {
  if (boss) return boss;

  console.log("[startup] Starting GitHub events runtime...");
  boss = createBoss();

  boss.on("error", console.error);

  await boss.start();

  await Promise.all([
    boss.createQueue("gh-collector"),
    boss.createQueue("gh-status"),
  ]);

  boss.work<WebhookJobData>("gh-collector", WORK_OPTS, async (jobs) => {
    await Promise.all(
      jobs.map(async (job) => {
        try {
          await processCollectorJob(job);
        } catch (error) {
          if (error instanceof TerminalEventError) {
            console.error("[gh-collector] terminal error, not retrying", {
              jobId: job.id,
              error: error.message,
            });
            return;
          }
          throw error;
        }
      }),
    );
  });

  boss.work<WebhookJobData>("gh-status", WORK_OPTS, async (jobs) => {
    await Promise.all(
      jobs.map(async (job) => {
        try {
          await processStatusJob(job);
        } catch (error) {
          if (error instanceof TerminalEventError) {
            console.error("[gh-status] terminal error, not retrying", {
              jobId: job.id,
              error: error.message,
            });
            return;
          }
          throw error;
        }
      }),
    );
  });

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

export async function stopGitHubEventsRuntime(): Promise<void> {
  const b = boss;
  boss = undefined;
  await b?.stop();
}

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    await stopGitHubEventsRuntime();
  });
}
