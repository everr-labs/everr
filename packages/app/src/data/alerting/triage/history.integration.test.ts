// @vitest-environment node

/**
 * The Triage screen's ClickHouse reads, against a real engine (chdb, running
 * the shipped `app.alert_events` DDL).
 *
 * Rows are built by the production writers in
 * `server/alerting/history/clickhouse.ts` and put in directly, rather than
 * produced by driving the pipeline. That keeps writer and reader agreeing (a
 * renamed column breaks the builder, and so breaks these cases) while letting
 * a case place an event forty days back, or before the window, in one line.
 *
 * Two things this file may not claim:
 *
 * Tenant isolation. chdb has no access control, so the loader skips the row
 * policy the shipped DDL ends with, and every read here runs unrestricted.
 *
 * Anything about ClickHouse 26.4. chdb is 26.7, and `clickhouse/Dockerfile`
 * pins 26.4. The partition-pruning behaviour the `history.ts` header describes
 * is a 26.4 observation, so nothing below pins it. Only semantics both
 * versions must agree on are asserted: which rows a predicate selects, what an
 * aggregate counts, and what order rows come back in.
 */
import { describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/data/alerting/history/ids";
import type { AlertingMatcher } from "@/data/alerting/types";
import {
  type AlertHistoryDefinition,
  type AlertHistoryRow,
  evaluationFailureHistoryRow,
  evaluationHistoryRow,
  instanceHistoryRow,
  journalHoldRow,
  journalTerminalRow,
  ZERO_UUID,
} from "@/server/alerting/history/clickhouse";
import { TEST_ORG } from "@/server/alerting/testing/fixtures";
import { useAlertingHarness } from "@/server/alerting/testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import(
    "@/server/alerting/testing/db-proxy"
  );
  return { db: testDb, runInTransaction };
});

vi.mock(
  "@/lib/clickhouse",
  async () => import("@/server/alerting/testing/test-clickhouse"),
);

import {
  loadInstanceLabels,
  loadLastEvaluation,
  loadLifecycleEvents,
  loadPriorStates,
  loadRecentTimeline,
  loadSilenceImpact,
} from "./history";

const harness = useAlertingHarness();

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PATH = "default/checkout-latency";

/** The read side takes the same `query` the server functions are handed. */
const query = async <T>(sql: string, params?: Record<string, unknown>) =>
  harness().clickhouse.read<T>(sql, params).rows;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

function windowOf(fromMinutes: number, toMinutes = 0) {
  const fromDate = minutesAgo(fromMinutes);
  const toDate = minutesAgo(toMinutes);
  return {
    fromDate,
    toDate,
    fromISO: fromDate.toISOString(),
    toISO: toDate.toISOString(),
  };
}

function definition(
  overrides: Partial<AlertHistoryDefinition> = {},
): AlertHistoryDefinition {
  return {
    id: "8b2f2f5e-1f2a-4d8b-9a3c-2f6b1c4d5e60",
    organizationId: TEST_ORG,
    repoid: "repo_test",
    slug: PATH,
    previewId: null,
    severity: "warning",
    ruleMuted: false,
    ...overrides,
  };
}

/** One instance transition, built the way the evaluator builds it. */
function transition(opts: {
  eventType: "instance_pending" | "instance_fired" | "instance_resolved";
  at: Date;
  fingerprint?: string;
  labels?: Record<string, string>;
  def?: AlertHistoryDefinition;
}): AlertHistoryRow {
  const eventId = uuidv7(opts.at);
  return instanceHistoryRow({
    def: opts.def ?? definition(),
    eventId,
    eventType: opts.eventType,
    occurredAt: opts.at,
    episodeId: eventId,
    fingerprint: opts.fingerprint ?? "a",
    labels: opts.labels ?? { host: opts.fingerprint ?? "a" },
    evidence: {},
    evidenceTruncated: false,
    contextJson: "{}",
    ...(opts.eventType === "instance_resolved"
      ? { reason: "condition_cleared" as const }
      : {}),
  });
}

/** The chain a Hold or a Suppression points back at. Its `event_time` is read
 *  out of this id, so the id's own stamp is what places the row in time. */
function chain(at: Date, fingerprint = "a") {
  return {
    id: uuidv7(at),
    sourceDefinitionId: definition().id,
    organizationId: TEST_ORG,
    repoid: "repo_test",
    slug: PATH,
    previewId: null,
    severity: "warning",
    suppressed: false,
    instanceFingerprint: fingerprint,
    instanceLabels: { host: fingerprint },
  };
}

function silenceCopy(id: string) {
  return {
    id,
    comment: "deploying",
    matchers: [{ label: "rule", op: "eq", value: PATH }] as AlertingMatcher[],
  };
}

