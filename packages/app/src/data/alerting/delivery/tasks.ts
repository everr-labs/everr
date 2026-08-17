import { z } from "zod";
import type { Transaction } from "@/db/client";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import { alertingPartitionQueue } from "../scheduling/evaluation-jobs.server";

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

// Not exported, unlike PROCESS_EVENT_MAX_ATTEMPTS: no set-based enqueue
// outside this module writes a flush job's max_attempts by hand.
const FLUSH_GROUP_MAX_ATTEMPTS = 5;

// A flush job's identity is the group and when it is due, nothing else. A
// storm of events landing on one group must collapse onto the one job that
// runs at that time, not enqueue one job per event: `jobKeyMode: "replace"`
// only dedupes when both dispatch sites build the same key.
export function flushGroupJobKey(groupId: string, flushAt: Date): string {
  return `${ALERT_FLUSH_GROUP_TASK}:${groupId}:${flushAt.toISOString()}`;
}

/**
 * The two dispatch sites (a dispatch reaching a group, and a flush arming its
 * own next run) enqueue through here, so the key scheme above, the replace
 * mode it depends on, the retry policy and the partition queue are one thing
 * rather than four that a third site could get subtly wrong. The queue is what
 * bounds how many flushes of different groups run at once.
 */
export async function enqueueFlushGroup(
  tx: Transaction,
  groupId: string,
  flushAt: Date,
): Promise<void> {
  await addWorkerJobInTransaction(
    tx,
    ALERT_FLUSH_GROUP_TASK,
    { groupId },
    {
      jobKey: flushGroupJobKey(groupId, flushAt),
      jobKeyMode: "replace",
      maxAttempts: FLUSH_GROUP_MAX_ATTEMPTS,
      queueName: alertingPartitionQueue("group", groupId),
      runAt: flushAt,
    },
  );
}

// Every process-event enqueue shares one retry policy and one job-key scheme,
// so a policy change is a one-site edit. The optional key suffix keeps
// re-checks (deferrals, releases) from replacing the original dispatch job.
export async function enqueueProcessAlertEvent(
  tx: Transaction,
  eventId: string,
  opts: { keySuffix?: string; runAt?: Date } = {},
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
    },
  );
}
