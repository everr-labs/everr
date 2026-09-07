// @vitest-environment node

/**
 * The Triage screen's PostgreSQL reads of the notification Journal, against a
 * real engine.
 *
 * The delivery story on a row is read from the Journal, not from the Alert
 * rule's own state, and three things decide what it says: which Journal row
 * is the latest one, whether that row joined a Notification group, and
 * whether a flush carried the group out. The first is a LATERAL query, the
 * other two are a LEFT JOIN. All three are answerable only by a database.
 */
import { describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/data/alerting/history/ids";
import {
  alertEvents,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import {
  insertChannel,
  insertDefaultChannels,
  insertRule,
  insertSilence,
  TEST_ORG,
} from "@/server/alerting/testing/fixtures";
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
  loadDefaultTiers,
  loadHeldCounts,
  loadLatestNotifications,
} from "./notifications";

const harness = useAlertingHarness();

const MINUTE = 60_000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

/** One Journal row. `kind` follows the event type, the way the CHECK on the
 *  table requires: a Closed instance is never a delivery candidate. */
async function journal(overrides: {
  id?: string;
  definitionId: string;
  slug?: string;
  eventType?: "instance_fired" | "instance_resolved" | "instance_closed";
  occurredAt: Date;
  processedAt?: Date | null;
  suppressed?: boolean;
  silenceId?: string | null;
  title?: string;
}): Promise<string> {
  const eventType = overrides.eventType ?? "instance_fired";
  const id = overrides.id ?? uuidv7(overrides.occurredAt);
  await harness()
    .db.insert(alertEvents)
    .values({
      id,
      organizationId: TEST_ORG,
      repoid: "repo_test",
      sourceDefinitionId: overrides.definitionId,
      slug: overrides.slug ?? "default/checkout-latency",
      eventType,
      kind: eventType === "instance_closed" ? "state" : "notifying",
      reason: eventType === "instance_closed" ? "pending_cleared" : "",
      notificationTitle: overrides.title ?? "",
      suppressed: overrides.suppressed ?? false,
      silenceId: overrides.silenceId ?? null,
      occurredAt: overrides.occurredAt,
      processedAt: overrides.processedAt ?? null,
    });
  return id;
}

/** Put a Journal row into a Notification group, optionally already flushed. */
async function group(eventId: string, opts: { flushed: boolean }) {
  const [row] = await harness()
    .db.insert(alertNotificationGroups)
    .values({
      organizationId: TEST_ORG,
      groupKey: `group-${eventId}`,
      // A group must name exactly one target, and the Default destination is
      // the one a rule with no channels of its own delivers through.
      defaultTier: "all",
      nextFlushAt: new Date(),
    })
    .returning({ id: alertNotificationGroups.id });
  await harness()
    .db.insert(alertNotificationGroupEvents)
    .values({
      organizationId: TEST_ORG,
      groupId: row.id,
      eventId,
      flushedAt: opts.flushed ? new Date() : null,
    });
}

describe("what the Journal says delivery did", () => {
  it("keeps the newest Journal row for each Alert rule", async () => {
    const rule = await insertRule(harness().db, { slug: "checkout-latency" });
    await journal({
      definitionId: rule.id,
      occurredAt: minutesAgo(30),
      title: "older",
    });
    await journal({
      definitionId: rule.id,
      occurredAt: minutesAgo(5),
      title: "newest",
    });

    const latest = await loadLatestNotifications(TEST_ORG, [rule.id]);

    expect(latest.get(rule.id)?.title).toBe("newest");
  });

  it("settles equal timestamps by descending event id", async () => {
    const rule = await insertRule(harness().db, { slug: "same-evaluation" });
    const occurredAt = minutesAgo(5);
    await journal({
      id: "01990000-0000-7000-8000-000000000001",
      definitionId: rule.id,
      occurredAt,
      title: "lower id",
    });
    await journal({
      id: "01990000-0000-7000-8000-000000000002",
      definitionId: rule.id,
      occurredAt,
      title: "higher id",
    });

    const latest = await loadLatestNotifications(TEST_ORG, [rule.id]);

    expect(latest.get(rule.id)?.title).toBe("higher id");
  });

  it("keeps one row for each Alert rule, not one row for the set", async () => {
    const first = await insertRule(harness().db, { slug: "first" });
    const second = await insertRule(harness().db, { slug: "second" });
    await journal({
      definitionId: first.id,
      occurredAt: minutesAgo(30),
      title: "first rule",
    });
    await journal({
      definitionId: second.id,
      occurredAt: minutesAgo(60),
      title: "second rule",
    });

    const latest = await loadLatestNotifications(TEST_ORG, [
      first.id,
      second.id,
    ]);

    expect(latest.get(first.id)?.title).toBe("first rule");
    expect(latest.get(second.id)?.title).toBe("second rule");
  });

  it("never reads a state row as the delivery story", async () => {
    const rule = await insertRule(harness().db, { slug: "checkout-latency" });
    await journal({
      definitionId: rule.id,
      occurredAt: minutesAgo(30),
      title: "notified",
    });
    // Newer, but a Closed instance pages nobody, so it must not win.
    await journal({
      definitionId: rule.id,
      eventType: "instance_closed",
      occurredAt: minutesAgo(1),
    });

    const latest = await loadLatestNotifications(TEST_ORG, [rule.id]);

    expect(latest.get(rule.id)?.title).toBe("notified");
  });

  it("separates a row that joined a group from one that never did", async () => {
    const carried = await insertRule(harness().db, { slug: "carried" });
    const ended = await insertRule(harness().db, { slug: "ended" });
    const carriedEvent = await journal({
      definitionId: carried.id,
      occurredAt: minutesAgo(5),
      processedAt: minutesAgo(4),
    });
    await group(carriedEvent, { flushed: true });
    // Processed with no group membership: a terminal ended the chain.
    await journal({
      definitionId: ended.id,
      occurredAt: minutesAgo(5),
      processedAt: minutesAgo(4),
    });

    const latest = await loadLatestNotifications(TEST_ORG, [
      carried.id,
      ended.id,
    ]);

    expect(latest.get(carried.id)).toMatchObject({
      grouped: true,
      flushed: true,
    });
    expect(latest.get(ended.id)).toMatchObject({
      grouped: false,
      flushed: false,
    });
  });

  it("reports a group nothing has flushed yet as still waiting", async () => {
    const rule = await insertRule(harness().db, { slug: "checkout-latency" });
    const event = await journal({
      definitionId: rule.id,
      occurredAt: minutesAgo(2),
      processedAt: minutesAgo(2),
    });
    await group(event, { flushed: false });

    const latest = await loadLatestNotifications(TEST_ORG, [rule.id]);

    expect(latest.get(rule.id)).toMatchObject({
      grouped: true,
      flushed: false,
    });
  });

  it("asks the database nothing when it was given no rules", async () => {
    expect(await loadLatestNotifications(TEST_ORG, [])).toEqual(new Map());
    expect(await loadHeldCounts(TEST_ORG, [])).toEqual(new Map());
  });
});

describe("what a Silence is holding", () => {
  it("counts only the unprocessed rows a Silence names, for each rule", async () => {
    const held = await insertRule(harness().db, { slug: "held" });
    const other = await insertRule(harness().db, { slug: "other" });
    const silence = await insertSilence(harness().db);

    await journal({
      definitionId: held.id,
      occurredAt: minutesAgo(9),
      silenceId: silence.id,
    });
    await journal({
      definitionId: held.id,
      occurredAt: minutesAgo(8),
      silenceId: silence.id,
    });
    // Already let go of: a Hold that has been closed is not still holding.
    await journal({
      definitionId: held.id,
      occurredAt: minutesAgo(7),
      silenceId: silence.id,
      processedAt: minutesAgo(6),
    });
    // Unprocessed, but no Silence is sitting on it.
    await journal({ definitionId: held.id, occurredAt: minutesAgo(5) });
    await journal({
      definitionId: other.id,
      occurredAt: minutesAgo(4),
      silenceId: silence.id,
    });

    const counts = await loadHeldCounts(TEST_ORG, [held.id, other.id]);

    expect(counts.get(held.id)).toBe(2);
    expect(counts.get(other.id)).toBe(1);
  });
});

describe("the Default destination's tiers", () => {
  it("reports the tiers the Organization has channels for, once each", async () => {
    const channel = await insertChannel(harness().db, { name: "oncall" });
    const second = await insertChannel(harness().db, { name: "backup" });
    await insertDefaultChannels(harness().db, {
      tier: "critical",
      channelIds: [channel.id, second.id],
    });
    await insertDefaultChannels(harness().db, {
      tier: "warning",
      channelIds: [channel.id],
    });

    expect(await loadDefaultTiers(TEST_ORG)).toEqual(
      new Set(["critical", "warning"]),
    );
  });

  it("reports no tiers for an Organization with no Default destination", async () => {
    expect(await loadDefaultTiers(TEST_ORG)).toEqual(new Set());
  });
});
