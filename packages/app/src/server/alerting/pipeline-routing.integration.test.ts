// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { alertDeliveries, alertNotificationGroups } from "@/db/schema";
import {
  insertChannel,
  insertDefaultChannels,
  insertDirectRule,
  insertRule,
} from "./testing/fixtures";
import { type AlertingHarness, createAlertingHarness } from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/test-clickhouse"));

let harness: AlertingHarness;

// The harness owns the fake clock: it installs a Date-only fake timer on
// create and restores real timers on close. Faking the whole timer set would
// hang PGlite's WebAssembly boot, so no test file installs its own.
beforeAll(async () => {
  harness = await createAlertingHarness();
}, 60_000);

beforeEach(() => {
  harness.setNow(new Date("2026-01-01T00:00:00Z"));
});

afterEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  await harness.close();
});

async function fireDefaultRuleAndFlush(
  overrides: Parameters<typeof insertRule>[1] = {},
) {
  await insertRule(harness.db, { forSecs: 0, ...overrides });
  harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
  await harness.fireAndFlush();
}

describe("the alerting pipeline's default-destination targeting", () => {
  it("never consults the default destination for a rule with direct channels", async () => {
    await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "webhook",
      channelName: "direct-channel",
    });

    // An unsplit default destination: if the direct rule ever fell through to
    // it, this channel would be notified too.
    const defaultChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "default-channel",
    });
    await insertDefaultChannels(harness.db, {
      channelIds: [defaultChannel.id],
    });

    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness.fireAndFlush();

    expect(harness.fetchCalls()).toHaveLength(1);
    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channelName).toBe("direct-channel");

    const [group] = await harness.db.select().from(alertNotificationGroups);
    expect(group.directAlertDefinitionId).not.toBeNull();
    expect(group.defaultTier).toBeNull();
  });

  it("delivers a warning-severity event through the 'all' tier when the destination is unsplit", async () => {
    const channel = await insertChannel(harness.db, {
      type: "webhook",
      name: "unsplit-channel",
    });
    await insertDefaultChannels(harness.db, { channelIds: [channel.id] });

    await fireDefaultRuleAndFlush();

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.channelName).toBe("unsplit-channel");
    const [group] = await harness.db.select().from(alertNotificationGroups);
    expect(group.defaultTier).toBe("all");
    expect(group.directAlertDefinitionId).toBeNull();
  });

  it("delivers to the tier matching the event's severity when the destination is split", async () => {
    const warningChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "warning-channel",
    });
    await insertDefaultChannels(harness.db, {
      tier: "warning",
      channelIds: [warningChannel.id],
    });
    const criticalChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "critical-channel",
    });
    await insertDefaultChannels(harness.db, {
      tier: "critical",
      channelIds: [criticalChannel.id],
    });

    await fireDefaultRuleAndFlush({ severity: "warning" });

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.channelName).toBe("warning-channel");
    const [group] = await harness.db.select().from(alertNotificationGroups);
    expect(group.defaultTier).toBe("warning");
  });

  it("delivers nothing when the split destination has no tier for the event's severity", async () => {
    const criticalChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "critical-channel",
    });
    await insertDefaultChannels(harness.db, {
      tier: "critical",
      channelIds: [criticalChannel.id],
    });

    await fireDefaultRuleAndFlush({ severity: "info" });

    // No matching tier resolves to no dispatch target at all: no group is
    // ever created, so there is nothing to flush and nothing to send.
    expect(harness.fetchCalls()).toHaveLength(0);
    expect(await harness.db.select().from(alertDeliveries)).toHaveLength(0);
    expect(
      await harness.db.select().from(alertNotificationGroups),
    ).toHaveLength(0);
  });

  it("fans one flush out to every channel of the destination, in name order", async () => {
    const first = await insertChannel(harness.db, {
      type: "webhook",
      name: "first-channel",
    });
    const second = await insertChannel(harness.db, {
      type: "webhook",
      name: "second-channel",
    });
    const third = await insertChannel(harness.db, {
      type: "webhook",
      name: "third-channel",
    });
    await insertDefaultChannels(harness.db, {
      channelIds: [first.id, second.id, third.id],
    });

    await fireDefaultRuleAndFlush();

    expect(harness.fetchCalls()).toHaveLength(3);
    // One group, one delivery per channel, resolved in name order.
    expect(
      await harness.db.select().from(alertNotificationGroups),
    ).toHaveLength(1);
    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries.map((d) => d.channelName)).toEqual([
      "first-channel",
      "second-channel",
      "third-channel",
    ]);
  });

  it("does not let a user label named severity steer tier selection away from the rule's severity", async () => {
    const warnChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "warn-channel",
    });
    await insertDefaultChannels(harness.db, {
      tier: "warning",
      channelIds: [warnChannel.id],
    });
    const critChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "crit-channel",
    });
    await insertDefaultChannels(harness.db, {
      tier: "critical",
      channelIds: [critChannel.id],
    });

    // The row's own label column is named "severity" and carries "critical",
    // shadowing the rule's real severity, "warning", if the system value
    // did not win.
    await insertRule(harness.db, {
      sql: "select 'checkout' as service, 'critical' as severity, 42 as value",
      labelColumns: ["service", "severity"],
      severity: "warning",
      forSecs: 0,
    });
    harness.clickhouse.setSignal([
      { service: "checkout", severity: "critical", value: 42 },
    ]);
    await harness.fireAndFlush();

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.channelName).toBe("warn-channel");
  });

  it("splits two rules into two groups under one destination, since grouping is by rule", async () => {
    const channel = await insertChannel(harness.db, {
      type: "webhook",
      name: "shared-channel",
    });
    await insertDefaultChannels(harness.db, { channelIds: [channel.id] });

    await insertRule(harness.db, { slug: "rule-a", forSecs: 0 });
    await insertRule(harness.db, { slug: "rule-b", forSecs: 0 });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness.fireAndFlush();

    // The fixed group_by is [rule, severity]: two rules never share a group,
    // even when they deliver through the same default destination.
    expect(harness.fetchCalls()).toHaveLength(2);
    const groups = await harness.db.select().from(alertNotificationGroups);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.defaultTier === "all")).toBe(true);
  });
});
