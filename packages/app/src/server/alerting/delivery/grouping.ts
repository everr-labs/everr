import {
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/alerting/delivery/defaults";
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

interface GroupSchedule {
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

interface GroupNotificationPlan<E> {
  /** Still-firing latest event per instance; what survives the flush. */
  active: E[];
  /** What this flush reports. `active` is always a subset. */
  notify: E[];
  /**
   * A resolve whose fire never reached a notification, because this
   * instance's only fire-type member in the batch was never flushed. It is
   * excluded from `notify`, since announcing a recovery nobody heard about is
   * worse than silence. The chain still needs a terminal, or it reads as
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
 * joined the group after it. That is exactly what a deferred event does when
 * its silence lapses.
 */
export function groupNotificationPlan<E extends GroupedEvent>(
  members: GroupMember<E>[],
): GroupNotificationPlan<E> {
  const sorted = [...members].sort(
    (a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime(),
  );
  const latestByInstance = new Map<string, E>();
  // Whether this instance's fire-type members in this batch ever reached a
  // notification. Tracked from fire-type members only. A lone resolve with no
  // fire in the batch is a reconsidered deferral, not a flap: its fire went
  // out through an earlier flush whose membership row is already gone.
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

interface MemberVerdict {
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
 * The membership list only proposes; `alert_instances` decides. A membership
 * means "a fire arrived and no resolve has come since". That is a copy of the
 * truth, kept correct by one message, and several ordinary actions destroy
 * it. A label change deletes the instances. A silence built from an
 * instance's labels consumes the resolve as well as the fire. A pause resets
 * the instances, and a resolve can run out of process attempts.
 *
 * Each leaves a fire that no resolve will remove, announced with every later
 * notification of that group.
 *
 * Guarding those actions one at a time holds only until the next one appears.
 * So a fire is deliverable only while its instance is firing now, which is
 * the test `processAlertEvent` applies at dispatch. The flush applies it
 * again, because a member can go stale long after dispatch.
 *
 * `resolveInBatch` is the one case to leave alone: the instance is correctly
 * not firing, and `groupNotificationPlan` already supersedes the fire with
 * the resolve. Dropping the fire here would take the flap bookkeeping with
 * it.
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
 * When the group should next flush, given that a membership may have been
 * added while this flush was evaluating suppression.
 *
 * Such a membership is not in the claimed set, so it survives the delete, but
 * parking `nextFlushAt` on the idle sentinel would strand it.
 *
 * A schedule still ahead is taken as it stands, so this never postpones work
 * another writer scheduled. One that is not ahead is the schedule this flush
 * just consumed, and it is floored at one group interval out. Taking it
 * verbatim re-arms the job with no delay, so a group that cannot drain its
 * backlog flushes in a tight loop. That interval is also what a member
 * dispatched just after this flush would wait, so the leftovers of a capped
 * claim and the news arriving a moment later land in one notification.
 */
export function nextGroupFlushState(opts: {
  /** The group's `nextFlushAt` as read under lock in the committing tx. */
  pendingFlushAt: Date;
  hasUnflushedMembers: boolean;
  now: Date;
}): { nextFlushAt: Date; enqueue: boolean } {
  if (!opts.hasUnflushedMembers) {
    return { nextFlushAt: IDLE_GROUP_FLUSH_AT, enqueue: false };
  }
  const candidate =
    opts.pendingFlushAt < IDLE_GROUP_FLUSH_AT
      ? opts.pendingFlushAt.getTime()
      : opts.now.getTime();
  return {
    nextFlushAt: new Date(
      candidate > opts.now.getTime()
        ? candidate
        : opts.now.getTime() + ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1_000,
    ),
    enqueue: true,
  };
}

export function nextGroupFlushAt(
  existing: GroupSchedule | null,
  now: Date,
): Date {
  const firstArrival = new Date(
    now.getTime() + ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000,
  );
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
        existing.lastFlushedAt.getTime() +
          ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1_000,
      ),
    ),
  );
}
