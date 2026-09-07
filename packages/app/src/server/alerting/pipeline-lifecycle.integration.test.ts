// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/alerting/delivery/defaults";
import { ALERT_PROJECT_LIFECYCLE_TASK } from "@/data/alerting/history/tasks";
import {
  deleteRule,
  pauseRule,
  resumeRule,
  updateRule,
} from "@/data/alerting/rules/repository";
import {
  ALERT_EVALUATE_TASK,
  alertingRetryDelaySeconds,
  nextAlertEvaluationAt,
} from "@/data/alerting/scheduling/evaluation-jobs.server";
import {
  alertDefinitions,
  alertDeliveries,
  alertEvents,
  alertInstances,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import {
  ALERT_RETRY_MAX_INTERVAL_FACTOR,
  evaluateAlert,
} from "@/server/alerting/evaluation/rule";
import { scanDueAlerts } from "@/server/alerting/scheduling/scanner";
import { projectAlertLifecycle } from "./history/project-lifecycle";
import {
  asDbExecutor,
  insertChannel,
  insertDefaultChannels,
  insertDirectRule,
  insertRule,
  insertSilence,
  TEST_ACTOR,
  TEST_ORG,
} from "./testing/fixtures";
import { useAlertingHarness } from "./testing/harness";

vi.mock("@/db/client", async () => {
  const { testDb, runInTransaction } = await import("./testing/db-proxy");
  return { db: testDb, runInTransaction };
});

vi.mock("@/lib/clickhouse", async () => import("./testing/test-clickhouse"));

const harness = useAlertingHarness();

describe("the alerting pipeline's instance lifecycle", () => {
  it("fires on the first breach and delivers a notification carrying the evaluated data", async () => {
    await insertDirectRule(harness().db, {
      sql: "select 'checkout' as service, 42 as value",
      forSecs: 0,
      channelType: "slack",
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().runDueJobs();

    const instances = await harness().db.select().from(alertInstances);
    expect(instances).toHaveLength(1);
    expect(instances[0].status).toBe("firing");

    const fired = harness()
      .clickhouse.historyRows()
      .filter((row) => row.event_type === "instance_fired");
    expect(fired).toHaveLength(1);

    harness().advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness().runDueJobs();

    const deliveries = await harness().db.select().from(alertDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("sent");

    expect(harness().fetchCalls()).toHaveLength(1);
    // The evaluated row's own label value, carried into the delivered
    // notification body: proof the send carries what the rule saw, not a
    // generic placeholder.
    expect(JSON.stringify(harness().fetchCalls()[0].body)).toContain(
      "checkout",
    );
  });

  it("holds a breach in pending until `for` elapses, and never notifies while pending", async () => {
    await insertDirectRule(harness().db, { forSecs: 300, intervalSecs: 60 });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().runDueJobs();
    const [pending] = await harness().db.select().from(alertInstances);
    expect(pending.status).toBe("pending");
    expect(harness().fetchCalls()).toHaveLength(0);

    for (let tick = 0; tick < 5; tick += 1) {
      harness().advance(60_000);
      await harness().runDueJobs();
    }

    const [firing] = await harness().db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    // The fire schedules its notification group's flush 10s out (group
    // wait); the loop above lands exactly on the tick that fires, with no
    // room left in it for that wait to elapse.
    harness().advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1_000);
    await harness().runDueJobs();
    expect(harness().fetchCalls()).toHaveLength(1);
  });

  it("clears a breach after resolve_after absent ticks, and delivers a second notification", async () => {
    await insertDirectRule(harness().db, {
      forSecs: 0,
      resolveAfter: 2,
      intervalSecs: 60,
      channelType: "slack",
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().fireAndFlush();
    expect(harness().fetchCalls()).toHaveLength(1);

    harness().clickhouse.setSignal([]);
    harness().advance(60_000);
    await harness().runDueJobs();

    const [stillFiring] = await harness().db.select().from(alertInstances);
    expect(stillFiring.status).toBe("firing");
    expect(stillFiring.absentCount).toBe(1);
    expect(harness().fetchCalls()).toHaveLength(1);

    harness().advance(60_000);
    await harness().runDueJobs();

    const [resolved] = await harness().db.select().from(alertInstances);
    expect(resolved.status).toBe("inactive");
    expect(
      harness()
        .clickhouse.historyRows()
        .filter((row) => row.event_type === "instance_resolved"),
    ).toHaveLength(1);

    // The resolve dispatches into the same notification group the fire used.
    // Once a group has flushed once, a later dispatch to it waits a full
    // group interval, not just the group wait a brand-new group gets.
    harness().advance(ALERTING_DEFAULT_GROUP_INTERVAL_SECS * 1_000);
    await harness().runDueJobs();
    expect(harness().fetchCalls()).toHaveLength(2);
  });

  it("tracks a still-breaching instance's new value without journaling a second event", async () => {
    await insertRule(harness().db, { forSecs: 0, intervalSecs: 60 });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().runDueJobs();

    const [fired] = await harness().db.select().from(alertInstances);
    expect(fired.status).toBe("firing");
    expect(fired.value).toBe(42);

    harness().clickhouse.setSignal([{ service: "checkout", value: 43 }]);
    harness().advance(60_000);
    await harness().runDueJobs();

    const [held] = await harness().db.select().from(alertInstances);
    expect(held.value).toBe(43);
    // A hold is not a new breach: same episode, and the journal still holds
    // the one fire. A second event here would page whoever the first one
    // already reached, on every evaluation for as long as the breach lasts.
    expect(held.status).toBe("firing");
    expect(held.episodeId).toBe(fired.episodeId);
    expect(await harness().db.select().from(alertEvents)).toHaveLength(1);
  });

  it("a flap opens a new episode, distinct from the one it closed", async () => {
    await insertRule(harness().db, {
      forSecs: 0,
      resolveAfter: 1,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().runDueJobs();

    harness().clickhouse.setSignal([]);
    harness().advance(60_000);
    await harness().runDueJobs();

    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    harness().advance(60_000);
    await harness().runDueJobs();

    const lifecycleRows = harness()
      .clickhouse.historyRows()
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
    await insertRule(harness().db, { forSecs: 300, intervalSecs: 60 });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().runDueJobs();
    const [firstTick] = await harness().db.select().from(alertInstances);
    expect(firstTick.status).toBe("pending");

    // Well past MISSED_EVALUATION_TOLERANCE (2) * intervalSecs (60s): the
    // engine cannot vouch for the breach holding continuously through a gap
    // this wide, so it must not credit the earlier pendingSince.
    harness().advance(10 * 60 * 1_000);
    const laterTick = new Date();
    await harness().runDueJobs();

    const [secondTick] = await harness().db.select().from(alertInstances);
    expect(secondTick.status).toBe("pending");
    expect(secondTick.pendingSince).toEqual(laterTick);
    expect(secondTick.pendingSince).not.toEqual(firstTick.pendingSince);
  });

  it("pausing the rule closes the open instance and the next evaluation job is a no-op", async () => {
    const rule = await insertRule(harness().db, {
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().runDueJobs();

    const [firing] = await harness().db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    await pauseRule({ organizationId: TEST_ORG, actor: TEST_ACTOR }, rule.id);
    // Drains the lifecycle projection job the pause enqueued.
    await harness().runDueJobs();

    const instancesAfterPause = await harness()
      .db.select()
      .from(alertInstances);
    expect(instancesAfterPause).toHaveLength(1);
    expect(instancesAfterPause[0].status).toBe("inactive");

    const closedJournal = await harness()
      .db.select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_closed"));
    expect(closedJournal).toHaveLength(1);
    expect(closedJournal[0].reason).toBe("rule_paused");

    expect(
      harness()
        .clickhouse.historyRows()
        .filter((row) => row.event_type === "instance_closed"),
    ).toHaveLength(1);

    // The rule's next evaluation job was already queued before the pause; it
    // must run as a no-op and must not reschedule itself.
    harness().advance(60_000);
    await harness().runDueJobs();
    expect(
      (await harness().pendingJobs()).filter(
        (job) => job.identifier === ALERT_EVALUATE_TASK,
      ),
    ).toHaveLength(0);
  });

  it("resuming the rule schedules it again and it fires from scratch", async () => {
    const rule = await insertRule(harness().db, {
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().runDueJobs();
    await pauseRule({ organizationId: TEST_ORG, actor: TEST_ACTOR }, rule.id);
    await harness().runDueJobs();

    await resumeRule({ organizationId: TEST_ORG, actor: TEST_ACTOR }, rule.id);

    // Pause cancels the rule's place in the queue, so resume has to put it
    // back. Flipping `active` alone would leave a rule that reads as running
    // and never evaluates again, which is the failure a reader cannot see.
    const [resumed] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(resumed.active).toBe(true);
    expect(resumed.nextEvaluationAt).not.toBeNull();
    expect(
      (await harness().pendingJobs()).filter(
        (job) => job.identifier === ALERT_EVALUATE_TASK,
      ),
    ).toHaveLength(1);

    // Pause reset the instance, so the breach that never went away is a new
    // fire rather than a continuation: a resumed rule that stayed silent
    // because its instance still read as firing would page nobody. Resume
    // schedules one interval out, so the clock has to reach that before the
    // job it enqueued is due.
    harness().advance(60_000);
    await harness().runDueJobs();
    const [instance] = await harness().db.select().from(alertInstances);
    expect(instance.status).toBe("firing");
  });

  it("deleting the rule closes the open instance and leaves no orphaned instance rows", async () => {
    const rule = await insertRule(harness().db, {
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().runDueJobs();

    const [firing] = await harness().db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    const { deleted } = await deleteRule(
      TEST_ORG,
      rule.id,
      asDbExecutor(harness().db),
    );
    expect(deleted).toBe(true);
    // Drains the lifecycle projection job the delete enqueued.
    await harness().runDueJobs();

    const instancesAfterDelete = await harness()
      .db.select()
      .from(alertInstances)
      .where(eq(alertInstances.alertDefinitionId, rule.id));
    expect(instancesAfterDelete).toHaveLength(0);

    const closedJournal = await harness()
      .db.select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_closed"));
    expect(closedJournal).toHaveLength(1);
    expect(closedJournal[0].reason).toBe("rule_deleted");

    expect(
      harness()
        .clickhouse.historyRows()
        .filter((row) => row.event_type === "instance_closed"),
    ).toHaveLength(1);
  });

  it("a query failure degrades the rule's health once and pushes the retry further out each time", async () => {
    // A rule whose SQL the engine itself refuses, rather than an error handed
    // to a stub: ClickHouse raises this, with its own code and message, on
    // the same path a real bad rule would take.
    const rule = await insertRule(harness().db, {
      intervalSecs: 60,
      sql: "SELECT throwIf(1, 'Limit for result exceeded, max rows: 1000')",
    });

    await harness().runDueJobs();
    const [afterFirstFailure] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(afterFirstFailure.degradedSince).not.toBeNull();
    const firstBackoffSecs = alertingRetryDelaySeconds(
      60,
      1,
      60 * ALERT_RETRY_MAX_INTERVAL_FACTOR,
    );
    const [firstRetryJob] = (await harness().pendingJobs()).filter(
      (job) => job.identifier === ALERT_EVALUATE_TASK,
    );
    expect(firstRetryJob.runAt.getTime() - Date.now()).toBe(
      firstBackoffSecs * 1_000,
    );

    harness().advance(firstBackoffSecs * 1_000);
    await harness().runDueJobs();
    const [afterSecondFailure] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    // Set once: the second failure must not move it forward.
    expect(afterSecondFailure.degradedSince).toEqual(
      afterFirstFailure.degradedSince,
    );

    const secondBackoffSecs = alertingRetryDelaySeconds(
      60,
      2,
      60 * ALERT_RETRY_MAX_INTERVAL_FACTOR,
    );
    expect(secondBackoffSecs).toBeGreaterThan(firstBackoffSecs);
    const [secondRetryJob] = (await harness().pendingJobs()).filter(
      (job) => job.identifier === ALERT_EVALUATE_TASK,
    );
    expect(secondRetryJob.runAt.getTime() - Date.now()).toBe(
      secondBackoffSecs * 1_000,
    );

    expect(
      harness()
        .clickhouse.historyRows()
        .filter((row) => row.event_type === "evaluation_failed"),
    ).toHaveLength(2);
  });

  it("keeps a URL out of both copies of an evaluation error", async () => {
    const rule = await insertRule(harness().db, {
      intervalSecs: 60,
      sql: "SELECT throwIf(1, 'refused by https://hooks.slack.com/services/T0/B0/secret')",
    });

    await harness().runDueJobs();

    const [failed] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    const [historyRow] = harness()
      .clickhouse.historyRows()
      .filter((row) => row.event_type === "evaluation_failed");

    for (const stored of [failed.lastError, historyRow.error]) {
      expect(stored).toContain("[redacted-url]");
      expect(stored).not.toContain("hooks.slack.com");
    }
  });

  it("pausing a degraded rule hands it back healthy on resume", async () => {
    const rule = await insertRule(harness().db, {
      intervalSecs: 60,
      sql: "SELECT throwIf(1, 'the rule is broken')",
    });

    await harness().runDueJobs();
    const [degraded] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(degraded.degradedSince).not.toBeNull();
    expect(degraded.consecutiveFailures).toBeGreaterThan(0);

    await pauseRule({ organizationId: TEST_ORG, actor: TEST_ACTOR }, rule.id);

    // A stale degraded status would survive the pause and greet the resume
    // near the retry-backoff ceiling, so a rule fixed while paused would sit
    // out its first interval before anyone saw it evaluate again.
    const [paused] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(paused.consecutiveFailures).toBe(0);
    expect(paused.degradedSince).toBeNull();
  });

  it("the scanner replaces rather than duplicates a due evaluation, and evaluating advances the schedule one interval", async () => {
    const rule = await insertRule(harness().db, {
      intervalSecs: 60,
      forSecs: 0,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    // insertRule already enqueued the first evaluation job at this same
    // scheduledFor; the scanner must not stack a second one on top of it.
    await scanDueAlerts();
    expect(
      (await harness().pendingJobs()).filter(
        (job) => job.identifier === ALERT_EVALUATE_TASK,
      ),
    ).toHaveLength(1);

    await harness().runDueJobs();

    const [def] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(def.nextEvaluationAt).toEqual(
      nextAlertEvaluationAt(TEST_ORG, rule.id, 60, new Date()),
    );
    expect(
      (await harness().pendingJobs()).filter(
        (job) => job.identifier === ALERT_EVALUATE_TASK,
      ),
    ).toHaveLength(1);
  });

  it("changing label_columns closes the instances whose fingerprints it destroys", async () => {
    const rule = await insertRule(harness().db, {
      sql: "select 'checkout' as service, 'us' as region, 42 as value",
      labelColumns: ["service"],
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([
      { service: "checkout", region: "us", value: 42 },
    ]);
    await harness().runDueJobs();

    const [firing] = await harness().db.select().from(alertInstances);
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
      },
      undefined,
      asDbExecutor(harness().db),
    );
    // Drains the lifecycle projection job the label change enqueued.
    await harness().runDueJobs();

    const instancesAfterChange = await harness()
      .db.select()
      .from(alertInstances)
      .where(eq(alertInstances.alertDefinitionId, rule.id));
    expect(instancesAfterChange).toHaveLength(0);

    const closedJournal = await harness()
      .db.select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_closed"));
    expect(closedJournal).toHaveLength(1);
    expect(closedJournal[0].reason).toBe("labels_changed");

    const closedHistoryRow = harness()
      .clickhouse.historyRows()
      .find((row) => row.event_type === "instance_closed");
    expect(closedHistoryRow?.reason).toBe("labels_changed");
  });

  it("keeps the instances when a label_columns change only reorders them", async () => {
    const sql = "select 'checkout' as service, 'us' as region, 42 as value";
    const rule = await insertRule(harness().db, {
      sql,
      labelColumns: ["service", "region"],
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([
      { service: "checkout", region: "us", value: 42 },
    ]);
    await harness().runDueJobs();

    const [firing] = await harness().db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    // The fingerprint is built from the label set, which reordering does not
    // change. Comparing the two lists positionally would destroy every open
    // instance of the rule for an edit that changed nothing.
    await updateRule(
      TEST_ORG,
      rule.id,
      {
        sql,
        interval_secs: 60,
        for_secs: 0,
        label_columns: ["region", "service"],
        condition: { operator: "gt", threshold: 0 },
        severity: "warning",
        annotations: {},
        resolve_after: 1,
      },
      undefined,
      asDbExecutor(harness().db),
    );
    await harness().runDueJobs();

    const [survivor] = await harness().db.select().from(alertInstances);
    expect(survivor.id).toBe(firing.id);
    expect(survivor.status).toBe("firing");
    expect(
      await harness()
        .db.select()
        .from(alertEvents)
        .where(eq(alertEvents.eventType, "instance_closed")),
    ).toHaveLength(0);
  });

  it("writes nothing for a second evaluation of a scheduledFor it already recorded", async () => {
    const rule = await insertRule(harness().db, {
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    const [definition] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    const scheduledFor = new Date().toISOString();
    const evaluation = {
      alertDefinitionId: rule.id,
      scheduledFor,
      ruleVersion: definition.version,
    };

    await evaluateAlert(evaluation);
    const [firing] = await harness().db.select().from(alertInstances);
    expect(firing.status).toBe("firing");

    // The condition clears, so a second evaluation that really ran would
    // resolve the instance. The alert_evaluations row the first one already
    // committed for this scheduledFor is what stops it: a redelivered job
    // must not replay a decision the engine has taken once.
    harness().clickhouse.setSignal([]);
    await evaluateAlert(evaluation);

    const [unchanged] = await harness().db.select().from(alertInstances);
    expect(unchanged).toEqual(firing);
    expect(await harness().db.select().from(alertEvents)).toHaveLength(1);
  });

  it("a stale ruleVersion in the job payload is a no-op, and does not overwrite the newer state", async () => {
    const rule = await insertRule(harness().db, {
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().runDueJobs();

    const beforeInstances = await harness().db.select().from(alertInstances);
    const [beforeDef] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    const historyCountBefore = harness().clickhouse.historyRows().length;

    await evaluateAlert({
      alertDefinitionId: rule.id,
      scheduledFor: new Date().toISOString(),
      ruleVersion: beforeDef.version - 1,
    });

    const afterInstances = await harness().db.select().from(alertInstances);
    const [afterDef] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    expect(afterInstances).toEqual(beforeInstances);
    expect(afterDef).toEqual(beforeDef);
    expect(harness().clickhouse.historyRows()).toHaveLength(historyCountBefore);
  });

  it("running the lifecycle projection twice over the same event leaves one history row", async () => {
    const rule = await insertRule(harness().db, {
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness().runDueJobs();

    await pauseRule({ organizationId: TEST_ORG, actor: TEST_ACTOR }, rule.id);

    const [projectionJob] = (await harness().pendingJobs()).filter(
      (job) => job.identifier === ALERT_PROJECT_LIFECYCLE_TASK,
    );
    expect(projectionJob).toBeDefined();

    await projectAlertLifecycle(projectionJob.payload);
    await projectAlertLifecycle(projectionJob.payload);

    expect(
      harness()
        .clickhouse.historyRows()
        .filter((row) => row.event_type === "instance_closed"),
    ).toHaveLength(1);
  });

  it("projects a closure for the instance and a suppression for the notification the pause canceled", async () => {
    const rule = await insertRule(harness().db, {
      forSecs: 0,
      intervalSecs: 60,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    // The evaluation alone, rather than a drain: it journals the fire and
    // enqueues its processing, and stopping there leaves the unprocessed
    // notifying event a pause has to cancel. A drain would dispatch it first.
    const [definition] = await harness()
      .db.select()
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, rule.id));
    await evaluateAlert({
      alertDefinitionId: rule.id,
      scheduledFor: new Date().toISOString(),
      ruleVersion: definition.version,
    });
    const [fire] = await harness()
      .db.select()
      .from(alertEvents)
      .where(eq(alertEvents.eventType, "instance_fired"));
    expect(fire.processedAt).toBeNull();

    await pauseRule({ organizationId: TEST_ORG, actor: TEST_ACTOR }, rule.id);
    await harness().runDueJobs();

    const rows = harness().clickhouse.historyRows();
    expect(
      rows.find((row) => row.event_type === "instance_closed")?.reason,
    ).toBe("rule_paused");
    // The canceled notification gets its own row, naming the fire it ends, so
    // the chain reads as withheld rather than stopping mid-sentence.
    const suppressed = rows.find(
      (row) => row.event_type === "notification_suppressed",
    );
    expect(suppressed?.reason).toBe("rule_paused");
    expect(suppressed?.notification_event_id).toBe(fire.id);
  });
});

// A second organization, deliberately built to collide with TEST_ORG on
// everything but its own id: the same rule slug, the same instance labels,
// the same channel names, the same default-destination tier. Only the
// organization id tells the two apart, so any lookup that forgets to filter
// by it has real, matching data on the other side ready to leak through.
const ORG_B = "org_test_b";

/**
 * Two organizations, each with its own default destination behind a channel
 * sharing the same name, and a rule breaching on the same default label.
 *
 * The default-destination lookup (delivery/targeting.ts and the flush's own
 * channel resolution) scopes by organization without also narrowing by some
 * other already-unique id (a rule id, a channel id), so it is the filter a
 * shared-name setup exercises: if it were ever missing, org A's event would
 * see org B's destination rows too and the fan-out would cross the tenant
 * line.
 */
async function insertTwinDefaultRules() {
  const CHANNEL_NAME = "shared-channel";

  const channelA = await insertChannel(harness().db, {
    type: "webhook",
    name: CHANNEL_NAME,
  });
  await insertDefaultChannels(harness().db, { channelIds: [channelA.id] });
  const ruleA = await insertRule(harness().db, { forSecs: 0 });

  const channelB = await insertChannel(harness().db, {
    organizationId: ORG_B,
    type: "webhook",
    name: CHANNEL_NAME,
  });
  await insertDefaultChannels(harness().db, {
    organizationId: ORG_B,
    channelIds: [channelB.id],
  });
  const ruleB = await insertRule(harness().db, {
    organizationId: ORG_B,
    forSecs: 0,
  });

  return { ruleA, ruleB, channelA, channelB };
}

describe("the alerting pipeline's organization isolation", () => {
  it("evaluating org A's rule creates instances only for org A", async () => {
    // Same default slug and SQL in both organizations, unset on purpose:
    // insertRule's own defaults already collide across organizationId.
    const ruleA = await insertRule(harness().db, { forSecs: 0 });
    const ruleB = await insertRule(harness().db, {
      organizationId: ORG_B,
      forSecs: 0,
    });
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().runDueJobs();

    const instancesA = await harness()
      .db.select()
      .from(alertInstances)
      .where(eq(alertInstances.organizationId, TEST_ORG));
    expect(instancesA).toHaveLength(1);
    expect(instancesA[0].alertDefinitionId).toBe(ruleA.id);

    const instancesB = await harness()
      .db.select()
      .from(alertInstances)
      .where(eq(alertInstances.organizationId, ORG_B));
    expect(instancesB).toHaveLength(1);
    expect(instancesB[0].alertDefinitionId).toBe(ruleB.id);
  });

  it("a silence in org A does not defer org B's notification", async () => {
    const CHANNEL_NAME = "shared-channel";
    await insertDirectRule(harness().db, {
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    await insertDirectRule(harness().db, {
      organizationId: ORG_B,
      channelName: CHANNEL_NAME,
      forSecs: 0,
      channelType: "slack",
    });
    // insertSilence's default matcher, service = checkout, is the label both
    // organizations' instances carry: the only thing standing between org B
    // and this silence is the organization scope on the lookup itself.
    await insertSilence(harness().db);
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().fireAndFlush();

    // Only org B notifies. Org A's identically-labeled instance stays held.
    expect(harness().fetchCalls()).toHaveLength(1);

    const deliveriesB = await harness()
      .db.select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, ORG_B));
    expect(deliveriesB).toHaveLength(1);
    expect(deliveriesB[0].status).toBe("sent");

    const deliveriesA = await harness()
      .db.select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, TEST_ORG));
    expect(deliveriesA).toHaveLength(0);

    // Proof the hold is real, not merely a group wait not yet elapsed: the
    // journal row for org A's own fired event still carries the defer.
    const [heldEventA] = await harness()
      .db.select()
      .from(alertEvents)
      .where(
        and(
          eq(alertEvents.organizationId, TEST_ORG),
          eq(alertEvents.eventType, "instance_fired"),
        ),
      );
    expect(heldEventA.silenceId).not.toBeNull();
    expect(heldEventA.processedAt).toBeNull();
  });

  it("org A's group holds only org A's members", async () => {
    const { ruleA } = await insertTwinDefaultRules();
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    // Dispatches both organizations' events into their own group; still
    // inside the group wait, so neither has flushed yet.
    await harness().runDueJobs();

    const [groupA] = await harness()
      .db.select()
      .from(alertNotificationGroups)
      .where(eq(alertNotificationGroups.organizationId, TEST_ORG));
    expect(groupA).toBeDefined();

    // The fixed group_by is [rule, severity], carried in the group key: org
    // A's group targets its own default destination.
    expect(groupA.defaultTier).toBe("all");

    // Reads the real membership rows, joined to the events they carry, rather
    // than trusting a count: proves which organization and which rule the
    // one member actually belongs to.
    const membersA = await harness()
      .db.select({
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
  });

  it("listing deliveries for org A returns none of org B's", async () => {
    const { channelA } = await insertTwinDefaultRules();
    harness().clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness().fireAndFlush();

    expect(harness().fetchCalls()).toHaveLength(2);

    // Rests on the flush's own `organizationId: group.organizationId` write
    // (delivery/flush-group.ts).
    const deliveriesA = await harness()
      .db.select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.organizationId, TEST_ORG));
    expect(deliveriesA).toHaveLength(1);
    // The channel behind the delivery is org A's own row for the shared
    // name: the flush resolved its own organization's default destination,
    // not org B's identically named channel.
    expect(deliveriesA[0].channelId).toBe(channelA.id);

    expect(deliveriesA[0].notificationGroupId).not.toBeNull();
  });
});
