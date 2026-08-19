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
} from "@/data/alerting/delivery/defaults";
import { IDLE_GROUP_FLUSH_AT } from "@/data/alerting/delivery/tasks";
import {
  ALERT_EVALUATE_TASK,
  enqueueAlertEvaluation,
} from "@/data/alerting/scheduling/evaluation-jobs.server";
import type { AlertingEvaluationSample } from "@/data/alerting/types";
import {
  alertDefinitions,
  alertDeliveries,
  alertEvents,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import {
  BODY_MAX_EVENTS,
  FLUSH_GROUP_MEMBER_CLAIM_CAP,
} from "./delivery/flush-group";
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_ROWS } from "./evaluation/evidence";
import { ALERT_EVALUATION_SAMPLE_LIMIT } from "./evaluation/samples";
import {
  SCANNER_BATCH_SIZE,
  scanDueAlerts,
  staleEnqueueCutoff,
} from "./scheduling/scanner";
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
  it("claims exactly the cap from a 501-member group, taking every never-yet-flushed newcomer over the one member already flushed once", async () => {
    const rule = await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setSignal([{ service: "stale", value: 42 }]);
    await harness.fireAndFlush();
    // The stale member's first notification already went out: it is now
    // `active` (still firing, membership kept with flushedAt set) rather
    // than gone, which is what lets it compete for the claim below.
    expect(harness.fetchCalls()).toHaveLength(1);

    const [staleEvent] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    const [staleMemberAfterFirstFlush] = await harness.db
      .select()
      .from(alertNotificationGroupEvents)
      .where(eq(alertNotificationGroupEvents.eventId, staleEvent.id));
    const staleFlushedAtBeforeCap = staleMemberAfterFirstFlush.flushedAt;
    expect(staleFlushedAtBeforeCap).not.toBeNull();

    // The rule's query result still carries "stale" (so its instance stays
    // firing, no transition, no new event) plus 500 brand-new label sets
    // (new fingerprints, new fire events, new unflushed memberships).
    const freshRows = Array.from(
      { length: FLUSH_GROUP_MEMBER_CLAIM_CAP },
      (_, index) => ({ service: `svc-${index}`, value: 42 }),
    );
    harness.clickhouse.setSignal([
      { service: "stale", value: 42 },
      ...freshRows,
    ]);

    // The rule's own schedule would not reach a second evaluation for up to
    // one whole interval (nextAlertEvaluationAt, rule.ts): waiting for it
    // would make this case slow and tie it to that unrelated bound.
    // enqueueAlertEvaluation is the same production entry point the scanner
    // itself calls; used here to force a second evaluation right now
    // instead of waiting on the rule's own cadence, which is a legitimate
    // way to trigger "the rule evaluates again", not a bypass of it.
    const [{ version }] = await harness.db
      .select({ version: alertDefinitions.version })
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    await enqueueAlertEvaluation({
      alertDefinitionId: rule.id,
      scheduledFor: new Date().toISOString(),
      ruleVersion: version,
    });
    // 500 new fire events each enqueue their own dispatch job; the driver's
    // default drain limit (500) is sized for ordinary cases, not this
    // file's fixtures.
    await harness.runDueJobs({ limit: 2_000 });

    const membersBeforeCappedFlush = await harness.db
      .select()
      .from(alertNotificationGroupEvents);
    expect(membersBeforeCappedFlush).toHaveLength(
      FLUSH_GROUP_MEMBER_CLAIM_CAP + 1,
    );

    // The group already flushed once, so the next flush is due at one
    // group interval past that flush, not another group wait.
    harness.advance(ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1000);
    await harness.runDueJobs({ limit: 2_000 });

    // A still-firing claimed member is re-armed in place (a fresh
    // flushedAt), not deleted, so the table's total size does not shrink;
    // the cap shows up in *whose* flushedAt moved, not in the row count.
    const afterCappedFlush = await harness.db
      .select()
      .from(alertNotificationGroupEvents);
    expect(afterCappedFlush).toHaveLength(FLUSH_GROUP_MEMBER_CLAIM_CAP + 1);
    const staleMemberAfterCap = afterCappedFlush.find(
      (member) => member.eventId === staleEvent.id,
    );
    const freshMembersAfterCap = afterCappedFlush.filter(
      (member) => member.eventId !== staleEvent.id,
    );
    // Exactly the cap was claimed, and every one of the 500 claimed was a
    // never-yet-flushed newcomer: the claim's ordering (unflushed first,
    // journal-reader.ts) is what stops the old starvation bug (a stale
    // member winning every claim and starving new arrivals) from
    // reappearing.
    expect(freshMembersAfterCap).toHaveLength(FLUSH_GROUP_MEMBER_CLAIM_CAP);
    expect(
      freshMembersAfterCap.every((member) => member.flushedAt !== null),
    ).toBe(true);
    // The stale member lost the claim entirely: its flushedAt is exactly
    // what phase one left it at, untouched by this flush.
    expect(staleMemberAfterCap?.flushedAt).toEqual(staleFlushedAtBeforeCap);

    // What the brief calls "the remainder flushes next" holds for a member
    // that has never been flushed (its flushedAt is still null, which is
    // exactly what nextGroupFlushState's hasUnflushedMembers check looks
    // for). It does not hold for this member: its flushedAt is not null
    // (phase one already set it), so this flush's own pending count does
    // not see it as pending, and the group parks on the idle sentinel
    // instead of scheduling a follow-up. The rule that revives a parked
    // group does not save this one: it reads the sentinel as "no flush
    // booked" only while lastFlushedAt is null, and here it is set, so the
    // group is not dead, it just has no follow-up. The sentinel is the
    // wanted answer, not a pinned defect: this leftover was already
    // announced, and nothing re-announces a notification already sent.
    // Arming a flush here would claim already-flushed members and page for
    // them, because groupNotificationPlan announces every still-firing
    // member when no claimed member is unflushed. What the leftover does
    // need is pruning, and that belongs in the maintenance sweep rather
    // than in a flush.
    const [group] = await harness.db
      .select()
      .from(alertNotificationGroups)
      .where(eq(alertNotificationGroups.directAlertDefinitionId, rule.id));
    expect(group.nextFlushAt).toEqual(IDLE_GROUP_FLUSH_AT);

    // A flush that hits this cap should also emit a counter and a log
    // line, which this harness has no way to observe: it exposes only the
    // database, ClickHouse itself, and captured fetch calls.
    // This case pins the claim boundary only.
    // 501 real dispatches and a capped claim, well past vitest's 5s default.
    // The headroom is deliberate: this case takes about 8 seconds on its own
    // but 3 or 4 times that while the rest of the suite runs beside it, so a
    // tighter budget fails on machine load rather than on behaviour.
  }, 60_000);

  it("captures 64 samples from 65 instances, the 3 matching ones first, and marks samples_truncated", async () => {
    const matchingIndexes = new Set([10, 30, 50]);
    const rows = Array.from({ length: 65 }, (_, index) =>
      matchingIndexes.has(index)
        ? { service: `breach-${index}`, value: 10 }
        : { service: `healthy-${index}`, value: 0 },
    );
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(rows);

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

  it("bounds a 60-row evaluation result whose rows are wide enough to also cross the byte cap", async () => {
    // Deliberately large per row: MAX_EVIDENCE_ROWS (50) rows of this size
    // already exceed MAX_EVIDENCE_BYTES on their own, so the byte-halving
    // loop in boundEvidence (evaluation/evidence.ts) has to bite, not just
    // the row-count slice. A payload of tiny {service, value} objects would
    // stay under the byte cap at 50 rows and never exercise that loop.
    const filler = "x".repeat(Math.ceil(MAX_EVIDENCE_BYTES / 20));
    const rows = Array.from({ length: 60 }, (_, index) => ({
      service: `svc-${index}`,
      value: 0,
      filler,
    }));
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setSignal(rows);

    await harness.runDueJobs();

    const row = onlyEvaluationRow(harness);
    expect(row.row_count).toBe(60);
    expect(row.evidence_truncated).toBe(true);
    const evidence = JSON.parse(row.evidence_json) as unknown[];
    // Fewer than the row cap alone would keep: the byte cap trimmed further.
    expect(evidence.length).toBeLessThan(MAX_EVIDENCE_ROWS);
    expect(Buffer.byteLength(row.evidence_json, "utf8")).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES,
    );
  });

  it("composes a 25-member group's body as 20 listed events plus a line naming the 5 it omitted", async () => {
    await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "slack",
    });
    const rows = Array.from({ length: 25 }, (_, index) => ({
      service: `svc-${index}`,
      value: 42,
    }));
    harness.clickhouse.setSignal(rows);
    await harness.fireAndFlush();

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
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    harness.setFetchResponse({ status: 403 });
    await harness.fireAndFlush();

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
    harness.clickhouse.setSignal([{ service: "billing", value: 42 }]);
    harness.setFetchResponse({ status: 503 });
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs(); // flush, then the first send attempt

    // The harness re-implements graphile's backoff (job-driver.ts) as
    // exp(attempts) seconds, never exceeding exp(ALERT_DELIVERY_MAX_ATTEMPTS)
    // here; this headroom clears it regardless of which attempt we are on.
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
    // 5001 rules inserted and two full scans: about 2.5 seconds on its own,
    // but several times that while the rest of the suite runs beside it, so
    // the default 5s budget fails on machine load rather than on behaviour.
    // Same reasoning as the 501-member case above.
  }, 60_000);

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
