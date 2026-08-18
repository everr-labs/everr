// @vitest-environment node
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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
import { ALERT_FLUSH_GROUP_TASK } from "@/data/alerting/delivery/tasks";
import { ALERTING_DEFAULT_GROUP_WAIT_SECS } from "@/data/alerting/routing/defaults";
import { deleteRule } from "@/data/alerting/rules/repository";
import {
  ALERT_EVALUATE_TASK,
  type EvaluatePayload,
  enqueueAlertEvaluation,
} from "@/data/alerting/scheduling/evaluation-jobs.server";
import {
  alertDeliveries,
  alertEvents,
  alertInstances,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import {
  asDbExecutor,
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

// Drizzle wraps the driver error in its own DrizzleQueryError, whose message
// is just "Failed query: ...": the constraint name lives on the wrapped
// error's own `cause`, the raw node-postgres error, as its `constraint`
// field. Asserting there is what pins the case to the specific constraint
// PostgreSQL refused on, not merely "some insert failed".
//
// A drizzle insert builder is a thenable that runs its statement on every
// await, so this awaits exactly once and reads that one rejection.
async function expectConstraintViolation(
  promise: Promise<unknown>,
  constraintName: string,
): Promise<void> {
  let rejection: unknown;
  let rejected = false;
  try {
    await promise;
  } catch (err) {
    rejection = err;
    rejected = true;
  }
  expect(rejected, `expected a rejection naming ${constraintName}`).toBe(true);
  const cause = (rejection as { cause?: { constraint?: string } }).cause;
  expect(cause?.constraint).toBe(constraintName);
}

// graphile-worker keeps queue_name on the job row itself, and neither
// pendingJobs() nor failedJobs() (testing/job-driver.ts) surfaces it: those
// helpers exist to drive and count jobs, not to inspect their partitioning.
// Reading the column straight off the table is what proves partitioning
// against the real rows the runtime wrote, not against a re-derivation of it.
async function queueNamesFor(
  taskIdentifier: string,
): Promise<{ queueName: string | null; payload: unknown }[]> {
  const result = await harness.db.execute<{
    queue_name: string | null;
    payload: unknown;
  }>(sql`
    SELECT q.queue_name AS queue_name, j.payload AS payload
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    LEFT JOIN graphile_worker._private_job_queues q ON q.id = j.job_queue_id
    WHERE t.identifier = ${taskIdentifier}
  `);
  return result.rows.map((row) => ({
    queueName: row.queue_name,
    payload: row.payload,
  }));
}

describe("the alerting pipeline's PostgreSQL invariants", () => {
  it("rejects an alert_events row whose kind disagrees with its event_type", async () => {
    const base = {
      organizationId: TEST_ORG,
      repoid: "repo_test",
      sourceDefinitionId: randomUUID(),
      slug: "default/checkout-latency",
    };
    // instance_pending is a state-stream row: it must never carry
    // kind = 'notifying', or a delivery reader that selects on that column
    // would treat a plain state change as something to send.
    await expectConstraintViolation(
      harness.db.insert(alertEvents).values({
        ...base,
        eventType: "instance_pending",
        kind: "notifying",
      }),
      "alert_events_kind_matches_type",
    );

    // instance_fired is the reverse: a notifying row that must never carry
    // kind = 'state', or the delivery path would never see it at all.
    await expectConstraintViolation(
      harness.db.insert(alertEvents).values({
        ...base,
        eventType: "instance_fired",
        kind: "state",
      }),
      "alert_events_kind_matches_type",
    );
  });

  it("converges two writes of the same instance onto one row, via alert_instances_definition_fingerprint_uq", async () => {
    const rule = await insertRule(harness.db);
    const target = [
      alertInstances.alertDefinitionId,
      alertInstances.fingerprint,
    ];
    const base = {
      organizationId: rule.organizationId,
      alertDefinitionId: rule.id,
      fingerprint: "checkout-fingerprint",
    };

    await harness.db
      .insert(alertInstances)
      .values({ ...base, status: "pending", value: 10 })
      .onConflictDoUpdate({
        target,
        set: { status: "pending", value: 10, updatedAt: new Date() },
      });
    // Without the unique index, this second write would insert a sibling row
    // instead of matching the first: onConflictDoUpdate's target only works
    // because alert_instances_definition_fingerprint_uq exists.
    await harness.db
      .insert(alertInstances)
      .values({ ...base, status: "firing", value: 99 })
      .onConflictDoUpdate({
        target,
        set: { status: "firing", value: 99, updatedAt: new Date() },
      });

    const rows = await harness.db.select().from(alertInstances);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("firing");
    expect(rows[0].value).toBe(99);
  });

  it("cascades a rule delete through its instances and direct notification groups, leaving a settled delivery ungrouped but intact", async () => {
    const rule = await insertDirectRule(harness.db, {
      forSecs: 0,
      channelType: "webhook",
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);
    await harness.fireAndFlush();

    const [groupBefore] = await harness.db
      .select()
      .from(alertNotificationGroups);
    expect(groupBefore.directAlertDefinitionId).toBe(rule.id);
    const [membershipBefore] = await harness.db
      .select()
      .from(alertNotificationGroupEvents);
    expect(membershipBefore).toBeDefined();
    const [deliveryBefore] = await harness.db.select().from(alertDeliveries);
    expect(deliveryBefore.status).toBe("sent");

    await deleteRule(TEST_ORG, rule.id, asDbExecutor(harness.db));

    expect(await harness.db.select().from(alertInstances)).toHaveLength(0);
    expect(
      await harness.db.select().from(alertNotificationGroups),
    ).toHaveLength(0);
    expect(
      await harness.db.select().from(alertNotificationGroupEvents),
    ).toHaveLength(0);

    // alert_deliveries carries no foreign key to alert_definitions at all,
    // only to the notification group, and that FK is ON DELETE SET NULL, not
    // CASCADE: the settled delivery is the record of a notification that
    // already happened, and it survives the rule's deletion ungrouped.
    const [deliveryAfter] = await harness.db.select().from(alertDeliveries);
    expect(deliveryAfter.dedupKey).toBe(deliveryBefore.dedupKey);
    expect(deliveryAfter.notificationGroupId).toBeNull();
    expect(deliveryAfter.status).toBe("sent");
  });

  // Deleting a channel that has delivery history belongs to this file by
  // subject, but pipeline-delivery.integration.test.ts already pins it, and
  // pins more: it also asserts the channel row itself is gone. A second copy
  // here would cost maintenance and add no coverage.

  it("allows one live rule and one preview rule to share a slug, and rejects a second live rule with it", async () => {
    await insertRule(harness.db, { slug: "checkout-latency" });
    const preview = await insertPreview(harness.db);
    // alert_definitions_live_project_slug_uq is scoped to preview_id IS NULL,
    // and alert_definitions_preview_project_slug_uq to preview_id IS NOT
    // NULL, so the same (project, slug) is legal once on each side.
    await insertRule(harness.db, {
      slug: "checkout-latency",
      previewId: preview.id,
    });

    // Both halves, or the case only pins one of the two indexes and a
    // regression in the other reads as green.
    await expectConstraintViolation(
      insertRule(harness.db, {
        slug: "checkout-latency",
        previewId: preview.id,
      }),
      "alert_definitions_preview_project_slug_uq",
    );
    await expectConstraintViolation(
      insertRule(harness.db, { slug: "checkout-latency" }),
      "alert_definitions_live_project_slug_uq",
    );
  });

  it("leaves no job behind when the transaction that enqueued it throws", async () => {
    await expect(
      harness.db.transaction(async (tx) => {
        await addWorkerJobInTransaction(tx as never, "test/never-runs", {}, {});
        throw new Error("rollback me");
      }),
    ).rejects.toThrow("rollback me");

    expect(await harness.pendingJobs()).toEqual([]);
  });

  it("collapses two evaluation enqueues for one scheduledFor onto one job carrying the newer payload", async () => {
    const alertDefinitionId = randomUUID();
    const scheduledFor = new Date("2026-01-01T00:05:00Z").toISOString();

    await enqueueAlertEvaluation({
      alertDefinitionId,
      scheduledFor,
      ruleVersion: 1,
    });
    // Same alertDefinitionId and scheduledFor build the same graphile job
    // key, and enqueueAlertEvaluation always asks for job_key_mode
    // "replace": the second call replaces the first job's row in place
    // rather than sitting beside it.
    await enqueueAlertEvaluation({
      alertDefinitionId,
      scheduledFor,
      ruleVersion: 7,
    });

    const jobs = (await harness.pendingJobs()).filter(
      (job) => job.identifier === ALERT_EVALUATE_TASK,
    );
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as EvaluatePayload).ruleVersion).toBe(7);
  });

  it("holds one queue for every flush of one group, and spreads many rules' evaluations across more than one queue", async () => {
    // One group, flushed twice: with repeats off, only a fresh dispatch into
    // an already-flushed group books a second flush, so a second instance of
    // the same rule arrives after the first flush to provide it. Both jobs
    // partition on the group's own id, so both must land on the same queue:
    // that is what serializes the group's own flushes against each other.
    // This runs, and drains fully, before any other rule exists, so
    // runDueJobs below has nothing due to pick up but this one group's own
    // work.
    await insertDirectRule(harness.db, {
      slug: "queue-rule",
      forSecs: 0,
      intervalSecs: 60,
      channelType: "webhook",
    });
    harness.clickhouse.setSignal([{ service: "checkout", value: 42 }]);

    await harness.runDueJobs(); // evaluates, fires, dispatches: enqueues the first flush job
    const [firstFlush] = await queueNamesFor(ALERT_FLUSH_GROUP_TASK);
    expect(firstFlush).toBeDefined();
    expect(firstFlush.queueName).toMatch(/^alerts-group-\d+$/);

    harness.advance(ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs(); // flushes and delivers; the group goes idle

    // A new instance under the same rule dispatches into the same group and
    // books its second flush.
    harness.clickhouse.setSignal([
      { service: "checkout", value: 42 },
      { service: "payments", value: 42 },
    ]);
    harness.advance(60_000 - ALERTING_DEFAULT_GROUP_WAIT_SECS * 1000);
    await harness.runDueJobs();

    const [secondFlush] = await queueNamesFor(ALERT_FLUSH_GROUP_TASK);
    expect(secondFlush).toBeDefined();
    expect(secondFlush.queueName).toBe(firstFlush.queueName);

    // Twenty distinct alert_definition_ids hashed across 64 queues: the
    // chance every one collides into a single queue is effectively zero, so
    // seeing more than one distinct queue_name here is the expected case,
    // not a flake. These are read straight off the enqueued rows, never run:
    // running them would fire against the ClickHouse rows set above and
    // confuse this assertion with a fresh crop of flush jobs. Filtered to
    // this loop's own ids, since the rule above keeps rescheduling its own
    // evaluation too.
    const RULE_COUNT = 20;
    const partitionRuleIds = new Set<string>();
    for (let index = 0; index < RULE_COUNT; index += 1) {
      const rule = await insertRule(harness.db, {
        slug: `partition-rule-${index}`,
      });
      partitionRuleIds.add(rule.id);
    }
    const evaluationQueues = (await queueNamesFor(ALERT_EVALUATE_TASK)).filter(
      (job) =>
        partitionRuleIds.has(
          (job.payload as EvaluatePayload).alertDefinitionId,
        ),
    );
    expect(evaluationQueues).toHaveLength(RULE_COUNT);
    expect(
      new Set(evaluationQueues.map((job) => job.queueName)).size,
    ).toBeGreaterThan(1);
  });
});
