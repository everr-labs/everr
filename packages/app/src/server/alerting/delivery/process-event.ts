import { and, eq, isNull, TransactionRollbackError } from "drizzle-orm";
import {
  AlertEventTaskPayloadSchema,
  enqueueFlushGroup,
} from "@/data/alerting/delivery/tasks";
import { db } from "@/db/client";
import {
  alertEvents,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import { journalTerminalRow, recordAlertHistory } from "../history/clickhouse";
import { nextGroupFlushAt } from "./grouping";
import { claimDeliverableEvent } from "./journal-reader";
import {
  deferSuppressedEvent,
  eventStillFiring,
  matchingSilence,
} from "./suppression";
import { dispatchTargetsForEvent } from "./targeting";

export async function processAlertEvent(rawPayload: unknown): Promise<void> {
  const { eventId } = AlertEventTaskPayloadSchema.parse(rawPayload);
  const event = await claimDeliverableEvent(eventId);
  if (!event || event.processedAt) return;
  const now = new Date();
  if (event.suppressed) {
    // Guarded the same as the dispatch stamp below: a concurrent lifecycle
    // cancel may have already claimed this event and projected its own
    // terminal. Muted chains carry no terminal of their own either way, so a
    // lost claim needs nothing further here.
    await db
      .update(alertEvents)
      .set({ processedAt: now })
      .where(processedStampGuard(event.id));
    return;
  }
  if (
    event.eventType !== "instance_resolved" &&
    !(await eventStillFiring(event))
  ) {
    const stamped = await db
      .update(alertEvents)
      .set({ processedAt: now })
      .where(processedStampGuard(event.id))
      .returning({ id: alertEvents.id });
    // Lost to a concurrent cancel: its projection owns the terminal.
    if (stamped.length === 0) return;
    // A fire reached here after its instance had already stopped firing (a
    // worker outage and recovery, most often). Nobody was ever told it
    // fired, so notifying a resolve later would announce an alert that was
    // never announced as firing; the chain still needs a terminal so it does
    // not read as forever in flight.
    await recordAlertHistory(event.sourceDefinitionId, [
      journalTerminalRow(event, { reason: "no_longer_firing" }),
    ]);
    return;
  }
  const silence = await matchingSilence(event, now);
  if (silence) {
    await deferSuppressedEvent(event, silence, now);
    return;
  }
  if (event.silenceId) {
    await db
      .update(alertEvents)
      .set({ silenceId: null })
      .where(eq(alertEvents.id, event.id));
  }

  const targets = await dispatchTargetsForEvent(event);
  if (targets.length === 0) {
    const stamped = await db
      .update(alertEvents)
      .set({ processedAt: now })
      .where(processedStampGuard(event.id))
      .returning({ id: alertEvents.id });
    // Lost to a concurrent cancel: its projection owns the terminal.
    if (stamped.length === 0) return;
    // Nothing to deliver to: the rule names no channels and the org has no
    // default destination for this severity. No group is created, so no
    // flush runs and no flush terminal can ever land. The chain gets its
    // terminal here instead of reading as forever in flight.
    await recordAlertHistory(event.sourceDefinitionId, [
      journalTerminalRow(event, { reason: "no_channels" }),
    ]);
    return;
  }
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
        const group = await claimNotificationGroup(tx, event, target, now);
        await tx
          .insert(alertNotificationGroupEvents)
          .values({
            organizationId: event.organizationId,
            groupId: group.id,
            eventId: event.id,
          })
          .onConflictDoNothing();
        await enqueueFlushGroup(tx, group.id, group.nextFlushAt);
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

/**
 * Lock the target group, or create it. `FOR UPDATE` only serializes on rows
 * that exist, so two events creating the same group key race the insert; the
 * loser's `ON CONFLICT DO NOTHING` returns no row, and the second pass locks
 * the winner's now-committed row and folds into it, as if the group had
 * existed all along. Without the fallback, the loser's whole membership
 * transaction rolled back onto a Graphile retry, burning an attempt exactly
 * during a burst of simultaneous first-fires.
 */
export async function claimNotificationGroup(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  event: { organizationId: string },
  target: Awaited<ReturnType<typeof dispatchTargetsForEvent>>[number],
  now: Date,
) {
  const attempt = async () => {
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
    if (existing) {
      const [updated] = await tx
        .update(alertNotificationGroups)
        .set({
          nextFlushAt: nextGroupFlushAt(
            {
              nextFlushAt: existing.nextFlushAt,
              lastFlushedAt: existing.lastFlushedAt,
            },
            now,
          ),
          updatedAt: now,
        })
        .where(eq(alertNotificationGroups.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await tx
      .insert(alertNotificationGroups)
      .values({
        organizationId: event.organizationId,
        groupKey: target.groupKey,
        defaultTier: target.defaultTier,
        directAlertDefinitionId: target.directAlertDefinitionId,
        nextFlushAt: nextGroupFlushAt(null, now),
      })
      .onConflictDoNothing({
        target: [
          alertNotificationGroups.organizationId,
          alertNotificationGroups.groupKey,
        ],
      })
      .returning();
    return created;
  };
  const group = (await attempt()) ?? (await attempt());
  if (!group) {
    // Interference on both passes inside one transaction; fail to the task
    // retry, which is what every loss cost before the fallback existed.
    throw new Error(`Notification group claim failed: ${target.groupKey}`);
  }
  return group;
}
