import { IDLE_GROUP_FLUSH_AT } from "./tasks";

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
    const key = `${event.sourceDefinitionId}:${event.instanceFingerprint}`;
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
    const key = `${event.sourceDefinitionId}:${event.instanceFingerprint}`;
    const flap =
      event.eventType === "instance_resolved" &&
      fireMemberSeen.get(key) === false;
    (flap ? droppedUnannounced : notify).push(event);
  }
  return { active, notify, droppedUnannounced };
}

type MemberLiveness = "deliverable" | "dropped" | "dropped_unnotified";

/**
 * What a flush does with a claimed membership, given the owning rule's
 * liveness. A paused (`ruleActive` false) or deleted (`ruleActive` null) rule
 * must not notify, so its members are dropped at claim time. A dropped member
 * that was never carried into a notification also gets a terminal
 * `notification_suppressed` row; without it, its chain would read as still in
 * flight forever.
 */
export function memberLiveness(
  ruleActive: boolean | null,
  flushedAt: Date | null,
): MemberLiveness {
  if (ruleActive) return "deliverable";
  return flushedAt === null ? "dropped_unnotified" : "dropped";
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
  if (!existing) {
    return new Date(now.getTime() + groupWaitSeconds * 1_000);
  }
  if (!existing.lastFlushedAt) return existing.nextFlushAt;
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
