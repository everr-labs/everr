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
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "@/data/alerting/delivery/config";
import {
  alertDeliveries,
  alertDeliveryEvents,
  alertEvaluations,
  alertEvents,
  alertInstances,
  alertNotificationGroups,
  alertSilences,
} from "@/db/schema";
import { cleanupAlertingHistory } from "./maintenance/cleanup";
import { insertDirectRule, insertSilence } from "./testing/fixtures";
import { type AlertingHarness, createAlertingHarness } from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/test-clickhouse"));

let harness: AlertingHarness;

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

const BREACHING = [{ service: "checkout", value: 42 }];
const DAY_MS = 24 * 60 * 60 * 1_000;

/** One incident, run to a standstill: fired, delivered, resolved, settled. */
async function runOneSettledIncident(): Promise<void> {
  harness.clickhouse.setSignal(BREACHING);
  await harness.fireAndFlush();
  harness.clickhouse.setSignal([]);
  for (let tick = 0; tick < 6; tick += 1) {
    harness.advance(60_000);
    await harness.runDueJobs();
  }
}

async function rowCounts() {
  const [
    evaluations,
    events,
    deliveries,
    deliveryLinks,
    groups,
    instances,
    silences,
  ] = await Promise.all([
    harness.db.select().from(alertEvaluations),
    harness.db.select().from(alertEvents),
    harness.db.select().from(alertDeliveries),
    harness.db.select().from(alertDeliveryEvents),
    harness.db.select().from(alertNotificationGroups),
    harness.db.select().from(alertInstances),
    harness.db.select().from(alertSilences),
  ]);
  return {
    evaluations: evaluations.length,
    events: events.length,
    deliveries: deliveries.length,
    deliveryLinks: deliveryLinks.length,
    groups: groups.length,
    instances: instances.length,
    silences: silences.length,
  };
}

/**
 * Retention, against a real PostgreSQL.
 *
 * `cleanupAlertingHistory` is six batched deletes in one transaction, and
 * every one of them is a `ctid` batch under `FOR UPDATE ... SKIP LOCKED`
 * guarded by correlated `NOT EXISTS` clauses. None of that had ever run: the
 * cases for it drove a `db.transaction` double, which cannot enforce a
 * foreign key, cannot evaluate a guard, and returns whatever row count it was
 * told to. Here the rows come from the pipeline itself, so a guard that
 * matches nothing deletes a live notification and a delete in the wrong order
 * raises.
 *
 * The ClickHouse side of retention is not in scope: that is a TTL on
 * `app.alert_events`, and the embedded engine evaluates TTL against the
 * machine clock rather than this suite's (testing/chdb-database.ts), so the
 * clause is stripped and nothing here may claim anything about it.
 */