function write(...rows: AlertHistoryRow[]) {
  harness().clickhouse.write(rows);
}

describe("the lifecycle events behind the state chart", () => {
  it("reads every live Alert rule's events inside the window, oldest first", async () => {
    write(
      transition({ eventType: "instance_pending", at: minutesAgo(50) }),
      transition({ eventType: "instance_fired", at: minutesAgo(40) }),
      // Outside the window on the old side.
      transition({ eventType: "instance_fired", at: minutesAgo(120) }),
    );

    const events = await loadLifecycleEvents(query, windowOf(60));

    expect(events.map((row) => row.event_type)).toEqual([
      "instance_pending",
      "instance_fired",
    ]);
  });

  it("never reads a Preview copy's events", async () => {
    const preview = definition({
      previewId: "0f2c1d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      ruleMuted: true,
    });
    write(
      transition({ eventType: "instance_fired", at: minutesAgo(10) }),
      transition({
        eventType: "instance_fired",
        at: minutesAgo(9),
        def: preview,
      }),
    );

    const events = await loadLifecycleEvents(query, windowOf(60));

    expect(events).toHaveLength(1);
  });
});

describe("the state an Alert instance carried into the window", () => {
  it("reports the last transition each instance made before the window", async () => {
    write(
      transition({
        eventType: "instance_pending",
        at: minutesAgo(200),
        fingerprint: "a",
      }),
      // Newer, so this is the state the instance carried in.
      transition({
        eventType: "instance_fired",
        at: minutesAgo(150),
        fingerprint: "a",
      }),
      // Inside the window: not prior state at all.
      transition({
        eventType: "instance_fired",
        at: minutesAgo(30),
        fingerprint: "b",
      }),
    );

    const prior = await loadPriorStates(query, windowOf(60));

    expect(prior).toEqual([
      expect.objectContaining({
        slug: PATH,
        instance_fingerprint: "a",
        last_event_type: "instance_fired",
      }),
    ]);
  });

  it("leaves out a row that belongs to no Alert instance", async () => {
    write(
      evaluationHistoryRow({
        def: definition(),
        scheduledFor: minutesAgo(150),
        occurredAt: minutesAgo(150),
        rowCount: 1,
        evidenceJson: "{}",
        evidenceTruncated: false,
        samples: [],
        samplesTruncated: false,
      }),
    );

    expect(await loadPriorStates(query, windowOf(60))).toEqual([]);
  });
});

describe("the recent events the detail lists", () => {
  it("gives the twelve newest rows, newest first", async () => {
    write(
      ...Array.from({ length: 15 }, (_, index) =>
        transition({
          eventType: "instance_fired",
          at: minutesAgo(index + 1),
          fingerprint: `f${index}`,
        }),
      ),
    );

    const timeline = await loadRecentTimeline(query, {
      path: PATH,
      windowTo: new Date(),
    });

    expect(timeline).toHaveLength(12);
    expect(new Date(timeline[0].event_time).getTime()).toBeGreaterThan(
      new Date(timeline[11].event_time).getTime(),
    );
  });

  it("looks back thirty days and no further", async () => {
    write(transition({ eventType: "instance_fired", at: minutesAgo(10) }), {
      ...transition({ eventType: "instance_fired", at: minutesAgo(10) }),
      event_id: uuidv7(new Date(Date.now() - 40 * DAY)),
      event_time: new Date(Date.now() - 40 * DAY).toISOString(),
    });

    const timeline = await loadRecentTimeline(query, {
      path: PATH,
      windowTo: new Date(),
    });

    expect(timeline).toHaveLength(1);
  });

  it("stops at the window end, so a past window never shows later events", async () => {
    write(
      transition({ eventType: "instance_fired", at: minutesAgo(50) }),
      transition({ eventType: "instance_resolved", at: minutesAgo(5) }),
    );

    const timeline = await loadRecentTimeline(query, {
      path: PATH,
      windowTo: minutesAgo(30),
    });

    expect(timeline.map((row) => row.event_type)).toEqual(["instance_fired"]);
  });

  it("reads the events of the rule it was asked about", async () => {
    const other = definition({ slug: "default/other-rule" });
    write(
      transition({ eventType: "instance_fired", at: minutesAgo(5) }),
      transition({
        eventType: "instance_fired",
        at: minutesAgo(4),
        def: other,
      }),
    );

    const timeline = await loadRecentTimeline(query, {
      path: PATH,
      windowTo: new Date(),
    });

    expect(timeline).toHaveLength(1);
  });
});

