import { db } from "#app/db/client.ts";
import { addWorkerJobInTransaction } from "#app/server/worker/jobs.ts";
import { GH_EVENTS_CONFIG } from "./config";
import { COLLECTOR_TASK_IDENTIFIER, STATUS_TASK_IDENTIFIER } from "./identifiers";
import type { WebhookJobData } from "./types";

export async function enqueueWebhookEvent(eventId: string, data: WebhookJobData): Promise<void> {
  // A webhook is acknowledged only after both effects have durable intent.
  // A failed enqueue must leave neither consumer with a partial delivery.
  await db.transaction(async (tx) => {
    for (const taskIdentifier of [COLLECTOR_TASK_IDENTIFIER, STATUS_TASK_IDENTIFIER]) {
      await addWorkerJobInTransaction(tx, taskIdentifier, data, {
        jobKey: `${taskIdentifier}:${eventId}`,
        jobKeyMode: "replace",
        maxAttempts: GH_EVENTS_CONFIG.maxAttempts,
      });
    }
  });
}
