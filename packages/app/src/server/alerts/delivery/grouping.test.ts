import { describe, expect, it, vi } from "vitest";

// The tasks module reaches the worker enqueue plumbing; the mock only keeps
// the import from reaching the real database client.
vi.mock("@/db/client", () => ({ db: {}, pool: {} }));

import {
  type GroupMember,
  groupNotificationPlan,
  memberVerdict,
  nextGroupFlushAt,
  nextGroupFlushState,
} from "./grouping";
import { IDLE_GROUP_FLUSH_AT } from "./tasks";

const now = new Date("2026-08-06T10:00:00Z");

function member(
  overrides: {
    fingerprint?: string;
    eventType?: string;
    occurredAt?: string;
    flushedAt?: string | null;
  } = {},
): GroupMember<{
  id: string;
  sourceDefinitionId: string;
  instanceFingerprint: string;
  occurredAt: Date;
  eventType: string;
}> {
  const fingerprint = overrides.fingerprint ?? "inst-1";
  const eventType = overrides.eventType ?? "instance_fired";
  const occurredAt = new Date(overrides.occurredAt ?? "2026-08-06T10:00:00Z");
  return {
    event: {
      id: `${fingerprint}:${eventType}:${occurredAt.toISOString()}`,
      sourceDefinitionId: "def-1",
      instanceFingerprint: fingerprint,
      occurredAt,
      eventType,
    },
    flushedAt:
      overrides.flushedAt === undefined || overrides.flushedAt === null
        ? null
        : new Date(overrides.flushedAt),
  };
}

describe("nextGroupFlushAt", () => {
  it("uses group wait for a new notification group", () => {
    expect(nextGroupFlushAt(null, now, 30, 300).toISOString()).toBe(
      "2026-08-06T10:00:30.000Z",
    );
  });

  it("does not postpone the first flush when more events arrive", () => {
    const first = new Date("2026-08-06T10:00:10Z");
    expect(
      nextGroupFlushAt(
        { nextFlushAt: first, lastFlushedAt: null },
        now,
        30,
        300,
      ),
    ).toEqual(first);
  });

  it("pulls a repeat forward to the earliest group interval", () => {
    expect(
      nextGroupFlushAt(
        {
          nextFlushAt: new Date("2026-08-06T12:00:00Z"),
          lastFlushedAt: new Date("2026-08-06T09:58:00Z"),
        },
        now,
        30,
        300,
      ).toISOString(),
    ).toBe("2026-08-06T10:03:00.000Z");
  });

  it("keeps an already earlier scheduled flush", () => {
    const scheduled = new Date("2026-08-06T10:01:00Z");
    expect(
      nextGroupFlushAt(
        {
          nextFlushAt: scheduled,
          lastFlushedAt: new Date("2026-08-06T09:58:00Z"),
        },
        now,
        30,
        300,
      ),
    ).toEqual(scheduled);
  });
});

