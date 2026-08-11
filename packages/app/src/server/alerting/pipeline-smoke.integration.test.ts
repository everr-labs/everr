// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { alertDeliveries, alertInstances } from "@/db/schema";
// Task 5 creates ./testing/fixtures; until then this import, and the test
// below, fail on purpose.
// fallow-ignore-next-line unresolved-import
import { insertDirectRule } from "./testing/fixtures";
import { type AlertingHarness, createAlertingHarness } from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/clickhouse-double"));

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
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();

    const instances = await harness.db.select().from(alertInstances);
    expect(instances).toHaveLength(1);
    expect(instances[0].status).toBe("firing");

    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("sent");

    expect(harness.fetchCalls()).toHaveLength(1);
    expect(harness.clickhouse.historyRows().map((r) => r.event_type)).toContain(
      "instance_fired",
    );
    expect(rule.id).toBeTruthy();
  });
});
