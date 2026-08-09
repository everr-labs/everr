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
  const latestByInstance = new Map<string, E>();
  for (const { event } of [...members].sort(
    (a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime(),
  )) {
    latestByInstance.set(
      `${event.sourceDefinitionId}:${event.instanceFingerprint}`,
      event,
    );
  }
  const latest = [...latestByInstance.values()];
  const active = latest.filter(
    (event) => event.eventType !== "instance_resolved",
  );
  const hasUnflushed = members.some((member) => member.flushedAt === null);
  return { active, notify: hasUnflushed ? latest : active };
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
 */
export function nextGroupFlushState(opts: {
  repeatAt: Date | null;
  /** The group's `nextFlushAt` as read under lock in the committing tx. */
  pendingFlushAt: Date;
  hasUnflushedMembers: boolean;
  now: Date;
}): { nextFlushAt: Date; enqueue: boolean } {
  const times: number[] = [];
  if (opts.repeatAt) times.push(opts.repeatAt.getTime());
  if (opts.hasUnflushedMembers) {
    times.push(
      opts.pendingFlushAt < IDLE_GROUP_FLUSH_AT
        ? opts.pendingFlushAt.getTime()
        : opts.now.getTime(),
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