describe("groupNotificationPlan", () => {
  it("reports a resolution that joined the group after it occurred", () => {
    // The regression: this event occurred before the previous flush, so the
    // old occurredAt-vs-lastFlushedAt comparison treated it as already seen
    // and dropped it. Nobody was ever told the alert resolved.
    const plan = groupNotificationPlan([
      member({
        eventType: "instance_resolved",
        occurredAt: "2026-08-06T09:50:00Z",
        flushedAt: null,
      }),
    ]);
    expect(plan.notify.map((event) => event.eventType)).toEqual([
      "instance_resolved",
    ]);
    expect(plan.active).toEqual([]);
  });

  it("repeats only what is still firing once every member has been flushed", () => {
    const plan = groupNotificationPlan([
      member({ fingerprint: "a", flushedAt: "2026-08-06T09:59:00Z" }),
      member({
        fingerprint: "b",
        eventType: "instance_resolved",
        flushedAt: "2026-08-06T09:59:00Z",
      }),
    ]);
    expect(plan.notify.map((event) => event.instanceFingerprint)).toEqual([
      "a",
    ]);
    expect(plan.active.map((event) => event.instanceFingerprint)).toEqual([
      "a",
    ]);
  });

  it("includes resolutions again as soon as one member is unflushed", () => {
    const plan = groupNotificationPlan([
      member({ fingerprint: "a", flushedAt: "2026-08-06T09:59:00Z" }),
      member({
        fingerprint: "b",
        eventType: "instance_resolved",
        flushedAt: null,
      }),
    ]);
    expect(
      plan.notify.map((event) => event.instanceFingerprint).sort(),
    ).toEqual(["a", "b"]);
  });

  // The regression this fix closes: fire at T, resolve at T+15, flush at
  // T+30. Both memberships are unflushed (never carried into a
  // notification), so the old code reported only the newest event per
  // instance: "1 resolved" for an alert nobody was ever told was firing.
  it("drops a flap instead of announcing a resolve whose fire never went out", () => {
    const plan = groupNotificationPlan([
      member({ occurredAt: "2026-08-06T09:00:00Z", flushedAt: null }),
      member({
        eventType: "instance_resolved",
        occurredAt: "2026-08-06T09:30:00Z",
        flushedAt: null,
      }),
    ]);
    expect(plan.notify).toEqual([]);
    expect(plan.droppedUnannounced).toHaveLength(1);
    expect(plan.droppedUnannounced[0].eventType).toBe("instance_resolved");
    expect(plan.active).toEqual([]);
  });

  it("keeps notifying a resolve once its fire already went out in an earlier flush", () => {
    const plan = groupNotificationPlan([
      member({
        occurredAt: "2026-08-06T09:00:00Z",
        flushedAt: "2026-08-06T09:10:00Z",
      }),
      member({
        eventType: "instance_resolved",
        occurredAt: "2026-08-06T09:30:00Z",
        flushedAt: null,
      }),
    ]);
    expect(plan.notify).toHaveLength(1);
    expect(plan.notify[0].eventType).toBe("instance_resolved");
    expect(plan.droppedUnannounced).toEqual([]);
  });

  it("does not treat a lone deferred resolve as a flap", () => {
    // No fire-type member for this instance is in the batch at all: the
    // fire went out through an earlier, separate flush whose membership row
    // is already gone. This is the deferred-silence case the module doc
    // above describes, not a flap.
    const plan = groupNotificationPlan([
      member({
        eventType: "instance_resolved",
        occurredAt: "2026-08-06T09:50:00Z",
        flushedAt: null,
      }),
    ]);
    expect(plan.notify).toHaveLength(1);
    expect(plan.droppedUnannounced).toEqual([]);
  });
});

describe("nextGroupFlushState", () => {
  it("parks on the idle sentinel when nothing is left to do", () => {
    expect(
      nextGroupFlushState({
        repeatAt: null,
        pendingFlushAt: IDLE_GROUP_FLUSH_AT,
        hasUnflushedMembers: false,
        now,
        groupIntervalSeconds: 300,
      }),
    ).toEqual({ nextFlushAt: IDLE_GROUP_FLUSH_AT, enqueue: false });
  });

  // The concurrent insert leaves an unflushed membership. Parking on the
  // sentinel would strand it, because the job its writer enqueued returns
  // early once nextFlushAt is in the far future. Scheduling it at `now`
  // stranded nothing but re-armed the job with no delay, which is a tight
  // flush loop whenever the backlog cannot drain in one pass.
  it("schedules an unflushed member one interval out, never at now", () => {
    expect(
      nextGroupFlushState({
        repeatAt: null,
        pendingFlushAt: IDLE_GROUP_FLUSH_AT,
        hasUnflushedMembers: true,
        now,
        groupIntervalSeconds: 300,
      }),
    ).toEqual({
      nextFlushAt: new Date(now.getTime() + 300_000),
      enqueue: true,
    });
  });

  // The cap leaves members behind and writes the group's own schedule back.
  // That schedule is in the past by then, so it must not be taken verbatim.
  it("floors a consumed schedule instead of re-arming immediately", () => {
    const consumed = new Date(now.getTime() - 60_000);
    expect(
      nextGroupFlushState({
        repeatAt: null,
        pendingFlushAt: consumed,
        hasUnflushedMembers: true,
        now,
        groupIntervalSeconds: 300,
      }),
    ).toEqual({
      nextFlushAt: new Date(now.getTime() + 300_000),
      enqueue: true,
    });
  });

  // A route that asked for a slower cadence must not be flushed faster.
  it("paces on the group's own interval, not a constant", () => {
    expect(
      nextGroupFlushState({
        repeatAt: null,
        pendingFlushAt: new Date(now.getTime() - 60_000),
        hasUnflushedMembers: true,
        now,
        groupIntervalSeconds: 900,
      }).nextFlushAt,
    ).toEqual(new Date(now.getTime() + 900_000));
  });

  it("keeps a schedule another writer set rather than postponing it", () => {
    const pending = new Date("2026-08-06T10:00:30Z");
    expect(
      nextGroupFlushState({
        repeatAt: new Date("2026-08-06T10:05:00Z"),
        pendingFlushAt: pending,
        hasUnflushedMembers: true,
        now,
        groupIntervalSeconds: 300,
      }),
    ).toEqual({ nextFlushAt: pending, enqueue: true });
  });

  it("prefers the repeat when it lands first", () => {
    const repeatAt = new Date("2026-08-06T10:01:00Z");
    expect(
      nextGroupFlushState({
        repeatAt,
        pendingFlushAt: new Date("2026-08-06T10:04:00Z"),
        hasUnflushedMembers: true,
        now,
        groupIntervalSeconds: 300,
      }),
    ).toEqual({ nextFlushAt: repeatAt, enqueue: true });
  });

  it("ignores a pending schedule when every member has been flushed", () => {
    const repeatAt = new Date("2026-08-06T10:05:00Z");
    expect(
      nextGroupFlushState({
        repeatAt,
        pendingFlushAt: new Date("2026-08-06T10:00:30Z"),
        hasUnflushedMembers: false,
        now,
        groupIntervalSeconds: 300,
      }),
    ).toEqual({ nextFlushAt: repeatAt, enqueue: true });
  });
});

