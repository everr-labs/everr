import { and, asc, eq, sql } from "drizzle-orm";
import { type DbExecutor, db } from "@/db/client";
import {
  alertDefinitions,
  alertDeliveryEvents,
  alertEvents,
  alertNotificationGroupEvents,
} from "@/db/schema";

/**
 * The delivery pipeline's only reads of the journal. Every query here
 * hard-codes `kind = 'notifying'`, so a state-only row (pending, closed, hold
 * decisions) can never be selected for delivery, whatever its event type
 * says. Nothing outside this module may read `alert_events` for delivery
 * work, the history trail included.
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
 *
 * `cap` bounds how many rows one flush claims: a storm feeding one group
 * (thousands of firing instances into one receiver) must not push a single
 * worker through a suppression check per member unbounded. Whatever is left
 * past the cap stays linked and unflushed, which the flush's own
 * pending-member count turns into a follow-up flush.
 *
 * Unflushed members come first, then the oldest by event id (UUIDv7, so
 * creation-ordered). Ordering on the id alone starved them: a member that
 * flushes while still firing is written back with the same id, so once a
 * group holds more than `cap` firing members the same oldest ones win every
 * claim, the newer ones are never reached, and the unflushed count keeps
 * re-arming the follow-up flush forever.
 *
 * Already-flushed members stay claimable, and that is deliberate. The flush
 * re-announces them when a repeat comes due, and claiming is also how their
 * membership rows are pruned: a row leaves the group by being claimed once
 * more and then not written back as active. Filtering them out here would
 * stop repeats and leak a row for every instance that resolves.
 */
export function deliverableGroupMemberQuery(
  executor: DbExecutor,
  groupId: string,
  cap: number,
) {
  return (
    executor
      .select({
        event: alertEvents,
        flushedAt: alertNotificationGroupEvents.flushedAt,
        ruleActive: alertDefinitions.active,
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
      .where(eq(alertNotificationGroupEvents.groupId, groupId))
      // `false` sorts before `true`, so an unflushed member outranks a flushed
      // one whatever their ids say.
      .orderBy(
        asc(sql`${alertNotificationGroupEvents.flushedAt} IS NOT NULL`),
        asc(alertEvents.id),
      )
      .limit(cap)
  );
}

/**
 * The notifying events a delivery was built from, for its history trail. One
 * delivery can cover several events once grouping has merged them, and each
 * gets its own trail row so a per-instance history stays complete.
 */
export function linkedEventsForDeliveryQuery(
  executor: DbExecutor,
  organizationId: string,
  dedupKey: string,
) {
  return executor
    .select({ event: alertEvents })
    .from(alertDeliveryEvents)
    .innerJoin(
      alertEvents,
      and(
        eq(alertDeliveryEvents.organizationId, alertEvents.organizationId),
        eq(alertDeliveryEvents.eventId, alertEvents.id),
        eq(alertEvents.kind, "notifying"),
      ),
    )
    .where(
      and(
        eq(alertDeliveryEvents.organizationId, organizationId),
        eq(alertDeliveryEvents.deliveryDedupKey, dedupKey),
      ),
    );
}

/**
 * At least one still-active rule behind a composed notification. A send job
 * can outlive a pause or a delete that committed after its delivery row was
 * written; a notification whose every source rule is gone must not send. One
 * live rule is enough: dropping the whole send would lose that rule's only
 * notification.
 */
export function liveRuleForDeliveryQuery(
  executor: DbExecutor,
  dedupKey: string,
) {
  return executor
    .select({ eventId: alertDeliveryEvents.eventId })
    .from(alertDeliveryEvents)
    .innerJoin(
      alertEvents,
      and(
        eq(alertDeliveryEvents.organizationId, alertEvents.organizationId),
        eq(alertDeliveryEvents.eventId, alertEvents.id),
        eq(alertEvents.kind, "notifying"),
      ),
    )
    .innerJoin(
      alertDefinitions,
      and(
        eq(alertEvents.organizationId, alertDefinitions.organizationId),
        eq(alertEvents.sourceDefinitionId, alertDefinitions.id),
        eq(alertDefinitions.active, true),
      ),
    )
    .where(eq(alertDeliveryEvents.deliveryDedupKey, dedupKey))
    .limit(1);
}
