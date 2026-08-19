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
  TEST_ORG,
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

const BREACHING = [{ service: "checkout", value: 42 }];

/**
 * This file is about what ClickHouse really does for alerting, on both sides:
 * the metadata a rule's query hands back, and what `app.alert_events` holds
 * after the pipeline has written to it.
 *
 * Both halves used to be a double that answered whatever it was handed: it
 * reported every column as a String, and it kept rows without caring what the
 * shipped DDL said they were. Every case below would pass against such an
 * object. What makes them worth writing is that they now run against the real
 * engine, so a column that changes type, loses a default, or stops being
 * written fails here.
 *
 * Not in scope, and not claimable from this file: tenant isolation. Embedded
 * chdb has no access control, so the row policy the shipped file ends with is
 * the one part of it the loader skips (testing/chdb-database.ts). Reads below
 * run unrestricted.
 */
describe("the alerting pipeline's ClickHouse projection", () => {
  it("reports the engine's own column types back from a rule's query", async () => {
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    // The seam production reads for its own checks. `apply.server.ts` uses
    // `columnTypes` to decide whether a label column is string-typed and the
    // value column numeric. A stub that answered "String" for every column
    // would let a rule that labels on a number look valid. These are the
    // engine's own answers.
    const { querySqlApiWithMeta } = await import("./testing/test-clickhouse");
    const result = await querySqlApiWithMeta<Record<string, unknown>>(
      "SELECT * FROM app.test_signal",
      TEST_ORG,
    );

    expect(result.columns).toEqual(["service", "value"]);
    expect(result.columnTypes).toEqual(["String", "Float64"]);
    expect(result.rows).toEqual([{ service: "checkout", value: 42 }]);
  });

  it("hands a rule's query an empty result with its columns intact", async () => {
    harness.clickhouse.setSignal([]);

    // Production asks for FORMAT JSON precisely so metadata survives an empty
    // result (lib/clickhouse.ts). A rule that currently matches nothing still
    // has to describe its own shape, or every read of a quiet rule loses it.
    const { querySqlApiWithMeta } = await import("./testing/test-clickhouse");
    const result = await querySqlApiWithMeta<Record<string, unknown>>(
      "SELECT * FROM app.test_signal",
      TEST_ORG,
    );

    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual(["service", "value"]);
  });

  it("lands every written column in the type the shipped DDL declares", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    const written = harness.clickhouse.historyRows();
    expect(written.length).toBeGreaterThan(0);

    // The writer sends a plain object; the engine decides what each key
    // becomes. Asking `system.columns` is what turns "the double kept my
    // string" into "the column is a LowCardinality(String)".
    const declared = new Map(
      harness.clickhouse
        .queryRows(
          "SELECT name, type FROM system.columns WHERE database = 'app' AND table = 'alert_events'",
        )
        .map((row) => [row.name as string, row.type as string]),
    );
    expect(declared.get("tenant_id")).toBe("LowCardinality(String)");
    expect(declared.get("event_id")).toBe("UUID");
    expect(declared.get("episode_id")).toBe("UUID");
    expect(declared.get("event_time")).toBe("DateTime64(3)");
    expect(declared.get("is_live")).toBe("Bool");

    // Every key the writer sent is a column that exists. A renamed or dropped
    // column would otherwise surface only as a silently missing value.
    for (const key of Object.keys(written[0])) {
      expect(declared.has(key)).toBe(true);
    }
  });

  it("derives is_live in the engine, from preview_id, for a rule the writer never marks", async () => {
    await insertRule(harness.db, { slug: "live-rule", forSecs: 0 });
    const preview = await insertPreview(harness.db);
    await insertRule(harness.db, {
      slug: "preview-rule",
      forSecs: 0,
      previewId: preview.id,
    });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    // `is_live` is a DEFAULT expression on the column (preview_id equals the
    // zero sentinel), and the writer never sends it: history/clickhouse.ts
    // has no such field. So this asserts the DDL's own computation, which is
    // the kind of claim only a real engine can settle.
    const bySlug = new Map(
      harness.clickhouse
        .queryRows(
          "SELECT slug, is_live FROM app.alert_events WHERE event_type = 'instance_fired'",
        )
        .map((row) => [row.slug as string, row.is_live]),
    );
    expect(bySlug.get("default/live-rule")).toBe(true);
    expect(bySlug.get("default/preview-rule")).toBe(false);
  });

  it("writes an event_id whose embedded UUIDv7 time is the row's own event time", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    // The id is not opaque: `uuidv7(occurredAt)` (history/clickhouse.ts) puts
    // the write time inside it, which is what lets a reader recover when a row
    // happened without trusting a separate column, and what makes a repaired
    // row derivable. UUIDv7ToDateTime is the engine reading its own id back.
    const [row] = harness.clickhouse.queryRows(`
      SELECT toUnixTimestamp64Milli(UUIDv7ToDateTime(event_id)) AS from_id,
             toUnixTimestamp64Milli(event_time) AS from_column
      FROM app.alert_events
      WHERE event_type = 'instance_fired'
    `);
    expect(Number(row.from_id)).toBe(Number(row.from_column));
  });

  it("recovers the exact instant a row happened, to the millisecond", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(BREACHING);
    const firedAt = Date.now();
    await harness.runDueJobs();

    // The writer hands the engine an ISO string and the column is a naive
    // DateTime64(3), so the instant only survives if the engine parses that
    // text the way the writer meant it and keeps all three decimal places.
    // A second-precision column, or a writer that sent a local reading,
    // would still produce a plausible row and be wrong by a whole offset.
    const [row] = harness.clickhouse.queryRows(`
      SELECT toUnixTimestamp64Milli(event_time) AS millis
      FROM app.alert_events
      WHERE event_type = 'instance_fired'
    `);
    expect(Number(row.millis)).toBe(firedAt);
  });

  it("carries one episode_id across the fired and resolved rows of a single breach", async () => {
    await insertRule(harness.db, { forSecs: 0, intervalSecs: 60 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    harness.clickhouse.setSignal([]);
    harness.advance(60_000);
    await harness.runDueJobs();
    harness.advance(60_000);
    await harness.runDueJobs();

    const rows = harness.clickhouse.queryRows(`
      SELECT event_type, episode_id
      FROM app.alert_events
      WHERE event_type IN ('instance_fired', 'instance_resolved')
      ORDER BY event_time, event_id
    `);
    expect(rows.map((row) => row.event_type)).toEqual([
      "instance_fired",
      "instance_resolved",
    ]);
    // One continuous breach is one episode: the resolve has to name the fire
    // it ends, or a reader cannot pair them without guessing from timestamps.
    expect(rows[0].episode_id).toBe(rows[1].episode_id);
    expect(rows[0].episode_id).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  it("leaves the correlation ids on the zero sentinel for a row that correlates nothing", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal([{ service: "checkout", value: 0 }]);
    await harness.runDueJobs();

    // An evaluation that breached nothing has no notification and no episode.
    // The sentinel is a zero UUID rather than a null, so the columns stay
    // non-nullable and a reader filters on equality instead of IS NULL.
    const [row] = harness.clickhouse.queryRows(`
      SELECT notification_event_id, episode_id
      FROM app.alert_events
      WHERE event_type = 'evaluation_succeeded'
    `);
    expect(row.notification_event_id).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(row.episode_id).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("drops a repeated write in the engine's own deduplication window", async () => {
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(BREACHING);
    await harness.runDueJobs();

    const written = harness.clickhouse.historyRows();
    expect(written.length).toBeGreaterThan(0);

    // The writers set insert_deduplication_token from the sorted event ids
    // (history/clickhouse.ts), so replaying a batch is a no-op. This is the
    // table's own non_replicated_deduplication_window deciding that, not the
    // harness: the double used to keep a Set of tokens to imitate it, which
    // meant the imitation was what the case really tested.
    harness.clickhouse.write(written, {
      insert_deduplication_token: "replay",
    });
    const afterFirstReplay = harness.clickhouse.historyRows().length;
    expect(afterFirstReplay).toBe(written.length * 2);

    harness.clickhouse.write(written, {
      insert_deduplication_token: "replay",
    });
    expect(harness.clickhouse.historyRows()).toHaveLength(afterFirstReplay);
  });

  it("keeps a delivery's row alongside the notification it came from", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setSignal(BREACHING);
    await harness.fireAndFlush();

    const rows = harness.clickhouse.queryRows(`
      SELECT event_type, notification_event_id
      FROM app.alert_events
      WHERE event_type IN ('instance_fired', 'delivery_succeeded')
      ORDER BY event_time, event_id
    `);
    expect(rows.map((row) => row.event_type)).toEqual([
      "instance_fired",
      "delivery_succeeded",
    ]);
    // The delivery names the transition that caused it, so a per-instance
    // history can show what was sent about which fire.
    expect(rows[1].notification_event_id).not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("writes one delivery row per transition the notification carried", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setSignal([
      { service: "checkout", value: 42 },
      { service: "payments", value: 42 },
    ]);

    await harness.fireAndFlush();

    // One message went out for both instances. Recording it once would leave
    // one of the two fires with no record of ever being notified, so a
    // per-instance history would call it undelivered.
    const rows = harness.clickhouse.queryRows(`
      SELECT notification_event_id, delivery_dedup_key, instance_labels
      FROM app.alert_events
      WHERE event_type = 'delivery_succeeded'
    `);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.notification_event_id)).size).toBe(2);
    expect(new Set(rows.map((row) => row.delivery_dedup_key)).size).toBe(1);
    expect(
      rows
        .map((row) => (row.instance_labels as Record<string, string>).service)
        .sort(),
    ).toEqual(["checkout", "payments"]);
  });
});
