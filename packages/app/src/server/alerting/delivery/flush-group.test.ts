import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupRow: null as Record<string, unknown> | null,
  memberRows: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  // Everything the commit transaction inserted, in order.
  inserts: [] as unknown[],
  // Consumed in order by the commit transaction: the re-read-under-lock
  // select, then the pending-unflushed-count select.
  commitSelectQueue: [] as unknown[][],
  loadSilences: vi.fn(() => Promise.resolve([])),
  loadInhibition: vi.fn(() =>
    Promise.resolve({ inhibitions: [], sources: [] }),
  ),
  // Every member's instance is still firing unless a test says otherwise.
  loadFiringKeys: vi.fn(
    (
      _organizationId: string,
      events: {
        sourceDefinitionId: string;
        instanceFingerprint: string;
      }[],
    ) =>
      Promise.resolve(
        new Set(
          events.map(
            (event) =>
              `${event.sourceDefinitionId}:${event.instanceFingerprint}`,
          ),
        ),
      ),
  ),
  recordHistory: vi.fn(() => Promise.resolve()),
  addWorkerJob: vi.fn(() => Promise.resolve(undefined)),
  transactionCalls: 0,
  // The channels attached to a group's receiver or direct rule.
  channelRows: [] as unknown[],
}));

vi.mock("@/db/client", () => {
  return {
    db: {
      // The receiver/rule -> channels lookup, outside any transaction.
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () => Promise.resolve(mocks.channelRows),
            }),
          }),
        }),
      }),
      transaction: (fn: (tx: unknown) => Promise<unknown>) => {
        mocks.transactionCalls += 1;
        if (mocks.transactionCalls === 1) {
          // The claim transaction: lock-read the group, maybe park it idle.
          const tx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => ({
                    limit: () =>
                      Promise.resolve(mocks.groupRow ? [mocks.groupRow] : []),
                  }),
                }),
              }),
            }),
            update: () => ({
              set: (values: Record<string, unknown>) => {
                mocks.updates.push(values);
                return { where: () => Promise.resolve(undefined) };
              },
            }),
          };
          return fn(tx);
        }
        // The commit transaction: re-read under lock, insert/delete
        // memberships, read the pending count, reschedule.
        const tx = {
          select: () => ({
            from: () => ({
              where: () => {
                const rows = mocks.commitSelectQueue.shift() ?? [];
                return Object.assign(Promise.resolve(rows), {
                  for: () => ({ limit: () => Promise.resolve(rows) }),
                });
              },
            }),
          }),
          insert: () => ({
            // Awaited bare by the membership and delivery-event writes, and
            // chained by the delivery write that needs to know whether it won
            // the dedup key.
            values: (values: unknown) => {
              mocks.inserts.push(values);
              return Object.assign(Promise.resolve(undefined), {
                onConflictDoNothing: () => ({
                  returning: () =>
                    Promise.resolve([{ dedupKey: "dedup-key-1" }]),
                }),
              });
            },
          }),
          delete: () => ({ where: () => Promise.resolve(undefined) }),
          update: () => ({
            set: (values: Record<string, unknown>) => {
              mocks.updates.push(values);
              return { where: () => Promise.resolve(undefined) };
            },
          }),
        };
        return fn(tx);
      },
    },
    pool: {},
  };
});

vi.mock("./journal-reader", () => ({
  deliverableGroupMemberQuery: () => Promise.resolve(mocks.memberRows),
}));

vi.mock("@/server/worker/jobs", () => ({
  addWorkerJobInTransaction: mocks.addWorkerJob,
}));

vi.mock("./suppression", () => ({
  loadActiveSilences: mocks.loadSilences,
  loadInhibitionContext: mocks.loadInhibition,
  loadFiringInstanceKeys: mocks.loadFiringKeys,
  matchSilence: () => null,
  matchInhibition: () => false,
  deferSuppressedEvent: vi.fn(),
}));

vi.mock("../history/clickhouse", () => ({
  recordAlertHistory: mocks.recordHistory,
  historyDefFromJournalRow: (row: unknown) => row,
  suppressionHistoryRow: (opts: unknown) => opts,
}));

