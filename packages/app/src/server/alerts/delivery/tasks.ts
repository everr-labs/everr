import { z } from "zod";
import type { Transaction } from "@/db/client";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";

export const ALERT_PROCESS_EVENT_TASK = "alerts/process-event";
export const ALERT_FLUSH_GROUP_TASK = "alerts/flush-group";
export const ALERT_SEND_DELIVERY_TASK = "alerts/send-delivery";

export const AlertEventTaskPayloadSchema = z.object({
  eventId: z.string().uuid(),
});

export const AlertGroupTaskPayloadSchema = z.object({
  groupId: z.string().uuid(),
});

export const AlertDeliveryTaskPayloadSchema = z.object({
  dedupKey: z.string().min(1),
});

export const IDLE_GROUP_FLUSH_AT = new Date("9999-12-31T23:59:59.999Z");

export const PROCESS_EVENT_MAX_ATTEMPTS = 5;

// Every process-event enqueue shares one retry policy and one job-key scheme,
// so a policy change is a one-site edit. The optional key suffix keeps
// re-checks (deferrals, releases) from replacing the original dispatch job.
export async function enqueueProcessAlertEvent(
  tx: Transaction,
  eventId: string,
  opts: { keySuffix?: string; runAt?: Date; queueName?: string } = {},
): Promise<void> {
  await addWorkerJobInTransaction(
    tx,
    ALERT_PROCESS_EVENT_TASK,
    { eventId },
    {
      jobKey: opts.keySuffix
        ? `${ALERT_PROCESS_EVENT_TASK}:${eventId}:${opts.keySuffix}`
        : `${ALERT_PROCESS_EVENT_TASK}:${eventId}`,
      jobKeyMode: "replace",
      maxAttempts: PROCESS_EVENT_MAX_ATTEMPTS,
      ...(opts.runAt ? { runAt: opts.runAt } : {}),
      ...(opts.queueName ? { queueName: opts.queueName } : {}),
    },
  );
}
