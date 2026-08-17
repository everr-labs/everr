import { IDLE_GROUP_FLUSH_AT } from "@/data/alerting/delivery/tasks";
import type { AlertingLifecycleReason } from "@/data/alerting/vocabulary";

/**
 * What identifies an instance across the events that describe it. A fire and
 * the resolve that ends it share this key, and so does the row in
 * `alert_instances` the two of them move.
 */
export function instanceKey(
  event: Pick<GroupedEvent, "sourceDefinitionId" | "instanceFingerprint">,
): string {
  return `${event.sourceDefinitionId}:${event.instanceFingerprint}`;
}

export interface GroupSchedule {
  nextFlushAt: Date;
  lastFlushedAt: Date | null;
}

export interface GroupMember<E> {
  event: E;
  /** Null until a flush has taken this membership into a notification. */
  flushedAt: Date | null;
}

interface GroupedEvent {
  sourceDefinitionId: string;
  instanceFingerprint: string;
  occurredAt: Date;
  eventType: string;
}

export interface GroupNotificationPlan<E> {
  /** Still-firing latest event per instance; what survives the flush. */
  active: E[];
  /** What this flush reports. `active` is always a subset. */
  notify: E[];
  /**
   * A resolve whose fire never reached a notification: this instance's only
   * fire-type member in this batch was never flushed. Excluded from
   * `notify` (announcing a recovery nobody was told about is worse than
   * silence), but the chain still needs a terminal so it does not read as
   * forever in flight.
   */
  droppedUnannounced: E[];
}

/**
 * Decide what a flush sends, from the memberships it claimed.
 *
 * Newness comes from `flushedAt`, which is durable membership state, not from
 * comparing an event's `occurredAt` against the group's last flush. The clock
 * comparison dropped any event that occurred before the previous flush but
 * joined the group after it, which is exactly what a deferred event does when
 * its silence lapses.
 */
