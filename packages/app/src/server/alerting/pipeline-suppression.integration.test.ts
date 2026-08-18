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
import { ALERT_PROCESS_EVENT_TASK } from "@/data/alerting/delivery/tasks";
import { SYSTEM_ACTOR } from "@/data/alerting/session";
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
    // ClickHouse gets no terminal row yet (deferSuppressedEvent only journals
    // a decision that will not be revisited). The Postgres journal row is the
    // record of the defer decision: tied to the matching silence,
    // and left unprocessed so the retry job wakes it later.
    const [firedEvent] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    expect(firedEvent.silenceId).not.toBeNull();
    expect(firedEvent.processedAt).toBeNull();
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
    // hold rather than being silently dropped once the window closed.
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
      { organizationId: TEST_ORG, actor: SYSTEM_ACTOR },
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

    const scope = { organizationId: TEST_ORG, actor: SYSTEM_ACTOR };
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
      { organizationId: TEST_ORG, actor: SYSTEM_ACTOR },
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
