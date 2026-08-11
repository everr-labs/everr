// @vitest-environment node
import { eq, isNull } from "drizzle-orm";
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
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/alerting/routing/defaults";
import { ALERT_EVALUATE_TASK } from "@/data/alerting/scheduling/evaluation-jobs.server";
import type { AlertingEvaluationSample } from "@/data/alerting/types";
import {
  alertDefinitions,
  alertDeliveries,
  alertEvents,
  alertNotificationGroupEvents,
} from "@/db/schema";
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_ROWS } from "./evaluation/evidence";
import { ALERT_EVALUATION_SAMPLE_LIMIT } from "./evaluation/samples";
import { scanDueAlerts, staleEnqueueCutoff } from "./scheduling/scanner";
import {
  insertDirectRule,
  insertRule,
  insertRulesInBulk,
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

type EvaluationHistoryRow = {
  event_type: string;
  row_count: number;
  evidence_json: string;
  evidence_truncated: boolean;
  samples_json: string;
  samples_truncated: boolean;
};

function onlyEvaluationRow(harness: AlertingHarness): EvaluationHistoryRow {
  const rows = harness.clickhouse
    .historyRows()
    .filter((row) => row.event_type === "evaluation_succeeded");
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as EvaluationHistoryRow;
}

describe("the alerting pipeline's capacity bounds", () => {
  // FLUSH_GROUP_MEMBER_CLAIM_CAP (delivery/flush-group.ts) is a private
  // module constant, not exported like the other bounds in this file, so it
  // is hardcoded here to match. See the task report for why that is a gap
  // worth closing rather than a shortcut taken for convenience.
  it.fails("claims exactly the cap from a 501-member group, favors the newest joiners over the one already flushed, and reports the oversized group (ticket 35, open)", async () => {
    const FLUSH_GROUP_MEMBER_CLAIM_CAP = 500;

    await insertDirectRule(harness.db, {
      sql: "select 'stale' as service, 42 as value",
      forSecs: 0,
      intervalSecs: 100_000,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "stale", value: 42 }]);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();
    // The stale member's first notification already went out: it is now
    // `active` (still firing, membership kept with flushedAt set) rather
    // than gone, which is what lets it compete for the claim below.
    expect(harness.fetchCalls()).toHaveLength(1);

    const [staleEvent] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));

    // The rule's query result still carries "stale" (so its instance stays
    // firing, no transition, no new event) plus 500 brand-new label sets
    // (new fingerprints, new fire events, new unflushed memberships).
    const freshRows = Array.from(
      { length: FLUSH_GROUP_MEMBER_CLAIM_CAP },
      (_, index) => ({ service: `svc-${index}`, value: 42 }),
    );
    harness.clickhouse.setRows([{ service: "stale", value: 42 }, ...freshRows]);
    harness.advance(1_000);
    // 500 new fire events each enqueue their own dispatch job; the
    // driver's default drain limit (500) is sized for ordinary cases, not
    // this file's fixtures.
    await harness.runDueJobs({ limit: 2_000 });

    const membersBeforeFlush = await harness.db
      .select()
      .from(alertNotificationGroupEvents);
    expect(membersBeforeFlush).toHaveLength(FLUSH_GROUP_MEMBER_CLAIM_CAP + 1);

    // The group already flushed once, so the next flush is due at one
    // group interval past that flush, not another group wait.
    harness.advance(ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1000);
    await harness.runDueJobs({ limit: 2_000 });

    const remaining = await harness.db
      .select()
      .from(alertNotificationGroupEvents);
    expect(remaining).toHaveLength(1);
    // The leftover is the stale member, not one of the 500 new ones: the
    // claim's ordering (unflushed first, journal-reader.ts) favors the
    // newest joiners over a member that already had its turn, which is
    // the fix ticket 35's sibling change (the claim-ordering fix) put in
    // place. Losing this would mean the old starvation bug is back.
    expect(remaining[0].eventId).toBe(staleEvent.id);
    expect(remaining[0].flushedAt).not.toBeNull();

    // Ticket 35 (todo/issues/alerting-surface/tickets/35-oversized-groups-are-visible.md):
    // a flush that hits the claim cap should be counted, naming the group
    // and the unclaimed remainder, so a reader can tell a 500-instance
    // storm from a 5000-instance one without querying
    // alert_notification_group_events directly. flushAlertGroup
    // (delivery/flush-group.ts:121-146) has no such signal today: it only
    // recomputes a bare pending count and silently re-arms the next
    // flush. This pins the gap instead of asserting around it.
    const cappedSignal = harness.clickhouse
      .historyRows()
      .find(
        (row) =>
          typeof row.reason === "string" && row.reason.includes("capacity"),
      );
    expect(cappedSignal).toBeDefined();
  });

  it("captures 64 samples from 65 instances, the 3 matching ones first, and marks samples_truncated", async () => {
    const matchingIndexes = new Set([10, 30, 50]);
    const rows = Array.from({ length: 65 }, (_, index) =>
      matchingIndexes.has(index)
        ? { service: `breach-${index}`, value: 10 }
        : { service: `healthy-${index}`, value: 0 },
    );
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setRows(rows);

    await harness.runDueJobs();

    const row = onlyEvaluationRow(harness);
    const samples = JSON.parse(row.samples_json) as AlertingEvaluationSample[];
    expect(samples).toHaveLength(ALERT_EVALUATION_SAMPLE_LIMIT);
    expect(row.samples_truncated).toBe(true);
    expect(
      samples
        .slice(0, 3)
        .every((sample) => sample.labels.service.startsWith("breach-")),
    ).toBe(true);
    expect(
      samples
        .slice(3)
        .every((sample) => sample.labels.service.startsWith("healthy-")),
    ).toBe(true);
  });

  it("bounds a 60-row evaluation result to 50 rows of evidence and marks evidence_truncated", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      service: `svc-${index}`,
      value: 0,
    }));
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setRows(rows);

    await harness.runDueJobs();

    const row = onlyEvaluationRow(harness);
    expect(row.row_count).toBe(60);
    expect(row.evidence_truncated).toBe(true);
    const evidence = JSON.parse(row.evidence_json) as unknown[];
    expect(evidence).toHaveLength(MAX_EVIDENCE_ROWS);
    expect(Buffer.byteLength(row.evidence_json, "utf8")).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES,
    );
  });

  it("composes a 25-member group's body as 20 listed events plus a line naming the 5 it omitted", async () => {
    // BODY_MAX_EVENTS (delivery/flush-group.ts) is a private module
    // constant, not exported; hardcoded here to match. See the task report.
    const BODY_MAX_EVENTS = 20;

    await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "slack",
    });
    const rows = Array.from({ length: 25 }, (_, index) => ({
      service: `svc-${index}`,
      value: 42,
    }));
    harness.clickhouse.setRows(rows);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(1);
    const body = harness.fetchCalls()[0].body as {
      attachments: [{ blocks: [{ text: { text: string } }] }];
    };
    const text = body.attachments[0].blocks[0].text.text;

    // All 25 events share one `occurredAt` (one evaluation batch), so which
    // 20 make the cut is not pinned by any documented ordering; the bound is
    // the count listed and what the omitted line says, not which members.
    const firingLines = text
      .split("\n")
      .filter((line) => line.startsWith("Firing:"));
    expect(firingLines).toHaveLength(BODY_MAX_EVENTS);
    expect(text).toContain(
      `…and ${25 - BODY_MAX_EVENTS} more events in this group`,
    );
  });

  it("stops a delivery's attempts at ALERT_DELIVERY_MAX_ATTEMPTS, whether the failure is permanent or transient", async () => {
    await insertDirectRule(harness.db, {
      slug: "permanent-fail",
      forSecs: 0,
      intervalSecs: 100_000,
      channelType: "webhook",
      channelName: "permanent-channel",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    harness.setFetchResponse({ status: 403 });
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    const [permanentDelivery] = await harness.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.channelName, "permanent-channel"));
    expect(permanentDelivery.status).toBe("failed");
    // A permanent failure reaches the cap on its first (and only) attempt:
    // the send path does not retry a verdict it already knows is final.
    expect(permanentDelivery.attempts).toBe(ALERT_DELIVERY_MAX_ATTEMPTS);

    await insertDirectRule(harness.db, {
      slug: "transient-fail",
      forSecs: 0,
      intervalSecs: 100_000,
      channelType: "webhook",
      channelName: "transient-channel",
    });
    harness.clickhouse.setRows([{ service: "billing", value: 42 }]);
    harness.setFetchResponse({ status: 503 });
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs(); // flush, then the first send attempt

    // graphile's own backoff (job-driver.ts) is exp(attempts) seconds, never
    // exceeding exp(ALERT_DELIVERY_MAX_ATTEMPTS) here; this headroom clears
    // it regardless of which attempt we are on.
    const BACKOFF_HEADROOM_MS = 200_000;
    for (let attempt = 1; attempt < ALERT_DELIVERY_MAX_ATTEMPTS; attempt += 1) {
      harness.advance(BACKOFF_HEADROOM_MS);
      await harness.runDueJobs();
    }

    const [transientDelivery] = await harness.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.channelName, "transient-channel"));
    expect(transientDelivery.status).toBe("failed");
    // A transient failure keeps retrying, one attempt per round, and stops
    // exactly at the cap rather than one short or one over.
    expect(transientDelivery.attempts).toBe(ALERT_DELIVERY_MAX_ATTEMPTS);
  });

  it("the scanner's batch of 5000 claims a 5001-rule backlog over two scans", async () => {
    // The scanner's own batch size (scheduling/scanner.ts, SCANNER_BATCH_SIZE)
    // is a private module constant, not exported; hardcoded here to match.
    // See the task report.
    const SCANNER_BATCH_SIZE = 5_000;

    // A bulk insert, not a loop of insertRule calls: insertRule enqueues an
    // evaluation transactionally per row, which this case's own point (the
    // scanner finding rules with no job in flight) would defeat, and which
    // would be unusably slow at this count besides.
    await insertRulesInBulk(harness.db, SCANNER_BATCH_SIZE + 1, {
      nextEvaluationAt: new Date(Date.now() - 60_000),
    });

    const firstScan = await scanDueAlerts();
    expect(firstScan).toBe(SCANNER_BATCH_SIZE);
    const firstRoundJobs = (await harness.pendingJobs()).filter(
      (job) => job.identifier === ALERT_EVALUATE_TASK,
    );
    expect(firstRoundJobs).toHaveLength(SCANNER_BATCH_SIZE);

    const stillUnenqueued = await harness.db
      .select()
      .from(alertDefinitions)
      .where(isNull(alertDefinitions.lastEnqueuedAt));
    expect(stillUnenqueued).toHaveLength(1);

    const secondScan = await scanDueAlerts();
    expect(secondScan).toBe(1);
    const allJobs = (await harness.pendingJobs()).filter(
      (job) => job.identifier === ALERT_EVALUATE_TASK,
    );
    expect(allJobs).toHaveLength(SCANNER_BATCH_SIZE + 1);
  });

  it("skips a rule whose last_enqueued_at is newer than next_evaluation_at, and re-enqueues it once that stamp passes the stale cutoff", async () => {
    const now = new Date();
    const dueAt = new Date(now.getTime() - 60_000);
    const rule = await insertRule(harness.db, { nextEvaluationAt: dueAt });
    // Simulates a job the scanner already enqueued a moment ago: newer than
    // next_evaluation_at, so a second enqueue would be a duplicate in
    // flight, not a rescue.
    const enqueuedAt = new Date(now.getTime() - 30_000);
    await harness.db
      .update(alertDefinitions)
      .set({ lastEnqueuedAt: enqueuedAt })
      .where(eq(alertDefinitions.id, rule.id));

    expect(await scanDueAlerts()).toBe(0);
    const [stillSkipped] = await harness.db
      .select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(stillSkipped.lastEnqueuedAt).toEqual(enqueuedAt);

    // Derives the 15-minute stale window from the exported cutoff function
    // itself rather than writing the duration as a literal: the gap between
    // `now` and `staleEnqueueCutoff(now)` *is* the window.
    const staleWindowMs = now.getTime() - staleEnqueueCutoff(now).getTime();
    harness.advance(staleWindowMs);

    expect(await scanDueAlerts()).toBe(1);
    const [reclaimed] = await harness.db
      .select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(reclaimed.lastEnqueuedAt?.getTime()).toBe(Date.now());
  });
});
