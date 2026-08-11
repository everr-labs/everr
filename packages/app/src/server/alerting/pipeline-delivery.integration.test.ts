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
import { encryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import { sendChannelNotification } from "@/data/alerting/delivery/channel-sender.server";
import { CHANNEL_TEXT_MAX } from "@/data/alerting/delivery/channel-text-limits";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "@/data/alerting/delivery/config";
import { deleteChannel } from "@/data/alerting/delivery/repository";
import {
  ALERT_SEND_DELIVERY_TASK,
  IDLE_GROUP_FLUSH_AT,
} from "@/data/alerting/delivery/tasks";
import {
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/alerting/routing/defaults";
import { deleteRule, pauseRule } from "@/data/alerting/rules/repository";
import { SYSTEM_ACTOR } from "@/data/alerting/session";
import {
  alertChannels,
  alertDefinitionChannels,
  alertDeliveries,
  alertEvents,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import { flushAlertGroup } from "./delivery/flush-group";
import { processAlertEvent } from "./delivery/process-event";
import { sendAlertDelivery } from "./delivery/send-delivery";
import {
  asDbExecutor,
  insertChannel,
  insertDirectRule,
  insertReceiver,
  insertRoute,
  insertRule,
  type RuleFixture,
  TEST_ORG,
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

// Short enough that a second (or third) evaluation tick still lands inside
// the default 10s group wait, so several cases can drive two dispatches into
// one group without the flush job running in between.
const FAST_TICK_SECS = 3;

async function linkChannelToRule(
  db: AlertingHarness["db"],
  rule: RuleFixture,
  channelId: string,
): Promise<void> {
  await db.insert(alertDefinitionChannels).values({
    organizationId: rule.organizationId,
    alertDefinitionId: rule.id,
    channelId,
    position: 0,
  });
}

/**
 * A telegram channel with a caller-chosen bot token and chat id set.
 * `insertChannel` (fixtures.ts) always writes a single fixed chat id, which
 * cannot exercise fan-out or a caller-chosen token; this is the smallest
 * variant that can.
 */
async function insertTelegramChannel(
  db: AlertingHarness["db"],
  organizationId: string,
  opts: { chatIds: string[]; botToken?: string; name?: string },
) {
  const [created] = await db
    .insert(alertChannels)
    .values({
      organizationId,
      name: opts.name ?? "telegram-fanout",
      encryptedConfig: "",
    })
    .returning({ id: alertChannels.id });
  await db
    .update(alertChannels)
    .set({
      encryptedConfig: encryptChannelConfig(organizationId, created.id, {
        type: "telegram",
        bot_token: opts.botToken ?? "bot-token",
        chat_ids: opts.chatIds,
      } as never),
    })
    .where(eq(alertChannels.id, created.id));
  return created;
}

describe("the alerting pipeline's delivery", () => {
  it("holds three instances of one rule inside the group wait, then sends one message naming all three", async () => {
    await insertDirectRule(harness.db, {
      sql: "select 'svc-a' as service, 42 as value",
      forSecs: 0,
      intervalSecs: FAST_TICK_SECS,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "svc-a", value: 42 }]);
    await harness.runDueJobs();

    harness.clickhouse.setRows([
      { service: "svc-a", value: 42 },
      { service: "svc-b", value: 42 },
    ]);
    harness.advance(FAST_TICK_SECS * 1000);
    await harness.runDueJobs();

    harness.clickhouse.setRows([
      { service: "svc-a", value: 42 },
      { service: "svc-b", value: 42 },
      { service: "svc-c", value: 42 },
    ]);
    harness.advance(FAST_TICK_SECS * 1000);
    await harness.runDueJobs();
    // Still inside the 10s group wait (6s elapsed): nothing sent yet.
    expect(harness.fetchCalls()).toHaveLength(0);

    harness.advance(
      ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000 - 2 * FAST_TICK_SECS * 1000,
    );
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(1);
    const body = JSON.stringify(harness.fetchCalls()[0].body);
    expect(body).toContain("svc-a");
    expect(body).toContain("svc-b");
    expect(body).toContain("svc-c");
    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
  });

  it("makes a fourth instance wait the group interval after the first flush, not another group wait", async () => {
    await insertDirectRule(harness.db, {
      sql: "select 'svc-a' as service, 42 as value",
      forSecs: 0,
      intervalSecs: FAST_TICK_SECS,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "svc-a", value: 42 }]);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(1);

    harness.clickhouse.setRows([
      { service: "svc-a", value: 42 },
      { service: "svc-d", value: 42 },
    ]);
    harness.advance(FAST_TICK_SECS * 1000);
    await harness.runDueJobs(); // svc-d fires and dispatches into the already-flushed group

    // A group wait alone is not enough once the group has flushed once.
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(1);

    harness.advance(
      ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1000 -
        ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000 -
        FAST_TICK_SECS * 1000,
    );
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(2);
    const body = JSON.stringify(harness.fetchCalls()[1].body);
    expect(body).toContain("svc-d");
  });

  // Ticket 39 (todo/issues/alerting-surface/tickets/39-repeat-shorter-than-interval.md)
  // leaves open, on purpose, what a repeat interval below the group interval
  // should mean: "legitimate", "usually a mistake", and "always a mistake"
  // are all still live answers, and the dev route's own
  // `repeat_interval_secs: 60` against the 300s default group interval is
  // the example the ticket cites. This case does not take a side: it pins
  // what `nextGroupFlushState` (grouping.ts) actually does today, so that
  // whoever resolves ticket 39 changes this test deliberately instead of
  // discovering by accident that something depended on the current shape.
  it("today, a repeat interval shorter than the group interval does repeat faster (ticket 39, undecided)", async () => {
    const channel = await insertChannel(harness.db, { type: "slack" });
    const receiver = await insertReceiver(harness.db, {
      channelIds: [channel.id],
    });
    await insertRoute(harness.db, {
      receiver: receiver.name,
      repeatIntervalSecs: 60,
    });
    await insertRule(harness.db, { forSecs: 0 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(1);

    // The route's repeat interval (60s) is well short of the group interval
    // (ALERTING_DEFAULT_GROUP_INTERVAL_SECS, 300s by default). Nothing floors
    // the repeat against the group interval today, so the second
    // notification lands at the repeat interval, long before a group
    // interval's worth of time has passed.
    harness.advance(60_000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(2);
  });

  // Ticket 41 (todo/issues/alerting-surface/tickets/41-a-parked-group-wakes-again.md):
  // a group parked on the idle sentinel with `last_flushed_at` still null
  // keeps the sentinel forever, because `nextGroupFlushAt` (grouping.ts)
  // treats "lastFlushedAt is null" as "a first flush is already booked" and
  // does not tell that apart from "this group parked on the sentinel and
  // never flushed at all". See the fails-as-expected note at the bottom of
  // this case for how it is reached and what fails.
  it.fails("wakes a group parked on the idle sentinel when the next event reaches it, instead of keeping the sentinel forever", async () => {
    await insertDirectRule(harness.db, {
      sql: "select 'svc-a' as service, 42 as value",
      forSecs: 0,
      intervalSecs: FAST_TICK_SECS,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "svc-a", value: 42 }]);
    await harness.runDueJobs();

    const [group] = await harness.db.select().from(alertNotificationGroups);
    expect(group.lastFlushedAt).toBeNull();
    const membersBefore = await harness.db
      .select()
      .from(alertNotificationGroupEvents)
      .where(eq(alertNotificationGroupEvents.groupId, group.id));
    expect(membersBefore).toHaveLength(1);

    // The empty-claim park in `flushAlertGroup` only runs when every
    // member's journal row is gone by the time the flush runs, and ticket
    // 41 itself documents that nothing reachable through the exported
    // repository surface (pause, delete) produces that: pause and delete
    // both leave `alert_events` rows in place. This reaches for the
    // membership row directly to construct the state ticket 41 describes,
    // the same way its own analysis says it would have to happen.
    await harness.db
      .delete(alertNotificationGroupEvents)
      .where(eq(alertNotificationGroupEvents.groupId, group.id));

    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    const [parked] = await harness.db
      .select()
      .from(alertNotificationGroups)
      .where(eq(alertNotificationGroups.id, group.id));
    // Confirms the real `flushAlertGroup` empty-claim branch ran (not a
    // hand-built row): the sentinel is set and `lastFlushedAt` is still
    // null, exactly the state ticket 41 describes.
    expect(parked.nextFlushAt).toEqual(IDLE_GROUP_FLUSH_AT);
    expect(parked.lastFlushedAt).toBeNull();

    // A brand new instance under the same rule dispatches into the same
    // group (group_by is [rule, severity], unchanged by a new service
    // label): this is "the next event dispatched to it" ticket 41
    // describes.
    harness.clickhouse.setRows([
      { service: "svc-a", value: 42 },
      { service: "svc-b", value: 42 },
    ]);
    harness.advance(FAST_TICK_SECS * 1000);
    const dispatchTime = new Date();
    await harness.runDueJobs();

    const [woken] = await harness.db
      .select()
      .from(alertNotificationGroups)
      .where(eq(alertNotificationGroups.id, group.id));
    // Desired: a fresh group wait, the same answer a group that has never
    // been seen gets. Actual (the bug): `nextGroupFlushAt` returns the
    // sentinel unchanged, so this is off by roughly 7973 years.
    expect(woken.nextFlushAt.getTime()).toBe(
      dispatchTime.getTime() + ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000,
    );
  });

  it("stops a permanently failing delivery after one attempt, at the max attempts", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    harness.setFetchResponse({ status: 403 });

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.status).toBe("failed");
    expect(delivery.attempts).toBe(ALERT_DELIVERY_MAX_ATTEMPTS);
    const failedRows = harness.clickhouse
      .historyRows()
      .filter((row) => row.event_type === "delivery_failed");
    expect(failedRows).toHaveLength(1);
  });

  it("retries a transient failure with graphile's own backoff, and stops exactly at the max attempts", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    harness.setFetchResponse({ status: 503 });

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs(); // flush, then the first send attempt

    // graphile's own backoff (job-driver.ts) is exp(attempts) seconds, which
    // never exceeds exp(ALERT_DELIVERY_MAX_ATTEMPTS) here; this headroom
    // clears it regardless of which attempt we are on.
    const BACKOFF_HEADROOM_MS = 200_000;
    for (let attempt = 1; attempt < ALERT_DELIVERY_MAX_ATTEMPTS; attempt += 1) {
      harness.advance(BACKOFF_HEADROOM_MS);
      await harness.runDueJobs();
    }

    expect(harness.fetchCalls()).toHaveLength(ALERT_DELIVERY_MAX_ATTEMPTS);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.status).toBe("failed");
    expect(delivery.attempts).toBe(ALERT_DELIVERY_MAX_ATTEMPTS);
    expect(
      (await harness.failedJobs()).some(
        (job) => job.identifier === ALERT_SEND_DELIVERY_TASK,
      ),
    ).toBe(true);

    // The job itself is exhausted: waiting longer must not add a sixth call.
    harness.advance(BACKOFF_HEADROOM_MS);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(ALERT_DELIVERY_MAX_ATTEMPTS);
  });

  it("keeps retrying a telegram fan-out when one recipient is permanent and another is transient", async () => {
    const rule = await insertRule(harness.db, { forSecs: 0 });
    const channel = await insertTelegramChannel(
      harness.db,
      rule.organizationId,
      {
        chatIds: ["chat-a", "chat-b"],
      },
    );
    await linkChannelToRule(harness.db, rule, channel.id);
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    // chat-a always answers permanent (403), chat-b always answers transient
    // (503): fetch is called once per chat id, in chat_ids order, each round.
    let callIndex = 0;
    harness.setFetchResponse(() => {
      const outcome = callIndex % 2 === 0 ? { status: 403 } : { status: 503 };
      callIndex += 1;
      return outcome;
    });

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs(); // flush, then the first send attempt: one call per chat id

    expect(harness.fetchCalls()).toHaveLength(2);
    const [afterFirstRound] = await harness.db.select().from(alertDeliveries);
    expect(afterFirstRound.status).toBe("failed");
    expect(afterFirstRound.attempts).toBeLessThan(ALERT_DELIVERY_MAX_ATTEMPTS);
    // Still in flight: a verdict misclassified as permanent would have
    // jumped straight to the max attempts and left no retry behind.
    expect(
      (await harness.pendingJobs()).some(
        (job) => job.identifier === ALERT_SEND_DELIVERY_TASK,
      ),
    ).toBe(true);

    harness.advance(200_000);
    await harness.runDueJobs(); // second round: both chats tried again

    expect(harness.fetchCalls()).toHaveLength(4);
    const [afterSecondRound] = await harness.db.select().from(alertDeliveries);
    expect(afterSecondRound.attempts).toBe(2);
  });

  it("converges two runs of the same delivery on one history row", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "webhook" });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(1);
    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.status).toBe("sent");

    // A redelivered job (an at-least-once queue handing the same completed
    // send a second time) must not send again or duplicate the trail.
    await sendAlertDelivery({ dedupKey: delivery.dedupKey });

    expect(harness.fetchCalls()).toHaveLength(1);
    const succeededRows = harness.clickhouse
      .historyRows()
      .filter(
        (row) =>
          row.event_type === "delivery_succeeded" &&
          row.delivery_dedup_key === delivery.dedupKey,
      );
    expect(succeededRows).toHaveLength(1);
  });

  it("keeps a settled delivery's channel name after the channel is deleted", async () => {
    const rule = await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "webhook",
      channelName: "delete-me",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    const [sent] = await harness.db.select().from(alertDeliveries);
    expect(sent.status).toBe("sent");

    // The channel is still directly wired to the rule; deleteChannel refuses
    // that on its own (a live reference, not an in-flight delivery). Deleting
    // the rule first frees the reference without touching the delivery row,
    // which has no foreign key to the rule at all.
    await deleteRule(TEST_ORG, rule.id, asDbExecutor(harness.db));

    const { deleted } = await deleteChannel(
      { organizationId: TEST_ORG, actor: SYSTEM_ACTOR },
      "delete-me",
    );
    expect(deleted).toBe(true);

    const [afterDelete] = await harness.db.select().from(alertDeliveries);
    expect(afterDelete.channelId).toBeNull();
    expect(afterDelete.channelName).toBe("delete-me");
    expect(afterDelete.status).toBe("sent");
    expect(await harness.db.select().from(alertChannels)).toHaveLength(0);
  });

  it("records the channel's real type, not unknown, for a delivery withheld by a paused rule", async () => {
    const rule = await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs(); // fires and dispatches; the flush is not due yet
    const [group] = await harness.db.select().from(alertNotificationGroups);
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    // Calls the flush directly rather than draining the queue: the queue
    // would immediately cascade into the send job too, leaving no window to
    // pause the rule in between the flush's commit and the send's run.
    await flushAlertGroup({ groupId: group.id });

    const [delivery] = await harness.db.select().from(alertDeliveries);
    expect(delivery.status).toBe("pending");

    // Committed after the flush wrote the delivery, before the send ran.
    await pauseRule({ organizationId: TEST_ORG, actor: SYSTEM_ACTOR }, rule.id);

    await harness.runDueJobs(); // the send now finds no live rule behind it

    expect(harness.fetchCalls()).toHaveLength(0);
    const [withheld] = await harness.db.select().from(alertDeliveries);
    expect(withheld.status).toBe("failed");
    expect(withheld.attempts).toBe(ALERT_DELIVERY_MAX_ATTEMPTS);
    expect(withheld.lastError).toContain("paused");

    const failedRow = harness.clickhouse
      .historyRows()
      .find((row) => row.event_type === "delivery_failed");
    expect(
      Object.keys(failedRow?.delivery_targets as Record<string, unknown>),
    ).toEqual(["slack"]);
  });

  // PGlite is a single connection: the two dispatches below run strictly
  // sequentially, so the second's opening `SELECT ... FOR UPDATE` always
  // finds the first's already-committed group row and takes the ordinary
  // "existing group, add a member" branch (claimNotificationGroup's
  // `if (existing)` path). The `INSERT ... onConflictDoNothing()` plus retry
  // fallback that actually loses a race (process-event.ts:197-223) is never
  // reached and cannot be exercised under this harness. This case pins only
  // the serialized outcome: two dispatches under one rule converge on one
  // group id, not two.
  it("a second dispatch under the same rule joins the existing group instead of creating a second one", async () => {
    await insertDirectRule(harness.db, {
      sql: "select 'svc-a' as service, 42 as value",
      forSecs: 0,
      intervalSecs: FAST_TICK_SECS,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "svc-a", value: 42 }]);
    await harness.runDueJobs(); // the first dispatch: creates the group and its first membership

    const groupsAfterFirst = await harness.db
      .select()
      .from(alertNotificationGroups);
    expect(groupsAfterFirst).toHaveLength(1);

    harness.clickhouse.setRows([
      { service: "svc-a", value: 42 },
      { service: "svc-b", value: 42 },
    ]);
    harness.advance(FAST_TICK_SECS * 1000);
    // A second, distinct instance under the same rule: same groupKey, so it
    // must join the group above rather than create its own.
    await harness.runDueJobs();

    const groupsAfterSecond = await harness.db
      .select()
      .from(alertNotificationGroups);
    expect(groupsAfterSecond).toHaveLength(1);
    expect(groupsAfterSecond[0].id).toBe(groupsAfterFirst[0].id);

    const members = await harness.db
      .select()
      .from(alertNotificationGroupEvents)
      .where(eq(alertNotificationGroupEvents.groupId, groupsAfterSecond[0].id));
    expect(members).toHaveLength(2);
  });

  it("does nothing on a second dispatch of an already-stamped event", async () => {
    await insertDirectRule(harness.db, { forSecs: 0, channelType: "slack" });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    const [fired] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    expect(fired.processedAt).not.toBeNull();
    const membersBefore = await harness.db
      .select()
      .from(alertNotificationGroupEvents);
    expect(membersBefore).toHaveLength(1);

    // A redelivered dispatch job (the same at-least-once scenario as the
    // send task): the stamp guards it.
    await processAlertEvent({ eventId: fired.id });

    const [afterRedispatch] = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.id, fired.id));
    expect(afterRedispatch.processedAt).toEqual(fired.processedAt);
    expect(
      await harness.db.select().from(alertNotificationGroupEvents),
    ).toHaveLength(1);

    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(1);
  });

  it("leaves an instance that resolved between dispatch and flush out of the flushed message", async () => {
    await insertDirectRule(harness.db, {
      sql: "select 'svc-a' as service, 42 as value union all select 'svc-b' as service, 42 as value",
      forSecs: 0,
      resolveAfter: 1,
      intervalSecs: FAST_TICK_SECS,
      channelType: "slack",
    });
    harness.clickhouse.setRows([
      { service: "svc-a", value: 42 },
      { service: "svc-b", value: 42 },
    ]);
    await harness.runDueJobs();

    harness.clickhouse.setRows([{ service: "svc-b", value: 42 }]);
    harness.advance(FAST_TICK_SECS * 1000);
    await harness.runDueJobs(); // svc-a resolves and dispatches into the same group

    harness.advance(
      ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000 - FAST_TICK_SECS * 1000,
    );
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(1);
    const body = JSON.stringify(harness.fetchCalls()[0].body);
    expect(body).toContain("svc-b");
    expect(body).not.toContain("svc-a");

    // Proof the exclusion was deliberate, not a broken pipeline dropping
    // data: svc-a's chain still ends in a recorded terminal.
    const droppedRow = harness.clickhouse
      .historyRows()
      .find(
        (row) =>
          row.event_type === "notification_suppressed" &&
          (row.instance_labels as Record<string, string>).service === "svc-a",
      );
    expect(droppedRow).toBeDefined();
  });

  it("each provider truncates at its own limit, and the cut is visible in the request body", async () => {
    // formatNotification (flush-group.ts) already budgets a grouped message
    // against Discord's limit, the tightest of the three, before any provider
    // ever composes it. So a notification produced by the real flush can
    // never overflow Slack's or Telegram's larger limits; calling the
    // providers directly, the way the send job does once it has decrypted a
    // channel's config, is the only way to see each one's own belt cut.
    const notification = {
      title: "Everr alert: 1 firing",
      body: "x".repeat(10_000),
    };

    await sendChannelNotification(
      { type: "slack", url: "https://203.0.113.10/slack" },
      notification,
    );
    await sendChannelNotification(
      { type: "discord", url: "https://203.0.113.10/discord" },
      notification,
    );
    await sendChannelNotification(
      { type: "telegram", bot_token: "bot-token", chat_ids: ["1"] },
      notification,
    );

    const [slackCall, discordCall, telegramCall] = harness.fetchCalls();
    const slackBody = slackCall.body as {
      attachments: [{ blocks: [{ text: { text: string } }] }];
    };
    const slackText = slackBody.attachments[0].blocks[0].text.text;
    const discordText = (discordCall.body as { content: string }).content;
    const telegramText = (telegramCall.body as { text: string }).text;

    expect(slackText).toHaveLength(CHANNEL_TEXT_MAX.slack);
    expect(discordText).toHaveLength(CHANNEL_TEXT_MAX.discord);
    expect(telegramText).toHaveLength(CHANNEL_TEXT_MAX.telegram);
    expect(slackText.endsWith("…")).toBe(true);
    expect(discordText.endsWith("…")).toBe(true);
    expect(telegramText.endsWith("…")).toBe(true);
  });

  it("keeps webhook URLs and bot tokens out of the delivery's error trail", async () => {
    const leakedUrl =
      "https://203.0.113.10/webhook/T000/B000/SUPER-SECRET-PATH";
    const leakedToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
    const leakedChatId = "918273645";

    await insertDirectRule(harness.db, {
      slug: "webhook-rule",
      forSecs: 0,
      channelType: "webhook",
    });
    const telegramRule = await insertRule(harness.db, {
      slug: "telegram-rule",
      forSecs: 0,
    });
    const telegramChannel = await insertTelegramChannel(
      harness.db,
      telegramRule.organizationId,
      { chatIds: [leakedChatId], botToken: leakedToken },
    );
    await linkChannelToRule(harness.db, telegramRule, telegramChannel.id);

    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    // Both a webhook and a telegram provider can echo request details back in
    // an error body (the reason `sanitizeAlertError` exists at all); this
    // simulates that for each.
    harness.setFetchResponse((url) =>
      url.includes("telegram")
        ? { status: 403, body: `invalid bot token ${leakedToken} supplied` }
        : { status: 403, body: `forbidden, retry at ${leakedUrl}` },
    );

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries.length).toBeGreaterThan(0);
    for (const delivery of deliveries) {
      expect(delivery.lastError).not.toContain("https://");
      expect(delivery.lastError).not.toContain(leakedToken);
      // Telegram's own message never carries which chat failed in the first
      // place (channel-sender.server.ts / providers/telegram.ts); this
      // confirms that holds all the way to the stored row.
      expect(delivery.lastError).not.toContain(leakedChatId);
    }

    const failedRows = harness.clickhouse
      .historyRows()
      .filter((row) => row.event_type === "delivery_failed");
    expect(failedRows.length).toBeGreaterThan(0);
    for (const row of failedRows) {
      const error = row.error as string;
      expect(error).not.toContain("https://");
      expect(error).not.toContain(leakedToken);
      expect(error).not.toContain(leakedChatId);
    }
  });
});
