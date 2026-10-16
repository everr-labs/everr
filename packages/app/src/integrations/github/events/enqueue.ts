import { addWorkerJob } from "@/server/worker/jobs";
import { GH_EVENTS_CONFIG } from "./config";
import {
  COLLECTOR_TASK_IDENTIFIER,
  STATUS_TASK_IDENTIFIER,
} from "./identifiers";
import type { WebhookJobData } from "./types";

export async function enqueueWebhookEvent(
  eventId: string,
  data: WebhookJobData,
): Promise<void> {
  await Promise.all(
    [COLLECTOR_TASK_IDENTIFIER, STATUS_TASK_IDENTIFIER].map((taskIdentifier) =>
      addWorkerJob(taskIdentifier, data, {
        jobKey: `${taskIdentifier}:${eventId}`,
        jobKeyMode: "replace",
        maxAttempts: GH_EVENTS_CONFIG.maxAttempts,
      }),
    ),
  );
}
