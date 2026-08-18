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
import {
  insertDirectRule,
  insertPreview,
  insertRule,
  insertSilence,
  TEST_ORG,
} from "./testing/fixtures";
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

// The window every read below asks for: wide enough that nothing falls out of
// it by accident, so a missing row is a missing row and not a clock question.
const WINDOW = {
  from: new Date("2025-12-01T00:00:00Z"),
  to: new Date("2026-02-01T00:00:00Z"),
};

/**
 * The other half of the pipeline: the queries a reader runs over what it
 * wrote.
 *
 * These are the app's own functions, not SQL this file composes. Until the
 * engine was real they could only ever be checked by reading the string they
 * built, so their cases asserted things like "hits the sort-key prefix" and
 * "ranks keys via arrayJoin(mapKeys(...))" against a mock that returned canned
 * rows. The SQL itself had never run. Here the pipeline writes history and the
 * reader reads it back, so a filter that matches nothing, a join that pairs the
 * wrong rows, or a function name that does not exist is a failure.
 *
 * Tenant isolation is still not in scope: `tenant_id = {organizationId:String}`
 * is a filter these queries write themselves, and it is asserted below, but the
 * row policy that backs it up in production is not applied here.
 */
describe("the alerting pipeline's read path", () => {
  it("returns a fired instance to the reader that asks for the org's history", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    const { queryClickHouseAlertEventLog } = await import(
      "@/data/alerting/history/repository.server"
    );
    const rows = await queryClickHouseAlertEventLog(TEST_ORG, {
      limit: 100,
      ...WINDOW,
      previewIds: null,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("instance_fired");
    expect(rows[0].slug).toBe("default/checkout-latency");
    expect(rows[0].severity).toBe("warning");
    // The labels come back as a Map column, which the reader hands on as an
    // object. A String column holding JSON would type-check the same way and
    // arrive as a string.
    expect(rows[0].labels).toEqual({ service: "checkout" });
    expect(rows[0].evidence).not.toBeNull();
  });

  it("reads only the named rule's history when a repoid and a source id narrow it", async () => {
    await insertRule(harness.db, { slug: "checkout-latency", forSecs: 0 });
    const other = await insertRule(harness.db, {
      slug: "cart-errors",
      forSecs: 0,
    });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    const { queryClickHouseAlertEventLog } = await import(
      "@/data/alerting/history/repository.server"
    );
    const rows = await queryClickHouseAlertEventLog(TEST_ORG, {
      limit: 100,
      ...WINDOW,
      previewIds: null,
      // The sort key is (tenant_id, repoid, slug, ...), so a per-rule read
      // supplies the repoid to land on its prefix instead of scanning past it.
      repoid: "repo_test",
      sourceId: other.id,
    });

    expect(rows.map((row) => row.slug)).toEqual(["default/cart-errors"]);
  });

  it("folds a delivery's targets onto the transition that produced it", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setSignal(BREACHING);
    await harness.fireAndFlush();

    // A delivery is a separate row in a later job, correlated back by
    // notification_event_id. Folding it on is the most involved SQL in the
    // read path (groupArray, then arrayFlatten over mapValues, then
    // arraySort(arrayDistinct(...))) and the least likely to be right by
    // inspection, because every one of those names has to exist and compose.
    const { queryClickHouseAlertEventLog } = await import(
      "@/data/alerting/history/repository.server"
    );
    const [row] = await queryClickHouseAlertEventLog(TEST_ORG, {
      limit: 100,
      ...WINDOW,
      previewIds: null,
    });

    expect(row.eventType).toBe("instance_fired");
    expect(row.deliveryTargets.length).toBeGreaterThan(0);
    expect(row.silenced).toBe(false);
  });

  it("folds a settled silence decision onto the transition it withheld", async () => {
    await insertDirectRule(harness.db, {
      forSecs: 0,
      intervalSecs: 60,
      channelType: "webhook",
    });
    await insertSilence(harness.db);
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    // The fire is only deferred while the instance is still firing, and a
    // deferred decision is not a fact yet: nothing reaches ClickHouse. Letting
    // the breach clear settles the resolve against the same silence, and that
    // decision is terminal, so it is the one that gets journaled.
    harness.clickhouse.setSignal([]);
    harness.advance(60_000);
    await harness.runDueJobs();
    harness.advance(60_000);
    await harness.runDueJobs();

    const { queryClickHouseAlertEventLog } = await import(
      "@/data/alerting/history/repository.server"
    );
    const rows = await queryClickHouseAlertEventLog(TEST_ORG, {
      limit: 100,
      ...WINDOW,
      previewIds: null,
    });

    const resolved = rows.find((row) => row.eventType === "instance_resolved");
    expect(resolved).toBeDefined();
    expect(resolved?.silenced).toBe(true);
    expect(resolved?.deliveryTargets).toEqual([]);
  });

  it("leaves a preview out of live history until its id is asked for", async () => {
    const preview = await insertPreview(harness.db);
    await insertRule(harness.db, { slug: "live-rule", forSecs: 0 });
    await insertRule(harness.db, {
      slug: "preview-rule",
      forSecs: 0,
      previewId: preview.id,
    });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    const { queryClickHouseAlertEventLog } = await import(
      "@/data/alerting/history/repository.server"
    );
    const live = await queryClickHouseAlertEventLog(TEST_ORG, {
      limit: 100,
      ...WINDOW,
      previewIds: null,
    });
    expect(live.map((row) => row.slug)).toEqual(["default/live-rule"]);

    // Not "preview instead of live": a preview is read as an overlay on live,
    // so the reader can see what the change would have added.
    const overlaid = await queryClickHouseAlertEventLog(TEST_ORG, {
      limit: 100,
      ...WINDOW,
      previewIds: [preview.id],
    });
    expect(overlaid.map((row) => row.slug).sort()).toEqual([
      "default/live-rule",
      "default/preview-rule",
    ]);
  });

  it("ranks the label keys and values the org has actually observed", async () => {
    await insertRule(harness.db, {
      forSecs: 0,
      labelColumns: ["service", "region"],
    });
    harness.clickhouse.setSignal([
      { service: "checkout", region: "eu", value: 42 },
      { service: "cart", region: "eu", value: 42 },
    ]);
    await harness.runDueJobs();

    const {
      queryClickHouseObservedLabelKeys,
      queryClickHouseObservedLabelValues,
    } = await import("@/data/alerting/history/repository.server");

    // Ranked in the engine with arrayJoin(mapKeys(...)) rather than by pulling
    // every label blob into Node to count there. Both keys appear on both
    // rows, so the tie breaks on the key name.
    expect(
      await queryClickHouseObservedLabelKeys(TEST_ORG, {
        limit: 10,
        ...WINDOW,
      }),
    ).toEqual(["region", "service"]);

    // Values for one key, ordered by how often each was seen. "eu" is on both
    // instances; each service is on one.
    expect(
      await queryClickHouseObservedLabelValues(TEST_ORG, "region", {
        limit: 10,
        ...WINDOW,
      }),
    ).toEqual(["eu"]);
    expect(
      (
        await queryClickHouseObservedLabelValues(TEST_ORG, "service", {
          limit: 10,
          ...WINDOW,
        })
      ).sort(),
    ).toEqual(["cart", "checkout"]);
  });

  it("keeps a key nothing carries out of the value suggestions", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    // `has(instance_labels, {key:String})` is what stops a missing key from
    // ranking the empty string as its most common value: Map access on an
    // absent key returns the type's default, not nothing.
    const { queryClickHouseObservedLabelValues } = await import(
      "@/data/alerting/history/repository.server"
    );
    expect(
      await queryClickHouseObservedLabelValues(TEST_ORG, "region", {
        limit: 10,
        ...WINDOW,
      }),
    ).toEqual([]);
  });

  it("reads a rule's evaluation series across both engines at once", async () => {
    const rule = await insertRule(harness.db, { forSecs: 0, intervalSecs: 60 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();
    harness.advance(60_000);
    await harness.runDueJobs();

    // The rule row comes from PostgreSQL and its evaluations from ClickHouse,
    // in one call: the series is shaped against the rule's own condition, so
    // a read that found the rule but not its history would still return a
    // series, just an empty one.
    const { getRuleEvaluationSeries } = await import(
      "@/data/alerting/rules/repository"
    );
    const series = await getRuleEvaluationSeries(TEST_ORG, rule.id, {
      ...WINDOW,
      points: 100,
    });

    expect(series.points.length).toBeGreaterThan(0);
    expect(series.points.every((point) => point.error === null)).toBe(true);
  });

  it("returns nothing for an org that wrote nothing, without reading another's rows", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    // `tenant_id = {organizationId:String}` is the reader's own filter, and it
    // is the only thing separating these orgs here: the row policy that backs
    // it in production is not applied to this engine. What this case proves is
    // that the query writes the filter and binds it, not that the engine would
    // enforce it if the query forgot.
    const { queryClickHouseAlertEventLog } = await import(
      "@/data/alerting/history/repository.server"
    );
    expect(
      await queryClickHouseAlertEventLog("org_other", {
        limit: 100,
        ...WINDOW,
        previewIds: null,
      }),
    ).toEqual([]);
  });
});
