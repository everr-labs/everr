// @vitest-environment node

import { and, eq } from "drizzle-orm";
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
import { ALERT_PROJECT_LIFECYCLE_TASK } from "@/data/alerting/history/tasks";
import {
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/alerting/routing/defaults";
import {
  deleteRule,
  pauseRule,
  updateRule,
} from "@/data/alerting/rules/repository";
import {
  ALERT_EVALUATE_TASK,
  alertingRetryDelaySeconds,
  nextAlertEvaluationAt,
} from "@/data/alerting/scheduling/evaluation-jobs.server";
import { SYSTEM_ACTOR } from "@/data/alerting/session";
import {
  alertChannels,
  alertDefinitions,
  alertDeliveries,
  alertEvents,
  alertInstances,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import { evaluateAlert } from "@/server/alerting/evaluation/rule";
import { scanDueAlerts } from "@/server/alerting/scheduling/scanner";
import { projectAlertLifecycle } from "./history/project-lifecycle";
import {
  asDbExecutor,
  insertDirectRule,
  insertInhibition,
  insertRule,
  insertSilence,
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

describe("the alerting pipeline's instance lifecycle", () => {
  it("fires on the first breach and delivers a notification carrying the evaluated data", async () => {
    await insertDirectRule(harness.db, {
      sql: "select 'checkout' as service, 42 as value",
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();

    const instances = await harness.db.select().from(alertInstances);
    expect(instances).toHaveLength(1);
    expect(instances[0].status).toBe("firing");

    const fired = harness.clickhouse
      .historyRows()
      .filter((row) => row.event_type === "instance_fired");
    expect(fired).toHaveLength(1);

    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();

    const deliveries = await harness.db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("sent");

    expect(harness.fetchCalls()).toHaveLength(1);
    // The evaluated row's own label value, carried into the delivered
    // notification body: proof the send carries what the rule saw, not a
    // generic placeholder.
    expect(JSON.stringify(harness.fetchCalls()[0].body)).toContain("checkout");
  });

  it("holds a breach in pending until `for` elapses, and never notifies while pending", async () => {
    await insertDirectRule(harness.db, { forSecs: 300, intervalSecs: 60 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    const [pending] = await harness.db.select().from(alertInstances);
    expect(pending.status).toBe("pending");
    expect(harness.fetchCalls()).toHaveLength(0);

    for (let tick = 0; tick < 5; tick += 1) {
      harness.advance(60_000);
      await harness.runDueJobs();
    }

    const [firing] = await harness.db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    // The fire schedules its notification group's flush 10s out (group
    // wait); the loop above lands exactly on the tick that fires, with no
    // room left in it for that wait to elapse.
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(1);
  });

  it("clears a breach after resolve_after absent ticks, and delivers a second notification", async () => {
    await insertDirectRule(harness.db, {
      forSecs: 0,
      resolveAfter: 2,
      intervalSecs: 60,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(1);

    harness.clickhouse.setRows([]);
    harness.advance(60_000);
    await harness.runDueJobs();

    const [stillFiring] = await harness.db.select().from(alertInstances);
    expect(stillFiring.status).toBe("firing");
    expect(stillFiring.absentCount).toBe(1);
    expect(harness.fetchCalls()).toHaveLength(1);

    harness.advance(60_000);
    await harness.runDueJobs();

    const [resolved] = await harness.db.select().from(alertInstances);
    expect(resolved.status).toBe("inactive");
    expect(
      harness.clickhouse
        .historyRows()
        .filter((row) => row.event_type === "instance_resolved"),
    ).toHaveLength(1);

    // The resolve dispatches into the same notification group the fire used.
    // Once a group has flushed once, a later dispatch to it waits a full
    // group interval, not just the group wait a brand-new group gets.
    harness.advance(ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1_000);
    await harness.runDueJobs();
    expect(harness.fetchCalls()).toHaveLength(2);
  });

  it("a flap opens a new episode, distinct from the one it closed", async () => {
    await insertRule(harness.db, {
      forSecs: 0,
      resolveAfter: 1,
      intervalSecs: 60,
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    harness.clickhouse.setRows([]);
    harness.advance(60_000);
    await harness.runDueJobs();

    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    harness.advance(60_000);
    await harness.runDueJobs();

    const lifecycleRows = harness.clickhouse
      .historyRows()
      .filter(
        (row) =>
          row.event_type === "instance_fired" ||
          row.event_type === "instance_resolved",
      );
    expect(lifecycleRows).toHaveLength(3);

    const episodeIds = [...new Set(lifecycleRows.map((row) => row.episode_id))];
    expect(episodeIds).toHaveLength(2);
    const [firstEpisodeId, secondEpisodeId] = episodeIds;

    const firstEpisodeRows = lifecycleRows.filter(
      (row) => row.episode_id === firstEpisodeId,
    );
    expect(firstEpisodeRows.map((row) => row.event_type)).toEqual([
      "instance_fired",
      "instance_resolved",
    ]);
    expect(
      firstEpisodeRows.some((row) => row.episode_id === secondEpisodeId),
    ).toBe(false);
  });

  it("an evaluation gap longer than the missed-evaluation tolerance restarts the for clock", async () => {
    await insertRule(harness.db, { forSecs: 300, intervalSecs: 60 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    const [firstTick] = await harness.db.select().from(alertInstances);
    expect(firstTick.status).toBe("pending");

    // Well past MISSED_EVALUATION_TOLERANCE (2) * intervalSecs (60s): the
    // engine cannot vouch for the breach holding continuously through a gap
    // this wide, so it must not credit the earlier pendingSince.
    harness.advance(10 * 60 * 1_000);
    const laterTick = new Date();
    await harness.runDueJobs();

    const [secondTick] = await harness.db.select().from(alertInstances);
    expect(secondTick.status).toBe("pending");
    expect(secondTick.pendingSince).toEqual(laterTick);
    expect(secondTick.pendingSince).not.toEqual(firstTick.pendingSince);
  });

  it("pausing the rule closes the open instance and the next evaluation job is a no-op", async () => {
    const rule = await insertRule(harness.db, { forSecs: 0, intervalSecs: 60 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    const [firing] = await harness.db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    await pauseRule({ organizationId: TEST_ORG, actor: SYSTEM_ACTOR }, rule.id);
    // Drains the lifecycle projection job the pause enqueued.
    await harness.runDueJobs();

    const instancesAfterPause = await harness.db.select().from(alertInstances);
    expect(instancesAfterPause).toHaveLength(1);
    expect(instancesAfterPause[0].status).toBe("inactive");

    const closedJournal = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_closed"));
    expect(closedJournal).toHaveLength(1);
    expect(closedJournal[0].reason).toBe("rule_paused");

    expect(
      harness.clickhouse
        .historyRows()
        .filter((row) => row.event_type === "instance_closed"),
    ).toHaveLength(1);

    // The rule's next evaluation job was already queued before the pause; it
    // must run as a no-op and must not reschedule itself.
    harness.advance(60_000);
    await harness.runDueJobs();
    expect(
      (await harness.pendingJobs()).filter(
        (job) => job.identifier === ALERT_EVALUATE_TASK,
      ),
    ).toHaveLength(0);
  });

  it("deleting the rule closes the open instance and leaves no orphaned instance rows", async () => {
    const rule = await insertRule(harness.db, { forSecs: 0, intervalSecs: 60 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    const [firing] = await harness.db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    const { deleted } = await deleteRule(
      TEST_ORG,
      rule.id,
      asDbExecutor(harness.db),
    );
    expect(deleted).toBe(true);
    // Drains the lifecycle projection job the delete enqueued.
    await harness.runDueJobs();

    const instancesAfterDelete = await harness.db
      .select()
      .from(alertInstances)
      .where(eq(alertInstances.alertDefinitionId, rule.id));
    expect(instancesAfterDelete).toHaveLength(0);

    const closedJournal = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_closed"));
    expect(closedJournal).toHaveLength(1);
    expect(closedJournal[0].reason).toBe("rule_deleted");

    expect(
      harness.clickhouse
        .historyRows()
        .filter((row) => row.event_type === "instance_closed"),
    ).toHaveLength(1);
  });

  it("a query failure degrades the rule's health once and pushes the retry further out each time", async () => {
    const rule = await insertRule(harness.db, { intervalSecs: 60 });
    harness.clickhouse.setFailure(
      new Error("Limit for result exceeded, max rows: 1000"),
    );

    await harness.runDueJobs();
    const [afterFirstFailure] = await harness.db
      .select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(afterFirstFailure.healthStatus).toBe("degraded");
    expect(afterFirstFailure.degradedSince).not.toBeNull();
    const firstBackoffSecs = alertingRetryDelaySeconds(60, 1, 60 * 16);
    const [firstRetryJob] = (await harness.pendingJobs()).filter(
      (job) => job.identifier === ALERT_EVALUATE_TASK,
    );
    expect(firstRetryJob.runAt.getTime() - Date.now()).toBe(
      firstBackoffSecs * 1_000,
    );

    harness.advance(firstBackoffSecs * 1_000);
    await harness.runDueJobs();
    const [afterSecondFailure] = await harness.db
      .select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(afterSecondFailure.healthStatus).toBe("degraded");
    // Set once: the second failure must not move it forward.
    expect(afterSecondFailure.degradedSince).toEqual(
      afterFirstFailure.degradedSince,
    );

    const secondBackoffSecs = alertingRetryDelaySeconds(60, 2, 60 * 16);
    expect(secondBackoffSecs).toBeGreaterThan(firstBackoffSecs);
    const [secondRetryJob] = (await harness.pendingJobs()).filter(
      (job) => job.identifier === ALERT_EVALUATE_TASK,
    );
    expect(secondRetryJob.runAt.getTime() - Date.now()).toBe(
      secondBackoffSecs * 1_000,
    );

    expect(
      harness.clickhouse
        .historyRows()
        .filter((row) => row.event_type === "evaluation_failed"),
    ).toHaveLength(2);
  });

  it("the scanner replaces rather than duplicates a due evaluation, and evaluating advances the schedule one interval", async () => {
    const rule = await insertRule(harness.db, { intervalSecs: 60, forSecs: 0 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    // insertRule already enqueued the first evaluation job at this same
    // scheduledFor; the scanner must not stack a second one on top of it.
    await scanDueAlerts();
    expect(
      (await harness.pendingJobs()).filter(
        (job) => job.identifier === ALERT_EVALUATE_TASK,
      ),
    ).toHaveLength(1);

    await harness.runDueJobs();

    const [def] = await harness.db
      .select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(def.nextEvaluationAt).toEqual(
      nextAlertEvaluationAt(TEST_ORG, rule.id, 60, new Date()),
    );
    expect(
      (await harness.pendingJobs()).filter(
        (job) => job.identifier === ALERT_EVALUATE_TASK,
      ),
    ).toHaveLength(1);
  });

  it("changing label_columns closes the instances whose fingerprints it destroys", async () => {
    const rule = await insertRule(harness.db, {
      sql: "select 'checkout' as service, 'us' as region, 42 as value",
      labelColumns: ["service"],
      forSecs: 0,
      intervalSecs: 60,
    });
    harness.clickhouse.setRows([
      { service: "checkout", region: "us", value: 42 },
    ]);
    await harness.runDueJobs();

    const [firing] = await harness.db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    await updateRule(
      TEST_ORG,
      rule.id,
      {
        sql: "select 'checkout' as service, 'us' as region, 42 as value",
        interval_secs: 60,
        for_secs: 0,
        label_columns: ["service", "region"],
        condition: { operator: "gt", threshold: 0 },
        severity: "warning",
        annotations: {},
        resolve_after: 1,
        notification_channels: [],
      },
      undefined,
      asDbExecutor(harness.db),
    );
    // Drains the lifecycle projection job the label change enqueued.
    await harness.runDueJobs();

    const instancesAfterChange = await harness.db
      .select()
      .from(alertInstances)
      .where(eq(alertInstances.alertDefinitionId, rule.id));
    expect(instancesAfterChange).toHaveLength(0);

    const closedJournal = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_closed"));
    expect(closedJournal).toHaveLength(1);
    expect(closedJournal[0].reason).toBe("labels_changed");

    const closedHistoryRow = harness.clickhouse
      .historyRows()
      .find((row) => row.event_type === "instance_closed");
    expect(closedHistoryRow?.reason).toBe("labels_changed");
  });

  it("a stale ruleVersion in the job payload is a no-op, and does not overwrite the newer state", async () => {
    const rule = await insertRule(harness.db, { forSecs: 0, intervalSecs: 60 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    const beforeInstances = await harness.db.select().from(alertInstances);
    const [beforeDef] = await harness.db
      .select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    const historyCountBefore = harness.clickhouse.historyRows().length;

    await evaluateAlert({
      alertDefinitionId: rule.id,
      scheduledFor: new Date().toISOString(),
      ruleVersion: beforeDef.version - 1,
    });

    const afterInstances = await harness.db.select().from(alertInstances);
    const [afterDef] = await harness.db
      .select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(afterInstances).toEqual(beforeInstances);
    expect(afterDef).toEqual(beforeDef);
    expect(harness.clickhouse.historyRows()).toHaveLength(historyCountBefore);
  });

  it("two history rows written by the same evaluation transaction share one journaled_at", async () => {
    await insertRule(harness.db, {
      sql: "select 'checkout' as service, 42 as value union all select 'payments' as service, 42 as value",
      forSecs: 0,
      intervalSecs: 60,
    });
    harness.clickhouse.setRows([
      { service: "checkout", value: 42 },
      { service: "payments", value: 42 },
    ]);

    await harness.runDueJobs();

    const fired = await harness.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    expect(fired).toHaveLength(2);
    expect(fired[0].journaledAt).toEqual(fired[1].journaledAt);
  });

  it("running the lifecycle projection twice over the same event leaves one history row", async () => {
    const rule = await insertRule(harness.db, { forSecs: 0, intervalSecs: 60 });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);
    await harness.runDueJobs();

    await pauseRule({ organizationId: TEST_ORG, actor: SYSTEM_ACTOR }, rule.id);

    const [projectionJob] = (await harness.pendingJobs()).filter(
      (job) => job.identifier === ALERT_PROJECT_LIFECYCLE_TASK,
    );
    expect(projectionJob).toBeDefined();

    await projectAlertLifecycle(projectionJob.payload);
    await projectAlertLifecycle(projectionJob.payload);

    expect(
      harness.clickhouse
        .historyRows()
        .filter((row) => row.event_type === "instance_closed"),
    ).toHaveLength(1);
  });
});

// A second organization, deliberately built to collide with TEST_ORG on
// everything but its own id: the same rule slug, the same instance labels,
// the same receiver and channel names. Only the organization id tells the
// two apart, so any lookup that forgets to filter by it has real, matching
// data on the other side ready to leak through.
const ORG_B = "org_test_b";

describe("the alerting pipeline's organization isolation", () => {
  it("evaluating org A's rule creates instances only for org A", async () => {
    // Same default slug and SQL in both organizations, unset on purpose:
    // insertRule's own defaults already collide across organizationId.
    const ruleA = await insertRule(harness.db, { forSecs: 0 });
    const ruleB = await insertRule(harness.db, {
      organizationId: ORG_B,
      forSecs: 0,
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();

    const instancesA = await harness.db
      .select()
      .from(alertInstances)
      .where(eq(alertInstances.organizationId, TEST_ORG));
    expect(instancesA).toHaveLength(1);
    expect(instancesA[0].alertDefinitionId).toBe(ruleA.id);

    const instancesB = await harness.db
      .select()
      .from(alertInstances)
      .where(eq(alertInstances.organizationId, ORG_B));
    expect(instancesB).toHaveLength(1);
    expect(instancesB[0].alertDefinitionId).toBe(ruleB.id);
  });

  it("a silence in org A does not defer org B's notification", async () => {
    const CHANNEL_NAME = "shared-channel";
    await insertDirectRule(harness.db, {
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    await insertDirectRule(harness.db, {
      organizationId: ORG_B,
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    // insertSilence's default matcher, service = checkout, is the label both
    // organizations' instances carry: the only thing standing between org B
    // and this silence is the organization scope on the lookup itself.
    await insertSilence(harness.db);
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();

    // Only org B notifies. Org A's identically-labeled instance stays held.
    expect(harness.fetchCalls()).toHaveLength(1);

    const deliveriesB = await harness.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, ORG_B));
    expect(deliveriesB).toHaveLength(1);
    expect(deliveriesB[0].status).toBe("sent");

    const deliveriesA = await harness.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, TEST_ORG));
    expect(deliveriesA).toHaveLength(0);

    // Proof the hold is real, not merely a group wait not yet elapsed: the
    // journal row for org A's own fired event still carries the defer.
    const [heldEventA] = await harness.db
      .select()
      .from(alertEvents)
      .where(
        and(
          eq(alertEvents.organizationId, TEST_ORG),
          eq(alertEvents.eventType, "instance_fired"),
        ),
      );
    expect(heldEventA.silenced).toBe(true);
    expect(heldEventA.processedAt).toBeNull();
  });

  it("org A's group holds only org A's members", async () => {
    const CHANNEL_NAME = "shared-channel";
    const ruleA = await insertDirectRule(harness.db, {
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    const ruleB = await insertDirectRule(harness.db, {
      organizationId: ORG_B,
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    // Dispatches both organizations' events into their own group; still
    // inside the group wait, so neither has flushed yet.
    await harness.runDueJobs();

    const [groupA] = await harness.db
      .select()
      .from(alertNotificationGroups)
      .where(eq(alertNotificationGroups.organizationId, TEST_ORG));
    expect(groupA).toBeDefined();

    // Reads the real membership rows, joined to the events they carry, rather
    // than trusting a count: proves which organization and which rule each
    // member actually belongs to.
    const membersA = await harness.db
      .select({
        eventOrg: alertEvents.organizationId,
        ruleId: alertEvents.sourceDefinitionId,
      })
      .from(alertNotificationGroupEvents)
      .innerJoin(
        alertEvents,
        eq(alertNotificationGroupEvents.eventId, alertEvents.id),
      )
      .where(eq(alertNotificationGroupEvents.groupId, groupA.id));

    expect(membersA).toHaveLength(1);
    expect(membersA[0].eventOrg).toBe(TEST_ORG);
    expect(membersA[0].ruleId).toBe(ruleA.id);
    expect(membersA.some((member) => member.ruleId === ruleB.id)).toBe(false);
  });

  it("listing deliveries for org A returns none of org B's", async () => {
    const CHANNEL_NAME = "shared-channel";
    await insertDirectRule(harness.db, {
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    await insertDirectRule(harness.db, {
      organizationId: ORG_B,
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();

    expect(harness.fetchCalls()).toHaveLength(2);

    const deliveriesA = await harness.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, TEST_ORG));
    expect(deliveriesA).toHaveLength(1);

    // The channel name alone cannot tell the two organizations' deliveries
    // apart, since both share it; the delivery's channel id must resolve to
    // org A's own channel row, not org B's row of the same name.
    const [channelA] = await harness.db
      .select()
      .from(alertChannels)
      .where(
        and(
          eq(alertChannels.organizationId, TEST_ORG),
          eq(alertChannels.name, CHANNEL_NAME),
        ),
      );
    const [channelB] = await harness.db
      .select()
      .from(alertChannels)
      .where(
        and(
          eq(alertChannels.organizationId, ORG_B),
          eq(alertChannels.name, CHANNEL_NAME),
        ),
      );
    expect(deliveriesA[0].channelId).toBe(channelA.id);
    expect(deliveriesA[0].channelId).not.toBe(channelB.id);
  });

  it("an inhibition in org A does not hold org B's target", async () => {
    const CHANNEL_NAME = "shared-channel";
    // No channel on the source rule: only that it counts as firing for the
    // inhibition context, the same way the single-organization suppression
    // case builds its source.
    await insertRule(harness.db, { slug: "inhibition-source", forSecs: 0 });
    const targetRuleA = await insertDirectRule(harness.db, {
      slug: "inhibition-target",
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    await insertRule(harness.db, {
      organizationId: ORG_B,
      slug: "inhibition-source",
      forSecs: 0,
    });
    await insertDirectRule(harness.db, {
      organizationId: ORG_B,
      slug: "inhibition-target",
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });

    // Matched on the shared "service" label, carried by both organizations'
    // instances, rather than a rule id: a rule id is unique per row on its
    // own and would never collide across organizations even if the lookup
    // forgot to scope by organization. This is the matcher shape that
    // actually exercises the scope.
    await insertInhibition(harness.db, {
      sourceMatchers: [{ label: "service", op: "eq", value: "checkout" }],
      targetMatchers: [{ label: "service", op: "eq", value: "checkout" }],
      equalLabels: [],
    });
    harness.clickhouse.setRows([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs();
    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness.runDueJobs();

    // Org A's target is held by its own inhibition; org B's target, with no
    // inhibition of its own, notifies normally.
    expect(harness.fetchCalls()).toHaveLength(1);

    const deliveriesB = await harness.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, ORG_B));
    expect(deliveriesB).toHaveLength(1);
    expect(deliveriesB[0].status).toBe("sent");

    const deliveriesA = await harness.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, TEST_ORG));
    expect(deliveriesA).toHaveLength(0);

    // Org A's own source event also matches this inhibition's target
    // matcher (it carries the same "service" label), so it is filtered out
    // here by its rule id: only the target rule's own event is the one this
    // case makes a claim about.
    const [heldTargetA] = await harness.db
      .select()
      .from(alertEvents)
      .where(
        and(
          eq(alertEvents.organizationId, TEST_ORG),
          eq(alertEvents.eventType, "instance_fired"),
          eq(alertEvents.sourceDefinitionId, targetRuleA.id),
        ),
      );
    expect(heldTargetA.inhibited).toBe(true);
    expect(heldTargetA.processedAt).toBeNull();
  });
});