describe("memberVerdict", () => {
  const flushed = new Date("2026-08-06T09:55:00Z");
  const live = {
    ruleActive: true,
    eventType: "instance_fired",
    flushedAt: null,
    instanceFiring: true,
    resolveInBatch: false,
  };

  it("delivers a firing instance of a live rule", () => {
    expect(memberVerdict(live)).toEqual({ deliverable: true, terminal: null });
    expect(memberVerdict({ ...live, flushedAt: flushed })).toEqual({
      deliverable: true,
      terminal: null,
    });
  });

  it("drops paused and deleted rules, recording never-notified chains", () => {
    // false = paused, null = the definition row is gone (deleted).
    expect(memberVerdict({ ...live, ruleActive: false })).toEqual({
      deliverable: false,
      terminal: "rule_paused",
    });
    expect(memberVerdict({ ...live, ruleActive: null })).toEqual({
      deliverable: false,
      terminal: "rule_deleted",
    });
    // Already carried into a notification once: drop without a terminal row,
    // the withheld thing is only the repeat.
    expect(
      memberVerdict({ ...live, ruleActive: false, flushedAt: flushed }),
    ).toEqual({ deliverable: false, terminal: null });
  });

  it("drops a fire whose instance has stopped firing", () => {
    // The resolve that should have removed this member never arrived: the
    // labels changed, a silence swallowed it, or the preview was deleted.
    expect(memberVerdict({ ...live, instanceFiring: false })).toEqual({
      deliverable: false,
      terminal: "no_longer_firing",
    });
    // Already announced, so its chain has an outcome and owes no terminal.
    expect(
      memberVerdict({ ...live, instanceFiring: false, flushedAt: flushed }),
    ).toEqual({ deliverable: false, terminal: null });
  });

  it("leaves a fire alone when its resolve is in the same batch", () => {
    // The instance is correctly not firing here. The plan supersedes the fire
    // with the resolve and announces the recovery; dropping the fire would
    // take the flap bookkeeping with it.
    expect(
      memberVerdict({
        ...live,
        instanceFiring: false,
        resolveInBatch: true,
      }),
    ).toEqual({ deliverable: true, terminal: null });
  });

  it("always delivers a resolve", () => {
    expect(
      memberVerdict({
        ...live,
        eventType: "instance_resolved",
        instanceFiring: false,
      }),
    ).toEqual({ deliverable: true, terminal: null });
  });
});
