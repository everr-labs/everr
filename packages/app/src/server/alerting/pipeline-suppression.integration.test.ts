// @vitest-environment node
import { eq } from "drizzle-orm";
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
import { ALERTING_DEFAULT_GROUP_WAIT_SECS } from "@/data/alerting/delivery/defaults";
import { ALERT_PROCESS_EVENT_TASK } from "@/data/alerting/delivery/tasks";
import {
  createSilence,
  expireSilence,
} from "@/data/alerting/silences/repository";
import type { AlertingSilenceInput } from "@/data/alerting/types";
import {
  alertDeliveries,
  alertEvents,
  alertInstances,
  alertSilences,
} from "@/db/schema";
import {
  insertDirectRule,
  insertPreview,
  insertSilence,
  TEST_ACTOR,
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

describe("the alerting pipeline's suppression", () => {
  it("a silence matching the instance's labels defers the notification, and the instance still reaches firing", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "slack" });
    await insertSilence(harness.db);
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();

    const [instance] = await harness.db.select().from(alertInstances);
    expect(instance.status).toBe("firing");
    expect(harness.fetchCalls()).toHaveLength(0);

    // The event still firing at defer time is retried rather than settled, so
    // the chain gets a hold, not a terminal: the notification may still go
    // out when the silence lapses.
    const outcomes = harness.clickhouse
      .historyRows()
      .filter(
        (row) =>
          row.event_type === "notification_deferred" ||
          row.event_type === "notification_suppressed",
      );
    expect(outcomes.map((row) => row.event_type)).toEqual([
      "notification_deferred",
    ]);
    expect(outcomes[0].silenced).toBe(true);

    // The Postgres journal row is the record of the defer decision: tied to
    // the matching silence, and left unprocessed so the retry job wakes it
    // later.
    const [firedEvent] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    expect(firedEvent.silenceId).not.toBeNull();
    expect(firedEvent.processedAt).toBeNull();
  });

  it("records the hold when the silence arrives between dispatch and flush", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "slack" });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs(); // fires and dispatches; the flush is not due yet

    // The second defer path: the group already exists and comes due, and the
    // flush is what finds the silence. It owes the same hold the dispatch
    // path writes, or a notification held this way reads as lost.
    const silence = await insertSilence(harness.db, {
      comment: "checkout migration window",
    });
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(0);
    const holds = harness.clickhouse
      .historyRows()
      .filter((row) => row.event_type === "notification_deferred");
    expect(holds).toHaveLength(1);
    // The hold reads without PostgreSQL, exactly as the terminal does.
    expect(holds[0]).toMatchObject({
      silenced: true,
      silence_id: silence.id,
      silence_comment: "checkout migration window",
      silence_matchers_json:
        '[{"label":"service","op":"eq","value":"checkout"}]',
    });
  });

  it("the notification goes out once the silence's window passes, no longer held", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "slack" });
    const silenceWindowMs = 120_000;
    await insertSilence(harness.db, {
      endsAt: new Date(Date.now() + silenceWindowMs),
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(0);
    // Proof the hold actually happened, not just that the group wait had not
    // elapsed yet: without it, this case would still pass with a silence
    // that does nothing at all.
    const [heldEvent] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    expect(heldEvent.silenceId).not.toBeNull();

    // The held event's own retry job wakes exactly at the silence's ends_at,
    // not on the rule's own evaluation interval.
    harness.advance(silenceWindowMs);
    await harness.fireAndFlush();

    expect(harness.fetchCalls()).toHaveLength(1);
    // The chain that was held now carries a delivery outcome: it escaped the
    // hold rather than being silently dropped once the window closed. The
    // hold stays on the chain, so a late notification explains its own
    // lateness.
    expect(
      harness.clickhouse
        .historyRows()
        .filter(
          (row) =>
            row.event_type === "notification_deferred" ||
            row.event_type === "notification_suppressed",
        )
        .map((row) => row.event_type),
    ).toEqual(["notification_deferred"]);
    expect(
      harness.clickhouse
        .historyRows()
        .some((row) => row.event_type === "delivery_succeeded"),
    ).toBe(true);
    const [firedEvent] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    expect(firedEvent.silenceId).toBeNull();
  });

  it("freezes the silence's comment and matchers onto the terminal it withheld", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "slack" });
    const silence = await insertSilence(harness.db, {
      comment: "checkout migration window",
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    // The instance stops firing while the silence still holds the fire, so
    // the resolve is the decision that will not be revisited: the chain ends
    // there, silenced.
    harness.clickhouse.setSignal([]);
    harness.advance(60_000); // the rule's evaluation interval
    await harness.fireAndFlush();

    const terminal = harness.clickhouse
      .historyRows()
      .find((row) => row.event_type === "notification_suppressed");
    expect(harness.fetchCalls()).toHaveLength(0);
    // "Why was I not paged" is answerable from this row alone. Retention
    // deletes the silence at 90 days, long before the history it explains.
    expect(terminal).toMatchObject({
      silenced: true,
      silence_id: silence.id,
      silence_comment: "checkout migration window",
      silence_matchers_json:
        '[{"label":"service","op":"eq","value":"checkout"}]',
    });
  });

  it("refuses a window that is not an instant in time", async () => {
    const scope = { organizationId: TEST_ORG, actor: TEST_ACTOR };
    const matchers = [
      { label: "service", op: "eq" as const, value: "checkout" },
    ];

    // `new Date("2026-08-18 09:00:00")` parses in the server's own timezone,
    // and the window check still passes, so an accepted value here would mute
    // hours nobody chose. The offset is invisible in the stored row.
    await expect(
      createSilence(scope, {
        matchers,
        starts_at: "2026-08-18 09:00:00",
        ends_at: "2026-08-18 11:00:00",
      } as unknown as AlertingSilenceInput),
    ).rejects.toThrow();

    const created = await createSilence(scope, {
      matchers,
      starts_at: "2026-08-18T09:00:00.000Z",
      ends_at: "2026-08-18T11:00:00.000Z",
    });
    expect(new Date(created.starts_at).toISOString()).toBe(
      "2026-08-18T09:00:00.000Z",
    );
  });

  it("holds one chain twice when a second silence takes over from the first", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "slack" });
    const windowMs = 120_000;
    const first = await insertSilence(harness.db, {
      comment: "first window",
      endsAt: new Date(Date.now() + windowMs),
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    // The event wakes at the first silence's end and finds a second one
    // covering it. That is a different hold, not the same one continuing, so
    // it earns its own row: the pair (event, silence) is what a hold is
    // keyed on.
    harness.advance(windowMs);
    const second = await insertSilence(harness.db, {
      comment: "second window",
    });
    await harness.fireAndFlush();

    expect(harness.fetchCalls()).toHaveLength(0);
    const holds = harness.clickhouse
      .historyRows()
      .filter((row) => row.event_type === "notification_deferred");
    expect(holds).toHaveLength(2);
    expect(holds.map((row) => row.silence_id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(holds.map((row) => row.silence_comment).sort()).toEqual([
      "first window",
      "second window",
    ]);
  });

  it("canceling the silence releases every held event in one statement", async () => {
    const ruleA = await insertDirectRule(harness.db, {
      slug: "held-a",
      forSecs: 0,
      channelType: "slack",
    });
    const ruleB = await insertDirectRule(harness.db, {
      slug: "held-b",
      forSecs: 0,
      channelType: "slack",
    });
    const silence = await insertSilence(harness.db, {
      matchers: [{ label: "severity", op: "eq", value: "warning" }],
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(0);

    const heldBefore = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.silenceId, silence.id));
    expect(heldBefore).toHaveLength(2);
    expect(heldBefore.every((row) => row.processedAt === null)).toBe(true);

    const { expired } = await expireSilence(
      { organizationId: TEST_ORG, actor: TEST_ACTOR },
      silence.id,
    );
    expect(expired).toBe(true);

    // The cancel's own transaction writes both release jobs in the same
    // set-based statement, so they are visible, due immediately, before any
    // job has run. Each held event's original retry (due at the silence's
    // untouched ends_at, an hour out by the fixture default) is still
    // pending too, under a different job key; filtering to what is due now
    // isolates the two release jobs the cancel itself wrote.
    const now = Date.now();
    const releaseJobs = (await harness.pendingJobs()).filter(
      (job) =>
        job.identifier === ALERT_PROCESS_EVENT_TASK &&
        job.runAt.getTime() <= now,
    );
    expect(releaseJobs).toHaveLength(2);

    await harness.fireAndFlush();

    // Two distinct rules, so two distinct notification groups: both notify.
    expect(harness.fetchCalls()).toHaveLength(2);
    expect(ruleA.id).not.toBe(ruleB.id);
  });

  it("releases nothing on a second cancel of the same silence", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "slack" });
    const silence = await insertSilence(harness.db);
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    const scope = { organizationId: TEST_ORG, actor: TEST_ACTOR };
    expect(await expireSilence(scope, silence.id)).toEqual({ expired: true });
    const releasedOnce = (await harness.pendingJobs()).length;

    // The cancel's release is guarded on the silence still being open, so a
    // repeated cancel (a double click, a retried job) cannot re-release a
    // chain that has already moved on.
    expect(await expireSilence(scope, silence.id)).toEqual({ expired: false });
    expect(await harness.pendingJobs()).toHaveLength(releasedOnce);
  });

  it("a preview rule never notifies, and its history row still carries rule_muted", async () => {
    const preview = await insertPreview(harness.db);
    await insertDirectRule(harness.db, {
      previewId: preview.id,
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.fireAndFlush();

    expect(harness.fetchCalls()).toHaveLength(0);
    expect(await harness.db.select().from(alertDeliveries)).toHaveLength(0);

    const fired = harness.clickhouse
      .historyRows()
      .find((row) => row.event_type === "instance_fired");
    expect(fired?.rule_muted).toBe(true);
  });

  it("a page severity outranks a preview: only the paging rule notifies", async () => {
    const preview = await insertPreview(harness.db);
    await insertDirectRule(harness.db, {
      slug: "preview-rule",
      previewId: preview.id,
      severity: "critical",
      forSecs: 0,
      channelType: "slack",
    });
    await insertDirectRule(harness.db, {
      slug: "paging-rule",
      severity: "critical",
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.fireAndFlush();

    // Both rules breach at the same severity; only the one that is not a
    // preview may ever notify.
    expect(harness.fetchCalls()).toHaveLength(1);
  });

  it("a canceled silence stores the stable principal separately from the display author", async () => {
    const actor = { kind: "user", id: "u_42", display: "Alice Smith" } as const;
    const created = await createSilence(
      { organizationId: TEST_ORG, actor },
      {
        matchers: [{ label: "service", op: "eq", value: "checkout" }],
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
    );

    await expireSilence(
      { organizationId: TEST_ORG, actor: TEST_ACTOR },
      created.id,
    );

    const [row] = await harness.db
      .select()
      .from(alertSilences)
      .where(eq(alertSilences.id, created.id));
    expect(row.canceledAt).not.toBeNull();
    expect(row.author).toBe("Alice Smith");
    expect(row.authorPrincipal).toBe("user:u_42");
  });

  it("a mutation records the server-derived actor, and a client-supplied actor field does not reach the stored row", async () => {
    const actor = { kind: "user", id: "u_7", display: "Real Name" } as const;
    // No `author` field exists on AlertingSilenceInput (see schema.ts); a
    // client that tries to smuggle one in anyway must still be ignored, not
    // merely refused by the type system.
    const maliciousInput = {
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 3_600_000).toISOString(),
      author: "Attacker Name",
    } as unknown as AlertingSilenceInput;

    const created = await createSilence(
      { organizationId: TEST_ORG, actor },
      maliciousInput,
    );

    expect(created.author).toBe("Real Name");
    const [row] = await harness.db
      .select()
      .from(alertSilences)
      .where(eq(alertSilences.id, created.id));
    expect(row.author).toBe("Real Name");
    expect(row.authorPrincipal).toBe("user:u_7");
  });

  it("a silence whose matchers select one of three instances defers exactly that one", async () => {
    await insertDirectRule(harness.db, {
      sql: "select 'checkout' as service, 42 as value union all select 'payments' as service, 42 as value union all select 'shipping' as service, 42 as value",
      forSecs: 0,
      channelType: "slack",
    });
    await insertSilence(harness.db, {
      matchers: [{ label: "service", op: "eq", value: "checkout" }],
    });
    harness.clickhouse.setSignal([
      { service: "checkout", value: 42 },
      { service: "payments", value: 42 },
      { service: "shipping", value: 42 },
    ]);

    await harness.fireAndFlush();

    expect(harness.fetchCalls()).toHaveLength(1);
    const body = JSON.stringify(harness.fetchCalls()[0].body);
    expect(body).toContain("payments");
    expect(body).toContain("shipping");
    expect(body).not.toContain("checkout");

    const firedEvents = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    const heldEvent = firedEvents.find(
      (row) => row.instanceLabels.service === "checkout",
    );
    expect(heldEvent?.processedAt).toBeNull();
    const deliveredEvents = firedEvents.filter(
      (row) => row.instanceLabels.service !== "checkout",
    );
    expect(deliveredEvents.every((row) => row.silenceId === null)).toBe(true);
  });
});