describe("the last evaluation the detail reads its values from", () => {
  const evaluation = (at: Date, samples: { fingerprint: string }[]) =>
    evaluationHistoryRow({
      def: definition(),
      scheduledFor: at,
      occurredAt: at,
      rowCount: samples.length,
      evidenceJson: "{}",
      evidenceTruncated: false,
      samples: samples as never,
      samplesTruncated: false,
    });

  it("gives back only the newest evaluation", async () => {
    write(
      evaluation(minutesAgo(20), [{ fingerprint: "older" }]),
      evaluation(minutesAgo(2), [{ fingerprint: "newest" }]),
    );

    const rows = await loadLastEvaluation(query, {
      path: PATH,
      windowFrom: minutesAgo(60),
      windowTo: new Date(),
      intervalSecs: 60,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].samples_json).toContain("newest");
  });

  it("never reads a failed evaluation as the last one", async () => {
    write(
      evaluation(minutesAgo(20), [{ fingerprint: "succeeded" }]),
      evaluationFailureHistoryRow({
        def: definition(),
        scheduledFor: minutesAgo(1),
        occurredAt: minutesAgo(1),
        error: "table does not exist",
      }),
    );

    const rows = await loadLastEvaluation(query, {
      path: PATH,
      windowFrom: minutesAgo(60),
      windowTo: new Date(),
      intervalSecs: 60,
    });

    expect(rows[0].samples_json).toContain("succeeded");
  });

  it("takes the last evaluation before the window end, not the newest one", async () => {
    write(
      evaluation(minutesAgo(50), [{ fingerprint: "inside" }]),
      evaluation(minutesAgo(5), [{ fingerprint: "after" }]),
    );

    const rows = await loadLastEvaluation(query, {
      path: PATH,
      windowFrom: minutesAgo(60),
      windowTo: minutesAgo(30),
      intervalSecs: 60,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].samples_json).toContain("inside");
  });

  it("reaches back before the window when the rule stopped evaluating", async () => {
    write(evaluation(minutesAgo(70), [{ fingerprint: "stale" }]));

    const rows = await loadLastEvaluation(query, {
      path: PATH,
      // A short window that the last evaluation falls outside of.
      windowFrom: minutesAgo(10),
      windowTo: new Date(),
      intervalSecs: 600,
    });

    expect(rows[0]?.samples_json).toContain("stale");
  });
});

describe("the labels the chart names its lanes with", () => {
  it("names an Alert instance the window saw, even one that has since Closed", async () => {
    write(
      transition({
        eventType: "instance_fired",
        at: minutesAgo(40),
        fingerprint: "closed-since",
        labels: { host: "web-1" },
      }),
      transition({
        eventType: "instance_resolved",
        at: minutesAgo(30),
        fingerprint: "closed-since",
        labels: { host: "web-1" },
      }),
    );

    const labels = await loadInstanceLabels(query, {
      path: PATH,
      windowFrom: minutesAgo(60),
      windowTo: new Date(),
    });

    expect(labels).toEqual([
      { instance_fingerprint: "closed-since", labels: { host: "web-1" } },
    ]);
  });
});

describe("what a Silence withheld", () => {
  const SILENCE = "6c0b6e1a-9d4f-4d3a-8e21-77c2b1a5f3d4";

  it("counts notifications, not the rows that talk about them", async () => {
    const first = chain(minutesAgo(20), "a");
    const second = chain(minutesAgo(15), "b");
    const dropped = chain(minutesAgo(10), "c");
    write(
      journalHoldRow(first, silenceCopy(SILENCE)),
      // The same chain held a second time: still one notification held.
      journalHoldRow(first, silenceCopy(SILENCE)),
      journalHoldRow(second, silenceCopy(SILENCE)),
      journalTerminalRow(dropped, { silence: silenceCopy(SILENCE) }),
    );

    const impact = await loadSilenceImpact(query, [
      { id: SILENCE, startsAt: minutesAgo(60) },
    ]);

    expect(impact.get(SILENCE)).toEqual({ held: 2, dropped: 1 });
  });

  it("keeps two Silences apart", async () => {
    const other = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    write(
      journalHoldRow(chain(minutesAgo(20), "a"), silenceCopy(SILENCE)),
      journalHoldRow(chain(minutesAgo(19), "b"), silenceCopy(other)),
    );

    const impact = await loadSilenceImpact(query, [
      { id: SILENCE, startsAt: minutesAgo(60) },
      { id: other, startsAt: minutesAgo(60) },
    ]);

    expect(impact.get(SILENCE)).toEqual({ held: 1, dropped: 0 });
    expect(impact.get(other)).toEqual({ held: 1, dropped: 0 });
  });

  it("asks the database nothing when there is no Silence to ask about", async () => {
    expect(await loadSilenceImpact(query, [])).toEqual(new Map());
  });
});

// The sentinel a live row carries, so a case that builds a Preview row is
// visibly doing something different.
it("treats the zero uuid as the live sentinel", () => {
  expect(definition().previewId ?? ZERO_UUID).toBe(ZERO_UUID);
});
