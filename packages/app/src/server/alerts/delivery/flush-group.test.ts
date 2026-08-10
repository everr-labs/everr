import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupRow: null as Record<string, unknown> | null,
  memberRows: [] as unknown[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/db/client", () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
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
    },
  },
  pool: {},
}));

vi.mock("./journal-reader", () => ({
  deliverableGroupMemberQuery: () => Promise.resolve(mocks.memberRows),
}));

import { CHANNEL_TEXT_MAX } from "@/lib/channel-text-limits";
import {
  flushAlertGroup,
  formatNotification,
  type NotificationEvent,
} from "./flush-group";
import { IDLE_GROUP_FLUSH_AT } from "./tasks";

beforeEach(() => {
  mocks.groupRow = null;
  mocks.memberRows = [];
  mocks.updates = [];
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
