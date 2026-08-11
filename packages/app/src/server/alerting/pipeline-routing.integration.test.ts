// @vitest-environment node
import { eq, sql } from "drizzle-orm";
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
import { ALERTING_DEFAULT_GROUP_WAIT_SECS } from "@/data/alerting/routing/defaults";
import {
  alertDeliveries,
  alertNotificationGroups,
  alertReceivers,
  alertRoutes,
} from "@/db/schema";
import {
  insertChannel,
  insertDirectRule,
  insertReceiver,
  insertRoute,
  insertRule,
} from "./testing/fixtures";
import { type AlertingHarness, createAlertingHarness } from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/clickhouse-double"));

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
  harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
  await harness.runDueJobs();
  harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
  await harness.runDueJobs();
}

describe("the alerting pipeline's routing", () => {
  it("never consults routes for a rule with direct channels, even when a route would match", async () => {
    await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "webhook",
      channelName: "direct-channel",
    });

    const routedChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "routed-channel",
    });
    const receiver = await insertReceiver(harness.db, {
      name: "routed-receiver",
      channelIds: [routedChannel.id],
    });
    // A catch-all route (no matchers): if the direct rule ever consulted
    // routes, this one would fire too.
    await insertRoute(harness.db, { receiver: receiver.name });

    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(1);
    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channelName).toBe("direct-channel");

    const [group] = await harness.db.select().from(alertNotificationGroups);
    expect(group.directAlertDefinitionId).not.toBeNull();
    expect(group.receiverId).toBeNull();
  });

  it("delivers through only the lower-priority route when both match and continue is false", async () => {
    const channelA = await insertChannel(harness.db, {
      type: "webhook",
      name: "receiver-a-channel",
    });
    const receiverA = await insertReceiver(harness.db, {
      name: "receiver-a",
      channelIds: [channelA.id],
    });
    const channelB = await insertChannel(harness.db, {
      type: "webhook",
      name: "receiver-b-channel",
    });
    const receiverB = await insertReceiver(harness.db, {
      name: "receiver-b",
      channelIds: [channelB.id],
    });
    await insertRoute(harness.db, { receiver: receiverA.name, priority: 0 });
    await insertRoute(harness.db, { receiver: receiverB.name, priority: 1 });

    await fireDefaultRuleAndFlush();

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.channelName).toBe("receiver-a-channel");
  });

  it("delivers through both receivers, into two groups, when the first matching route continues", async () => {
    const channelA = await insertChannel(harness.db, {
      type: "webhook",
      name: "receiver-a-channel",
    });
    const receiverA = await insertReceiver(harness.db, {
      name: "receiver-a",
      channelIds: [channelA.id],
    });
    const channelB = await insertChannel(harness.db, {
      type: "webhook",
      name: "receiver-b-channel",
    });
    const receiverB = await insertReceiver(harness.db, {
      name: "receiver-b",
      channelIds: [channelB.id],
    });
    await insertRoute(harness.db, {
      receiver: receiverA.name,
      priority: 0,
      continue: true,
    });
    await insertRoute(harness.db, { receiver: receiverB.name, priority: 1 });

    await fireDefaultRuleAndFlush();

    expect(harness.fetchCalls()).toHaveLength(2);
    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries.map((d) => d.channelName).sort()).toEqual([
      "receiver-a-channel",
      "receiver-b-channel",
    ]);
    const groups = await harness.db.select().from(alertNotificationGroups);
    expect(groups).toHaveLength(2);
  });

  it("skips a route naming a receiver that does not exist, and still delivers through a later matching route", async () => {
    const ghostReceiver = await insertReceiver(harness.db, {
      name: "ghost-receiver",
    });
    await insertRoute(harness.db, {
      receiver: ghostReceiver.name,
      priority: 0,
      continue: true,
    });

    const liveChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "live-channel",
    });
    const liveReceiver = await insertReceiver(harness.db, {
      name: "live-receiver",
      channelIds: [liveChannel.id],
    });
    await insertRoute(harness.db, { receiver: liveReceiver.name, priority: 1 });

    // The ghost receiver is removed the only way production data could end
    // up in this state: `deleteReceiver` (repository.ts) refuses while a
    // route still references it, and the foreign key enforces the same rule
    // at the database level. Disabling the constraint's own trigger for one
    // delete reproduces a row an out-of-band operation left behind, without
    // leaving the constraint off for the rest of the suite.
    await harness.db.execute(
      sql.raw("ALTER TABLE alert_receivers DISABLE TRIGGER ALL"),
    );
    await harness.db
      .delete(alertReceivers)
      .where(eq(alertReceivers.id, ghostReceiver.id));
    await harness.db.execute(
      sql.raw("ALTER TABLE alert_receivers ENABLE TRIGGER ALL"),
    );

    await fireDefaultRuleAndFlush();

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.channelName).toBe("live-channel");
  });

  it("matches eq and ne, matches a missing label only against the empty string, and a bare route catches everything", async () => {
    const eqChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "eq-channel",
    });
    const eqReceiver = await insertReceiver(harness.db, {
      name: "eq-receiver",
      channelIds: [eqChannel.id],
    });
    await insertRoute(harness.db, {
      receiver: eqReceiver.name,
      priority: 0,
      continue: true,
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
    });

    const neChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "ne-channel",
    });
    const neReceiver = await insertReceiver(harness.db, {
      name: "ne-receiver",
      channelIds: [neChannel.id],
    });
    await insertRoute(harness.db, {
      receiver: neReceiver.name,
      priority: 1,
      continue: true,
      matchers: [{ label: "service", op: "ne", value: "billing" }],
    });

    const emptyMatchChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "empty-match-channel",
    });
    const emptyMatchReceiver = await insertReceiver(harness.db, {
      name: "empty-match-receiver",
      channelIds: [emptyMatchChannel.id],
    });
    // "region" is not one of the rule's label columns, so the instance never
    // carries it: a missing label reads as the empty string.
    await insertRoute(harness.db, {
      receiver: emptyMatchReceiver.name,
      priority: 2,
      continue: true,
      matchers: [{ label: "region", op: "eq", value: "" }],
    });

    const emptyMismatchChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "empty-mismatch-channel",
    });
    const emptyMismatchReceiver = await insertReceiver(harness.db, {
      name: "empty-mismatch-receiver",
      channelIds: [emptyMismatchChannel.id],
    });
    // Same missing label, a non-empty value: proves the match above is
    // against the empty string specifically, not "any missing label".
    await insertRoute(harness.db, {
      receiver: emptyMismatchReceiver.name,
      priority: 3,
      continue: true,
      matchers: [{ label: "region", op: "eq", value: "us-east" }],
    });

    const catchAllChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "catch-all-channel",
    });
    const catchAllReceiver = await insertReceiver(harness.db, {
      name: "catch-all-receiver",
      channelIds: [catchAllChannel.id],
    });
    await insertRoute(harness.db, {
      receiver: catchAllReceiver.name,
      priority: 4,
    });

    await fireDefaultRuleAndFlush();

    expect(harness.fetchCalls()).toHaveLength(4);
    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries.map((d) => d.channelName).sort()).toEqual([
      "catch-all-channel",
      "empty-match-channel",
      "eq-channel",
      "ne-channel",
    ]);
  });

  it("never matches a route row persisted with a retired regex op", async () => {
    const staleChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "stale-op-channel",
    });
    const staleReceiver = await insertReceiver(harness.db, {
      name: "stale-op-receiver",
      channelIds: [staleChannel.id],
    });
    const staleRoute = await insertRoute(harness.db, {
      receiver: staleReceiver.name,
      priority: 0,
      continue: true,
    });
    // "regex" was removed from AlertingMatchOpSchema: no validating path
    // (createRoute, updateRoute) can produce this row today. Writing the
    // jsonb column directly is what a row persisted before the removal
    // looks like.
    await harness.db
      .update(alertRoutes)
      .set({
        config: {
          matchers: [{ label: "service", op: "regex", value: "check.*" }],
          continue: true,
          group_by: null,
          group_wait_secs: null,
          group_interval_secs: null,
          repeat_interval_secs: null,
        } as never,
      })
      .where(eq(alertRoutes.id, staleRoute.id));

    const catchAllChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "catch-all-channel",
    });
    const catchAllReceiver = await insertReceiver(harness.db, {
      name: "catch-all-receiver",
      channelIds: [catchAllChannel.id],
    });
    await insertRoute(harness.db, {
      receiver: catchAllReceiver.name,
      priority: 1,
    });

    await fireDefaultRuleAndFlush();

    // A live regex engine would have matched "checkout" against "check.*".
    // The retired op never matches, so only the catch-all route delivers.
    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.channelName).toBe("catch-all-channel");
  });

  it("splits two instances into two groups by group_by, where the default grouping would have joined them", async () => {
    const channel = await insertChannel(harness.db, {
      type: "webhook",
      name: "grouped-channel",
    });
    const receiver = await insertReceiver(harness.db, {
      name: "grouped-receiver",
      channelIds: [channel.id],
    });
    // Both instances below share the same rule and severity, so the default
    // group_by (["rule", "severity"]) would fold them into one group.
    await insertRoute(harness.db, {
      receiver: receiver.name,
      groupBy: ["service"],
    });

    await insertRule(harness.db, {
      sql: "select 'svc-a' as service, 42 as value union all select 'svc-b' as service, 42 as value",
      forSecs: 0,
    });
    harness.clickhouse.setRows([
      { service: "svc-a", value: 42 },
      { service: "svc-b", value: 42 },
    ]);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(2);
    const groups = await harness.db.select().from(alertNotificationGroups);
    expect(groups).toHaveLength(2);
  });

  it("does not let a user label named severity override the system severity in the dispatch labels", async () => {
    const warnChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "warn-channel",
    });
    const warnReceiver = await insertReceiver(harness.db, {
      name: "warn-receiver",
      channelIds: [warnChannel.id],
    });
    await insertRoute(harness.db, {
      receiver: warnReceiver.name,
      priority: 0,
      matchers: [{ label: "severity", op: "eq", value: "warning" }],
    });

    const critChannel = await insertChannel(harness.db, {
      type: "webhook",
      name: "crit-channel",
    });
    const critReceiver = await insertReceiver(harness.db, {
      name: "crit-receiver",
      channelIds: [critChannel.id],
    });
    await insertRoute(harness.db, {
      receiver: critReceiver.name,
      priority: 1,
      matchers: [{ label: "severity", op: "eq", value: "critical" }],
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
    harness.clickhouse.setRows([
      { service: "checkout", severity: "critical", value: 42 },
    ]);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.channelName).toBe("warn-channel");
  });

  it("reaches all 12 receivers when 12 routes match and every one continues, dropping none", async () => {
    const ROUTE_COUNT = 12;
    for (let index = 0; index < ROUTE_COUNT; index += 1) {
      const channel = await insertChannel(harness.db, {
        type: "webhook",
        name: `fanout-channel-${index}`,
      });
      const receiver = await insertReceiver(harness.db, {
        name: `fanout-receiver-${index}`,
        channelIds: [channel.id],
      });
      await insertRoute(harness.db, {
        receiver: receiver.name,
        priority: index,
        continue: true,
      });
    }

    await fireDefaultRuleAndFlush();

    // Route fan-out has no cap in the runtime: ticket 29's bound is on the
    // recipients inside one channel (email, Telegram), not on how many
    // routes one event fans into.
    expect(harness.fetchCalls()).toHaveLength(ROUTE_COUNT);
    const groups = await harness.db.select().from(alertNotificationGroups);
    expect(groups).toHaveLength(ROUTE_COUNT);
    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(ROUTE_COUNT);
  });
});