describe("the alerting pipeline's retention", () => {
  it("collects a settled incident whole, once every window has passed", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    await runOneSettledIncident();

    const before = await rowCounts();
    expect(before.evaluations).toBeGreaterThan(0);
    expect(before.events).toBeGreaterThan(0);
    expect(before.deliveries).toBeGreaterThan(0);

    harness.advance(100 * DAY_MS);
    const counts = await cleanupAlertingHistory({ now: new Date() });

    expect(counts.alertEvaluations).toBe(before.evaluations);
    expect(counts.events).toBe(before.events);
    expect(counts.deliveries).toBe(before.deliveries);
    expect(await rowCounts()).toMatchObject({
      evaluations: 0,
      events: 0,
      deliveries: 0,
      deliveryLinks: 0,
      groups: 0,
      instances: 0,
    });
  });

  it("takes a delivery in the same pass that removes the link which was holding it", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    await runOneSettledIncident();

    // A delivery is only collectable once nothing links it to an event, and
    // the link is a child of the event. So on its own the delivery statement
    // would find nothing: it is the event delete, earlier in the same
    // transaction, that cascades the link away and releases it. Ordering is
    // the whole claim, and only a database with the foreign key can make it.
    expect((await rowCounts()).deliveryLinks).toBeGreaterThan(0);

    harness.advance(100 * DAY_MS);
    await cleanupAlertingHistory({ now: new Date() });

    expect(await rowCounts()).toMatchObject({
      deliveries: 0,
      deliveryLinks: 0,
    });
  });

  it("keeps an ancient event while its delivery still has attempts left", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    await runOneSettledIncident();
    harness.advance(100 * DAY_MS);

    // A settled incident is collectable on every other count: nothing groups
    // its events any more, and every window has passed. Putting its delivery
    // back into a retriable state is therefore the only thing under test, and
    // the events have to survive on that alone. This is what a delivery whose
    // next attempt is still queued looks like to the cleanup.
    await harness.db.update(alertDeliveries).set({
      status: "failed",
      attempts: ALERT_DELIVERY_MAX_ATTEMPTS - 1,
    });
    await cleanupAlertingHistory({ now: new Date() });
    expect((await rowCounts()).events).toBeGreaterThan(0);

    // One more attempt is the difference between a notification still owed
    // and one that will never be sent. Only then is the event's job done.
    await harness.db
      .update(alertDeliveries)
      .set({ attempts: ALERT_DELIVERY_MAX_ATTEMPTS });
    await cleanupAlertingHistory({ now: new Date() });
    expect((await rowCounts()).events).toBe(0);
  });

  it("keeps a firing instance however old it is, and takes the inactive one", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setSignal(BREACHING);
    await harness.fireAndFlush();
    const [instance] = await harness.db.select().from(alertInstances);
    expect(instance.status).toBe("firing");

    // Age is not what separates the two runs below: the row is equally old in
    // both. A firing instance holds the live state the evaluator compares
    // against on every tick, so a pass that took it by age would lose the
    // pending clock and the episode, and the next tick would open the
    // incident again as a new one.
    harness.advance(100 * DAY_MS);
    await cleanupAlertingHistory({ now: new Date() });
    expect((await rowCounts()).instances).toBe(1);

    // Only the status changes. `updated_at` keeps its original stamp, so the
    // same cutoff that spared the row a moment ago now takes it.
    await harness.db.update(alertInstances).set({ status: "inactive" });
    await cleanupAlertingHistory({ now: new Date() });
    expect((await rowCounts()).instances).toBe(0);
  });

  it("keeps a group that still holds a member, and the member's event with it", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setSignal(BREACHING);
    // The fire only, without the flush that follows it: the event joins the
    // group and waits there. A group is idle when nothing is left in it, and
    // this one is holding a notification that has not gone out.
    await harness.runDueJobs();
    expect(await rowCounts()).toMatchObject({ groups: 1, events: 1 });

    harness.advance(100 * DAY_MS);
    await cleanupAlertingHistory({ now: new Date() });

    expect(await rowCounts()).toMatchObject({ groups: 1, events: 1 });
  });

  it("leaves everything inside its own window alone", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    await insertSilence(harness.db);
    await runOneSettledIncident();

    const before = await rowCounts();
    // A day past the incident: the shortest window is seven days, so nothing
    // is collectable yet. Each table has its own cutoff, and a cleanup that
    // used one cutoff for all of them would fail here rather than in
    // production, three months later.
    harness.advance(DAY_MS);
    const counts = await cleanupAlertingHistory({ now: new Date() });

    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    expect(await rowCounts()).toEqual(before);
  });

  it("drains a backlog wider than one batch, and reports every row it took", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    await runOneSettledIncident();
    const before = await rowCounts();
    expect(before.evaluations).toBeGreaterThan(3);

    harness.advance(100 * DAY_MS);
    // The loop repeats while any statement filled its batch, which is what
    // lets an hourly run drain a backlog no fixed number of batches could.
    const counts = await cleanupAlertingHistory({
      now: new Date(),
      batchSize: 2,
    });

    expect(counts.alertEvaluations).toBe(before.evaluations);
    expect((await rowCounts()).evaluations).toBe(0);
  });

  it("stops on its time budget and leaves the rest for the next run", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    await runOneSettledIncident();
    const before = await rowCounts();

    harness.advance(100 * DAY_MS);
    // The budget is wall clock, deliberately separate from the cutoff clock:
    // a run that overshot it would still be deleting when the next hour's run
    // starts. Spent on arrival, so it stops after one batch with a backlog
    // still there.
    const counts = await cleanupAlertingHistory({
      now: new Date(),
      batchSize: 1,
      budgetMs: 0,
      clock: () => 0,
    });

    expect(counts.alertEvaluations).toBe(1);
    expect((await rowCounts()).evaluations).toBe(before.evaluations - 1);
  });

  it("collects a silence long after its window closed", async () => {
    await insertSilence(harness.db, {
      endsAt: new Date(Date.now() + 60_000),
    });

    harness.advance(30 * DAY_MS);
    await cleanupAlertingHistory({ now: new Date() });
    // A silence outlives its own end by the history window, not by the seven
    // days that govern the evaluation tables: it is part of the record of why
    // a notification did not go out.
    expect((await rowCounts()).silences).toBe(1);

    harness.advance(100 * DAY_MS);
    const counts = await cleanupAlertingHistory({ now: new Date() });
    expect(counts.silences).toBe(1);
    expect((await rowCounts()).silences).toBe(0);
  });
});
