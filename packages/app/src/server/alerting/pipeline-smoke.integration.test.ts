// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { ALERTING_DEFAULT_GROUP_WAIT_SECS } from "#app/data/alerting/delivery/defaults.ts";
import { alertDeliveries, alertInstances } from "#app/db/schema/index.ts";
import { insertDirectRule } from "#app/server/alerting/testing/fixtures.ts";
import { type AlertingHarness, createAlertingHarness } from "#app/testing/alerting-harness.ts";

vi.mock("#app/db/client.ts", async () => {
  const { testDb, runInTransaction } = await import("#app/server/alerting/testing/db-proxy.ts");
  return { db: testDb, runInTransaction };
});

vi.mock("#app/lib/clickhouse.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});
vi.mock("#app/lib/clickhouse-writer.ts", async () => {
  const { clickhouseMock } = await import("#app/testing/test-clickhouse.ts");
  return clickhouseMock;
});

let harness: AlertingHarness;

beforeAll(async () => {
  harness = await createAlertingHarness();
}, 60_000);

afterEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  await harness.close();
});

describe("the alerting pipeline", () => {
  it("takes a breaching rule from evaluation to a delivered notification", async () => {
    harness.setNow(new Date("2026-01-01T00:00:00Z"));
    const rule = await insertDirectRule(harness.db, {
      sql: "select 'checkout' as service, 42 as value",
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();

    const instances = await harness.db.select().from(alertInstances);
    expect(instances).toHaveLength(1);
    expect(instances[0].status).toBe("firing");

    // A direct-channel rule groups like any other, so its notification waits
    // the default group wait before the flush claims it.
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();

    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("sent");

    expect(harness.fetchCalls()).toHaveLength(1);
    expect(harness.clickhouse.historyRows().map((r) => r.event_type)).toContain("instance_fired");
    expect(rule.id).toBeTruthy();
  });
});
