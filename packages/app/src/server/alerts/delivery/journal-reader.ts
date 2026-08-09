import { and, eq } from "drizzle-orm";
import { type DbExecutor, db } from "@/db/client";
import {
  alertDefinitions,
  alertEvents,
  alertNotificationGroupEvents,
} from "@/db/schema";

/**
 * The delivery pipeline's only reads of the journal. Every query here
 * hard-codes `kind = 'notifying'`, so a state-only row (pending, closed, hold
 * decisions) can never be selected for delivery, whatever its event type
 * says. Nothing outside this module may query `alert_events` for deliverable
 * work.
 */
export function deliverableEventQuery(executor: DbExecutor, eventId: string) {
  return executor
    .select()
    .from(alertEvents)
    .where(and(eq(alertEvents.id, eventId), eq(alertEvents.kind, "notifying")))
    .limit(1);
}

export async function claimDeliverableEvent(eventId: string) {
  const [event] = await deliverableEventQuery(db, eventId);
  return event ?? null;
}

/**
 * A group's claimed memberships, with the owning rule's liveness read in the
 * same statement. `ruleActive` is null when the definition is gone (the rule
 * was deleted; its journal rows outlive it), false when it is paused. The
 * flush drops both instead of notifying.
 */
export function deliverableGroupMemberQuery(
  executor: DbExecutor,
  groupId: string,
) {
  return executor
    .select({
      event: alertEvents,
      flushedAt: alertNotificationGroupEvents.flushedAt,
      ruleActive: alertDefinitions.active,
      ruleSpec: alertDefinitions.spec,
    })
    .from(alertNotificationGroupEvents)
    .innerJoin(
      alertEvents,
      and(
        eq(
          alertNotificationGroupEvents.organizationId,
          alertEvents.organizationId,
        ),
        eq(alertNotificationGroupEvents.eventId, alertEvents.id),
        eq(alertEvents.kind, "notifying"),
      ),
    )
    .leftJoin(
      alertDefinitions,
      and(
        eq(alertEvents.organizationId, alertDefinitions.organizationId),
        eq(alertEvents.sourceDefinitionId, alertDefinitions.id),
      ),
    )
    .where(eq(alertNotificationGroupEvents.groupId, groupId));
}