import { CHANNEL_TEXT_MAX } from "@/data/alerting/delivery/channel-text-limits";
import { IDLE_GROUP_FLUSH_AT } from "@/data/alerting/delivery/tasks";
import {
  flushAlertGroup,
  formatNotification,
  type NotificationEvent,
} from "./flush-group";

beforeEach(() => {
  mocks.groupRow = null;
  mocks.memberRows = [];
  mocks.updates = [];
  mocks.inserts = [];
  mocks.commitSelectQueue = [];
  mocks.transactionCalls = 0;
  mocks.loadSilences.mockClear();
  mocks.loadInhibition.mockClear();
  mocks.loadFiringKeys.mockClear();
  mocks.recordHistory.mockClear();
  mocks.channelRows = [];
});

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    eventType: "instance_fired",
    slug: "default/high-5xx",
    instanceLabels: { host: "web-1" },
    notificationTitle: "",
    notificationDescription: "",
    ...overrides,
  };
}

describe("formatNotification", () => {
  it("keeps a small group byte for byte", () => {
    const events = [
      event(),
      event({ eventType: "instance_resolved", slug: "default/latency" }),
    ];
    expect(formatNotification(events)).toEqual({
      title: "Everr alert: 1 firing, 1 resolved",
      body: "Firing: default/high-5xx (host=web-1)\nResolved: default/latency (host=web-1)",
    });
  });

  it("cuts a large group to a bounded body and says how many were cut", () => {
    const events = Array.from({ length: 300 }, (_, i) =>
      event({ instanceLabels: { host: `web-${i}` } }),
    );
    const { title, body } = formatNotification(events);
    expect(title).toBe("Everr alert: 300 firing");
    const lines = body.split("\n");
    expect(lines.at(-1)).toMatch(/^…and \d+ more events in this group$/);
    const shown = lines.length - 1;
    expect(shown).toBeLessThanOrEqual(20);
    expect(lines.at(-1)).toBe(`…and ${300 - shown} more events in this group`);
    expect(body.length).toBeLessThan(
      CHANNEL_TEXT_MAX.discord - title.length - 4,
    );
  });

  it("caps one pathological event so it cannot eat the budget", () => {
    const events = [
      event({
        notificationDescription: "x".repeat(10_000),
        instanceLabels: { host: "web-1", region: "y".repeat(5_000) },
      }),
      event({ slug: "default/second" }),
    ];
    const { body } = formatNotification(events);
    const lines = body.split("\n");
    expect(lines[0]?.length).toBeLessThanOrEqual(200);
    expect(lines[0]?.endsWith("…")).toBe(true);
    // The huge first event must not push the second one out.
    expect(lines[1]).toBe("Firing: default/second (host=web-1)");
    expect(body.length).toBeLessThan(500);
  });

  it("counts every event in the title even when lines are cut", () => {
    const events = [
      ...Array.from({ length: 50 }, (_, i) =>
        event({ instanceLabels: { host: `web-${i}` } }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        event({
          eventType: "instance_resolved",
          instanceLabels: { host: `web-${i}` },
        }),
      ),
    ];
    expect(formatNotification(events).title).toBe(
      "Everr alert: 50 firing, 30 resolved",
    );
  });
});

describe("flushAlertGroup empty claim", () => {
  it("parks nextFlushAt on the idle sentinel instead of leaving it in the past", async () => {
    mocks.groupRow = {
      id: "5cbb1c68-5cc9-4444-8000-000000000001",
      nextFlushAt: new Date("2026-08-10T09:00:00Z"),
    };
    mocks.memberRows = [];

    await flushAlertGroup({ groupId: "5cbb1c68-5cc9-4444-8000-000000000001" });

    expect(mocks.updates).toEqual([
      expect.objectContaining({ nextFlushAt: IDLE_GROUP_FLUSH_AT }),
    ]);
  });

  it("touches nothing when the group is not due yet", async () => {
    mocks.groupRow = {
      id: "5cbb1c68-5cc9-4444-8000-000000000001",
      nextFlushAt: new Date(Date.now() + 60_000),
    };
    mocks.memberRows = [];

    await flushAlertGroup({ groupId: "5cbb1c68-5cc9-4444-8000-000000000001" });

    expect(mocks.updates).toEqual([]);
  });
});

describe("flushAlertGroup suppression batching", () => {
  const GROUP_ID = "5cbb1c68-5cc9-4444-8000-000000000002";

  function member(i: number) {
    return {
      event: {
        id: `event-${i}`,
        organizationId: "org-1",
        sourceDefinitionId: "def-1",
        instanceFingerprint: `fp-${i}`,
        occurredAt: new Date("2026-08-10T08:59:00Z"),
        eventType: "instance_fired",
        instanceLabels: {},
        silenced: false,
        inhibited: false,
        silenceId: null,
      },
      flushedAt: null,
      ruleActive: true,
    };
  }

  it("loads silences and inhibition sources once, not once per member", async () => {
    const group = {
      id: GROUP_ID,
      organizationId: "org-1",
      nextFlushAt: new Date("2026-08-10T09:00:00Z"),
      directAlertDefinitionId: null,
      receiverId: null,
      repeatIntervalSeconds: null,
      lastNotifiedAt: null,
    };
    mocks.groupRow = group;
    // 5 distinct firing members: with the per-member design this would have
    // been 5 silence scans and 5 inhibition scans.
    mocks.memberRows = Array.from({ length: 5 }, (_, i) => member(i));
    mocks.commitSelectQueue = [
      [group], // re-read under lock
      [{ unflushed: 0 }], // pending count
    ];

    await flushAlertGroup({ groupId: GROUP_ID });

    expect(mocks.loadSilences).toHaveBeenCalledTimes(1);
    expect(mocks.loadInhibition).toHaveBeenCalledTimes(1);
  });

  // A group above the claim cap leaves members unflushed on every pass. The
  // reschedule used to hand back the schedule this flush had just consumed,
  // which is in the past, so the job re-armed itself with no delay and the
  // group flushed in a tight loop for as long as it stayed oversized.
  it("does not re-arm itself in the past when the cap leaves members behind", async () => {
    const consumed = new Date(Date.now() - 60_000);
    const group = {
      id: GROUP_ID,
      organizationId: "org-1",
      nextFlushAt: consumed,
      directAlertDefinitionId: null,
      receiverId: null,
      groupIntervalSeconds: 300,
      repeatIntervalSeconds: null,
      lastNotifiedAt: null,
    };
    mocks.groupRow = group;
    mocks.memberRows = [member(0)];
    mocks.commitSelectQueue = [[group], [{ unflushed: 100 }]];

    await flushAlertGroup({ groupId: GROUP_ID });

    const scheduled = mocks.updates.at(-1)?.nextFlushAt as Date;
    expect(scheduled.getTime()).toBeGreaterThan(Date.now());
    expect(scheduled.getTime()).toBeGreaterThan(consumed.getTime() + 300_000);
  });

  it("does not load either when nothing survives to the suppression check", async () => {
    const group = {
      id: GROUP_ID,
      organizationId: "org-1",
      nextFlushAt: new Date("2026-08-10T09:00:00Z"),
      directAlertDefinitionId: null,
      receiverId: null,
      repeatIntervalSeconds: null,
      lastNotifiedAt: null,
    };
    mocks.groupRow = group;
    // A paused rule: dropped before the suppression check runs.
    mocks.memberRows = [{ ...member(0), ruleActive: false }];
    mocks.commitSelectQueue = [[group], [{ unflushed: 0 }]];

    await flushAlertGroup({ groupId: GROUP_ID });

    expect(mocks.loadSilences).not.toHaveBeenCalled();
    expect(mocks.loadInhibition).not.toHaveBeenCalled();
  });
});

describe("flushAlertGroup flap handling", () => {
  const GROUP_ID = "5cbb1c68-5cc9-4444-8000-000000000003";

  // The row count is the claim. The integration suite drives this same branch
  // and finds the resolve's terminal, but never counts the rows, so only this
  // case says the fire does not get a terminal of its own: a later widening of
  // the dropped-member classification would append a second row unnoticed.
  it("records a terminal for a flap instead of notifying an unannounced resolve", async () => {
    const group = {
      id: GROUP_ID,
      organizationId: "org-1",
      nextFlushAt: new Date("2026-08-10T09:00:00Z"),
      directAlertDefinitionId: null,
      receiverId: null,
      repeatIntervalSeconds: null,
      lastNotifiedAt: null,
    };
    mocks.groupRow = group;
    // Fire at T, resolve at T+15, both still unflushed at the flush: the
    // fire never went out.
    mocks.memberRows = [
      {
        event: {
          id: "fire-event",
          organizationId: "org-1",
          sourceDefinitionId: "def-1",
          instanceFingerprint: "fp-1",
          occurredAt: new Date("2026-08-10T08:59:00Z"),
          eventType: "instance_fired",
          instanceLabels: {},
          silenced: false,
          inhibited: false,
          silenceId: null,
        },
        flushedAt: null,
        ruleActive: true,
      },
      {
        event: {
          id: "resolve-event",
          organizationId: "org-1",
          sourceDefinitionId: "def-1",
          instanceFingerprint: "fp-1",
          occurredAt: new Date("2026-08-10T08:59:15Z"),
          eventType: "instance_resolved",
          instanceLabels: {},
          silenced: false,
          inhibited: false,
          silenceId: null,
        },
        flushedAt: null,
        ruleActive: true,
      },
    ];
    mocks.commitSelectQueue = [
      [group], // re-read under lock
      [{ unflushed: 0 }], // pending count
    ];

    await flushAlertGroup({ groupId: GROUP_ID });

    expect(mocks.recordHistory).toHaveBeenCalledWith(
      null,
      expect.arrayContaining([
        expect.objectContaining({ notificationEventId: "resolve-event" }),
      ]),
    );
    const [, rows] = mocks.recordHistory.mock.calls[0] as unknown as [
      unknown,
      { notificationEventId: string }[],
    ];
    expect(rows).toHaveLength(1);
  });
});

describe("flushAlertGroup stale members", () => {
  const GROUP_ID = "5cbb1c68-5cc9-4444-8000-000000000005";

  function firedMember(fingerprint: string, host: string) {
    return {
      event: {
        id: `event-${fingerprint}`,
        organizationId: "org-1",
        sourceDefinitionId: "def-1",
        instanceFingerprint: fingerprint,
        occurredAt: new Date("2026-08-10T08:59:00Z"),
        eventType: "instance_fired",
        slug: "default/high-5xx",
        instanceLabels: { host },
        notificationTitle: "",
        notificationDescription: "",
        silenced: false,
        inhibited: false,
        silenceId: null,
      },
      flushedAt: null,
      ruleActive: true,
    };
  }

  // A member stays in the group until its resolve arrives, and several
  // ordinary actions destroy that resolve: a label-column change deletes the
  // instances, a silence built from an instance's labels swallows the resolve
  // as well as the fire, and a pause resets an instance whose condition may
  // have cleared by the time the rule resumes. Without this check the member
  // is announced with every later notification of the group, forever.
  it("does not notify a member whose instance has stopped firing", async () => {
    const group = {
      id: GROUP_ID,
      organizationId: "org-1",
      nextFlushAt: new Date("2026-08-10T09:00:00Z"),
      directAlertDefinitionId: null,
      receiverId: "receiver-1",
      repeatIntervalSeconds: null,
      lastNotifiedAt: null,
    };
    mocks.groupRow = group;
    mocks.channelRows = [
      { channel: { id: "chan-1", name: "ops", organizationId: "org-1" } },
    ];
    mocks.memberRows = [
      firedMember("fp-1", "web-1"),
      firedMember("fp-2", "web-2"),
    ];
    // Only fp-1 is still firing.
    mocks.loadFiringKeys.mockReturnValueOnce(
      Promise.resolve(new Set(["def-1:fp-1"])),
    );
    mocks.commitSelectQueue = [[group], [{ unflushed: 0 }]];

    await flushAlertGroup({ groupId: GROUP_ID });

    const delivery = mocks.inserts.find(
      (row): row is { notification: { title: string; body: string } } =>
        typeof row === "object" && row !== null && "notification" in row,
    );
    expect(delivery?.notification.title).toContain("1 firing");
    expect(delivery?.notification.body).toContain("web-1");
    expect(delivery?.notification.body).not.toContain("web-2");
  });

  it("records a terminal for a stale member that never notified", async () => {
    const group = {
      id: GROUP_ID,
      organizationId: "org-1",
      nextFlushAt: new Date("2026-08-10T09:00:00Z"),
      directAlertDefinitionId: null,
      receiverId: null,
      repeatIntervalSeconds: null,
      lastNotifiedAt: null,
    };
    mocks.groupRow = group;
    mocks.memberRows = [firedMember("fp-2", "web-2")];
    mocks.loadFiringKeys.mockReturnValueOnce(Promise.resolve(new Set()));
    mocks.commitSelectQueue = [[group], [{ unflushed: 0 }]];

    await flushAlertGroup({ groupId: GROUP_ID });

    expect(mocks.recordHistory).toHaveBeenCalledWith(
      null,
      expect.arrayContaining([
        expect.objectContaining({
          notificationEventId: "event-fp-2",
          reason: "no_longer_firing",
        }),
      ]),
    );
  });

  it("drops a stale member that already notified without a second terminal", async () => {
    const group = {
      id: GROUP_ID,
      organizationId: "org-1",
      nextFlushAt: new Date("2026-08-10T09:00:00Z"),
      directAlertDefinitionId: null,
      receiverId: null,
      repeatIntervalSeconds: null,
      lastNotifiedAt: null,
    };
    mocks.groupRow = group;
    mocks.memberRows = [
      {
        ...firedMember("fp-2", "web-2"),
        flushedAt: new Date("2026-08-10T08:55:00Z"),
      },
    ];
    mocks.loadFiringKeys.mockReturnValueOnce(Promise.resolve(new Set()));
    mocks.commitSelectQueue = [[group], [{ unflushed: 0 }]];

    await flushAlertGroup({ groupId: GROUP_ID });

    // Its chain already ended in a delivery, so it owes no terminal.
    expect(mocks.recordHistory).not.toHaveBeenCalled();
  });
});

describe("flushAlertGroup zero channels", () => {
  const GROUP_ID = "5cbb1c68-5cc9-4444-8000-000000000004";
  const group = {
    id: GROUP_ID,
    organizationId: "org-1",
    nextFlushAt: new Date("2026-08-10T09:00:00Z"),
    directAlertDefinitionId: null,
    receiverId: "receiver-1",
    repeatIntervalSeconds: null,
    lastNotifiedAt: null,
  };

  it("records a terminal when a notification-worthy set has no channel to send to", async () => {
    mocks.groupRow = group;
    mocks.channelRows = []; // the receiver has no channels attached
    mocks.memberRows = [
      {
        event: {
          id: "fire-event",
          organizationId: "org-1",
          sourceDefinitionId: "def-1",
          instanceFingerprint: "fp-1",
          occurredAt: new Date("2026-08-10T08:59:00Z"),
          eventType: "instance_fired",
          instanceLabels: {},
          silenced: false,
          inhibited: false,
          silenceId: null,
        },
        flushedAt: null,
        ruleActive: true,
      },
    ];
    mocks.commitSelectQueue = [[group], [{ unflushed: 0 }]];

    await flushAlertGroup({ groupId: GROUP_ID });

    expect(mocks.recordHistory).toHaveBeenCalledWith(
      null,
      expect.arrayContaining([
        expect.objectContaining({
          notificationEventId: "fire-event",
          reason: "no_channels",
        }),
      ]),
    );
  });

  it("writes nothing when there is nothing to notify either", async () => {
    mocks.groupRow = group;
    mocks.channelRows = [];
    // A paused rule drops before notificationEvents is computed from any
    // live candidate: nothing to notify, so nothing to blame on missing
    // channels.
    mocks.memberRows = [
      {
        event: {
          id: "fire-event",
          organizationId: "org-1",
          sourceDefinitionId: "def-1",
          instanceFingerprint: "fp-1",
          occurredAt: new Date("2026-08-10T08:59:00Z"),
          eventType: "instance_fired",
          instanceLabels: {},
          silenced: false,
          inhibited: false,
          silenceId: null,
        },
        flushedAt: new Date("2026-08-10T08:00:00Z"),
        ruleActive: false,
      },
    ];
    mocks.commitSelectQueue = [[group], [{ unflushed: 0 }]];

    await flushAlertGroup({ groupId: GROUP_ID });

    expect(mocks.recordHistory).not.toHaveBeenCalled();
  });
});