export function groupNotificationPlan<E extends GroupedEvent>(
  members: GroupMember<E>[],
): GroupNotificationPlan<E> {
  const sorted = [...members].sort(
    (a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime(),
  );
  const latestByInstance = new Map<string, E>();
  // Whether this instance's fire-type member(s) in this batch were ever
  // carried into a prior notification. Only tracked from fire-type members:
  // a lone resolve with no fire counterpart in the batch is a reconsidered
  // deferral (the fire went out through an earlier, separate flush whose
  // membership row is already gone), not a flap, and this must not touch it.
  const fireMemberSeen = new Map<string, boolean>();
  for (const { event, flushedAt } of sorted) {
    const key = instanceKey(event);
    latestByInstance.set(key, event);
    if (event.eventType !== "instance_resolved") {
      fireMemberSeen.set(
        key,
        (fireMemberSeen.get(key) ?? false) || flushedAt !== null,
      );
    }
  }
  const latest = [...latestByInstance.entries()];
  const active = latest
    .filter(([, event]) => event.eventType !== "instance_resolved")
    .map(([, event]) => event);
  const hasUnflushed = members.some((member) => member.flushedAt === null);
  const announced = hasUnflushed ? latest.map(([, event]) => event) : active;
  const notify: E[] = [];
  const droppedUnannounced: E[] = [];
  for (const event of announced) {
    const key = instanceKey(event);
    const flap =
      event.eventType === "instance_resolved" &&
      fireMemberSeen.get(key) === false;
    (flap ? droppedUnannounced : notify).push(event);
  }
  return { active, notify, droppedUnannounced };
}

export interface MemberVerdict {
  deliverable: boolean;
  /**
   * The terminal this drop owes the member's chain, or null when it owes
   * none. A member already carried into a notification has an outcome
   * recorded, so dropping it later adds nothing; one that never notified
   * would read as still in flight forever without a terminal here.
   */
  terminal: Extract<
    AlertingLifecycleReason,
    "rule_paused" | "rule_deleted" | "no_longer_firing"
  > | null;
}

/**
 * What a flush does with a claimed membership.
 *
 * The membership list only proposes. `alert_instances` decides, and this is
 * where the two meet. A membership means "a fire arrived and no resolve has
 * come since", which is a copy of the truth kept correct by one message: the
 * resolve. Several ordinary actions destroy that message. Changing a rule's
 * label columns deletes the instances, so the resolve can never be produced.
 * A silence built from an instance's labels matches the resolve as well as
 * the fire, and consumes it. A pause resets the instances, so a condition
 * that clears before the rule resumes produces no resolve either. A resolve
 * whose process job runs out of attempts never reaches the group at all.
 * Each one leaves a fire in the group that no resolve will ever remove, and
 * it is announced with every later notification of that group, forever.
 *
 * So the fix is not to guard those actions one at a time, which only holds
 * until the next way to lose a resolve appears. A fire is deliverable only
 * while its instance is firing right now, and `instanceFiring` carries that
 * live state. This is the same test `processAlertEvent` applies at dispatch;
 * the flush must apply it too, because a member can go stale long after it
 * was dispatched.
 *
 * `resolveInBatch` is the one case the check must keep its hands off: when
 * the instance's resolve is in this same claimed batch, the instance is
 * correctly not firing, and `groupNotificationPlan` already supersedes the
 * fire with the resolve and announces the recovery. Dropping the fire here
 * would take the flap bookkeeping with it.
 */
export function memberVerdict(opts: {
  /** False when the rule is paused, null when the definition row is gone. */
  ruleActive: boolean | null;
  eventType: string;
  flushedAt: Date | null;
  /** Whether this member's instance is firing right now. */
  instanceFiring: boolean;
  /** Whether this instance's resolve is in the same claimed batch. */
  resolveInBatch: boolean;
}): MemberVerdict {
  if (!opts.ruleActive) {
    return {
      deliverable: false,
      terminal:
        opts.flushedAt !== null
          ? null
          : opts.ruleActive === null
            ? "rule_deleted"
            : "rule_paused",
    };
  }
  if (opts.eventType === "instance_resolved" || opts.resolveInBatch) {
    return { deliverable: true, terminal: null };
  }
  if (!opts.instanceFiring) {
    return {
      deliverable: false,
      terminal: opts.flushedAt === null ? "no_longer_firing" : null,
    };
  }
  return { deliverable: true, terminal: null };
}

/**
 * When the group should next flush, given a membership may have been added
 * while this flush was evaluating suppression.
 *
 * Such a membership is not in the claimed set, so it survives the delete, but
 * it would be stranded if the flush parked `nextFlushAt` on the idle sentinel.
 * Taking the earliest candidate never postpones work another writer scheduled.
 *
 * A schedule that is still ahead is taken as it stands. One that is not, which
 * means the schedule this flush just consumed, is floored at one group
 * interval past this flush. Taking a consumed schedule verbatim re-arms the
 * job with no delay at all, so a group that cannot drain its backlog in one
 * pass flushes in a tight loop. The interval is also what a member dispatched
 * just after this flush would wait (see `nextGroupFlushAt`), so the leftovers
 * of a capped claim and the news arriving a moment later land in one
 * notification instead of two.
 */
export function nextGroupFlushState(opts: {
  repeatAt: Date | null;
  /** The group's `nextFlushAt` as read under lock in the committing tx. */
  pendingFlushAt: Date;
  hasUnflushedMembers: boolean;
  now: Date;
  /** The group's own configured interval, never a constant: a route that asked
   * for a slower cadence must not be flushed faster than it asked. */
  groupIntervalSeconds: number;
}): { nextFlushAt: Date; enqueue: boolean } {
  const times: number[] = [];
  if (opts.repeatAt) times.push(opts.repeatAt.getTime());
  if (opts.hasUnflushedMembers) {
    const candidate =
      opts.pendingFlushAt < IDLE_GROUP_FLUSH_AT
        ? opts.pendingFlushAt.getTime()
        : opts.now.getTime();
    times.push(
      candidate > opts.now.getTime()
        ? candidate
        : opts.now.getTime() + opts.groupIntervalSeconds * 1_000,
    );
  }
  if (times.length === 0) {
    return { nextFlushAt: IDLE_GROUP_FLUSH_AT, enqueue: false };
  }
  return { nextFlushAt: new Date(Math.min(...times)), enqueue: true };
}

export function nextGroupFlushAt(
  existing: GroupSchedule | null,
  now: Date,
  groupWaitSeconds: number,
  groupIntervalSeconds: number,
): Date {
  const firstArrival = new Date(now.getTime() + groupWaitSeconds * 1_000);
  if (!existing) return firstArrival;
  if (!existing.lastFlushedAt) {
    // A booked first flush stands: later arrivals join it rather than
    // postponing it. A group parked on the idle sentinel has no booking at
    // all, and to an arriving event that is the same as a group nobody has
    // seen. Reading the sentinel as a booking writes the year 9999 back on
    // every later dispatch, and the group never notifies again.
    return existing.nextFlushAt < IDLE_GROUP_FLUSH_AT
      ? existing.nextFlushAt
      : firstArrival;
  }
  return new Date(
    Math.min(
      existing.nextFlushAt.getTime(),
      Math.max(
        now.getTime(),
        existing.lastFlushedAt.getTime() + groupIntervalSeconds * 1_000,
      ),
    ),
  );
}
