import { and, eq, isNull, TransactionRollbackError } from "drizzle-orm";
import { alertingPartitionQueue } from "@/data/alerting/scheduling/evaluation-jobs.server";
import { db } from "@/db/client";
import {
  alertEvents,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import { nextGroupFlushAt } from "./grouping";
import { claimDeliverableEvent } from "./journal-reader";
import {
  deferSuppressedEvent,
  eventStillFiring,
  isInhibited,
  matchingSilence,
} from "./suppression";
import { dispatchTargetsForEvent } from "./targeting";
import { ALERT_FLUSH_GROUP_TASK, AlertEventTaskPayloadSchema } from "./tasks";

export async function processAlertEvent(rawPayload: unknown): Promise<void> {
  const { eventId } = AlertEventTaskPayloadSchema.parse(rawPayload);
  const event = await claimDeliverableEvent(eventId);
  if (!event || event.processedAt) return;
  const now = new Date();
  if (event.suppressed) {
    await db
      .update(alertEvents)
      .set({ processedAt: now })
      .where(eq(alertEvents.id, event.id));
    return;
  }
  if (
    event.eventType !== "instance_resolved" &&
    !(await eventStillFiring(event))
  ) {
    await db
      .update(alertEvents)
      .set({ processedAt: now })
      .where(eq(alertEvents.id, event.id));
    return;
  }
  const silence = await matchingSilence(event, now);
  const inhibited = silence ? false : await isInhibited(event);
  if (silence || inhibited) {
    await deferSuppressedEvent(event, silence, inhibited, now);
    return;
  }
  if (event.silenced || event.inhibited || event.silenceId) {
    await db
      .update(alertEvents)
      .set({ silenced: false, inhibited: false, silenceId: null })
      .where(eq(alertEvents.id, event.id));
  }

  const targets = await dispatchTargetsForEvent(event);
  // One transaction for every membership plus the processed stamp. The stamp
  // is the claim: a concurrent pause or delete cancels events through
  // `processed_at IS NULL`, so either the cancel wins and this rolls back
  // (no membership, the cancel's terminal is the only record), or this
  // commits first and the cancel skips the event (the flush drops the
  // membership and writes the only terminal). Split transactions left a
  // window where both wrote one. Targets are locked in group-key order so
  // two events dispatching to overlapping groups cannot deadlock.
  try {
    await db.transaction(async (tx) => {
      const ordered = [...targets].sort((a, b) =>
        a.groupKey.localeCompare(b.groupKey),
      );
      for (const target of ordered) {
        const [existing] = await tx
          .select()
          .from(alertNotificationGroups)
          .where(
            and(
              eq(alertNotificationGroups.organizationId, event.organizationId),
              eq(alertNotificationGroups.groupKey, target.groupKey),
            ),
          )
          .for("update")
          .limit(1);
        const nextFlushAt = nextGroupFlushAt(
          existing
            ? {
                nextFlushAt: existing.nextFlushAt,
                lastFlushedAt: existing.lastFlushedAt,
              }
            : null,
          now,
          target.groupWaitSeconds,
          target.groupIntervalSeconds,
        );
        const [group] = existing
          ? await tx
              .update(alertNotificationGroups)
              .set({
                nextFlushAt,
                repeatIntervalSeconds: target.repeatIntervalSeconds,
                updatedAt: now,
              })
              .where(eq(alertNotificationGroups.id, existing.id))
              .returning()
          : await tx
              .insert(alertNotificationGroups)
              .values({
                organizationId: event.organizationId,
                groupKey: target.groupKey,
                receiverId: target.receiverId,
                directAlertDefinitionId: target.directAlertDefinitionId,
                labels: target.groupLabels,
                nextFlushAt,
                repeatIntervalSeconds: target.repeatIntervalSeconds,
              })
              .returning();
        await tx
          .insert(alertNotificationGroupEvents)
          .values({
            organizationId: event.organizationId,
            groupId: group.id,
            eventId: event.id,
          })
          .onConflictDoNothing();
        await addWorkerJobInTransaction(
          tx,
          ALERT_FLUSH_GROUP_TASK,
          { groupId: group.id },
          {
            jobKey: `${ALERT_FLUSH_GROUP_TASK}:${group.id}:${nextFlushAt.toISOString()}:${event.id}`,
            jobKeyMode: "replace",
            maxAttempts: 5,
            queueName: alertingPartitionQueue("group", group.id),
            runAt: nextFlushAt,
          },
        );
      }
      const stamped = await tx
        .update(alertEvents)
        .set({ processedAt: now })
        .where(processedStampGuard(event.id))
        .returning({ id: alertEvents.id });
      if (stamped.length === 0) tx.rollback();
    });
  } catch (error) {
    // The claim was lost to a concurrent cancel; its projection owns the
    // terminal, and the rolled-back memberships never existed.
    if (error instanceof TransactionRollbackError) return;
    throw error;
  }
}

/**
 * The claim under which memberships commit. Guarded on `processed_at IS NULL`
 * so a lifecycle cancel and this dispatch cannot both own the event.
 */
export function processedStampGuard(eventId: string) {
  return and(eq(alertEvents.id, eventId), isNull(alertEvents.processedAt));
}
