import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { renderMessage } from "@/data/alerting/delivery/template";
import {
  alertingConditionMatches,
  alertingConditionValue,
} from "@/data/alerting/rules/condition";
import {
  ALERT_EVALUATE_TASK,
  alertEvaluationJobKey,
  alertingPartitionQueue,
  alertingRetryAt,
  alertingRetryDelaySeconds,
  type EvaluatePayload,
  nextAlertEvaluationAt,
} from "@/data/alerting/scheduling/evaluation-jobs.server";
import { db } from "@/db/client";
import {
  alertDefinitions,
  alertEvaluations,
  alertEvents,
  alertInstances,
} from "@/db/schema";
import { querySqlApiWithMeta } from "@/lib/clickhouse";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import {
  errorMessage,
  exceptionAttributes,
  serverLogger,
} from "@/telemetry/logger";
import { enqueueProcessAlertEvent } from "../delivery/tasks";
import {
  type AlertHistoryDefinition,
  evaluationFailureHistoryRow,
  evaluationHistoryRow,
  instanceHistoryRow,
  recordAlertHistory,
} from "../history/clickhouse";
import { boundEventEvidence, boundEvidence } from "./evidence";
import { rowsToInstances } from "./instances";
import { captureAlertEvaluationSamples } from "./samples";
import {
  advanceAlertInstance,
  newInactiveInstance,
  type PresentAlertInstance,
  type StoredAlertInstance,
} from "./state-machine";

const EvaluatePayloadSchema = z.object({
  alertDefinitionId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  ruleVersion: z.number().int().positive().optional(),
});

function storedInstance(
  row: typeof alertInstances.$inferSelect,
): StoredAlertInstance {
  return {
    fingerprint: row.fingerprint,
    status: row.status,
    labels: row.labels,
    evidence: row.evidence,
    value: row.value,
    pendingSince: row.pendingSince,
    activeSince: row.activeSince,
    lastSeenAt: row.lastSeenAt,
    absentCount: row.absentCount,
  };
}

function historyDefinition(
  def: typeof alertDefinitions.$inferSelect,
): AlertHistoryDefinition {
  return {
    id: def.id,
    organizationId: def.organizationId,
    repoid: def.repoid,
    slug: `${def.project}/${def.slug}`,
    previewId: def.previewId,
    severity: def.spec.severity,
    suppressed: def.spec.suppressed || def.previewId !== null,
  };
}

async function scheduleAlertAtInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  def: typeof alertDefinitions.$inferSelect,
  runAt: Date,
) {
  const payload: EvaluatePayload = {
    alertDefinitionId: def.id,
    scheduledFor: runAt.toISOString(),
    ruleVersion: def.version,
  };
  await tx
    .update(alertDefinitions)
    .set({ nextEvaluationAt: runAt })
    .where(eq(alertDefinitions.id, def.id));
  await addWorkerJobInTransaction(tx, ALERT_EVALUATE_TASK, payload, {
    jobKey: alertEvaluationJobKey(def.id, payload.scheduledFor),
    jobKeyMode: "replace",
    maxAttempts: 5,
    queueName: alertingPartitionQueue("alert", def.id),
    runAt,
  });
}

async function recordEvaluationFailure(
  def: typeof alertDefinitions.$inferSelect,
  scheduledFor: Date,
  cause: unknown,
) {
  const message = errorMessage(cause).slice(0, 8_000);
  const occurredAt = new Date();
  const applied = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(alertEvaluations)
      .values({ alertDefinitionId: def.id, scheduledFor })
      .onConflictDoNothing()
      .returning({ alertDefinitionId: alertEvaluations.alertDefinitionId });
    if (inserted.length === 0) return false;
    await tx
      .update(alertDefinitions)
      .set({
        lastError: message,
        lastEvaluatedAt: occurredAt,
        lastErrorAt: occurredAt,
        consecutiveFailures: sql`${alertDefinitions.consecutiveFailures} + 1`,
        healthStatus: "degraded",
        degradedSince: sql`coalesce(${alertDefinitions.degradedSince}, now())`,
      })
      .where(eq(alertDefinitions.id, def.id));
    const failureCount = def.consecutiveFailures + 1;
    const maximum = def.spec.max_interval_secs ?? def.spec.interval_secs * 16;
    const backoff = alertingRetryDelaySeconds(
      def.spec.interval_secs,
      failureCount,
      maximum,
    );
    await scheduleAlertAtInTransaction(tx, def, alertingRetryAt(backoff));
    return true;
  });
  if (applied) {
    await recordAlertHistory(def.id, [
      evaluationFailureHistoryRow({
        def: historyDefinition(def),
        scheduledFor,
        occurredAt,
        error: message,
      }),
    ]);
  }
  serverLogger.warn("alerts.evaluate.query_failed", {
    ...exceptionAttributes(cause),
    "alert.definition_id": def.id,
    "alert.organization_id": def.organizationId,
    "error.handled": true,
  });
}

export async function evaluateAlert(rawPayload: unknown): Promise<void> {
  const parsed = EvaluatePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    serverLogger.warn("alerts.evaluate.invalid_payload", {
      "alert.payload": String(rawPayload),
      "error.handled": true,
    });
    return;
  }
  const payload = parsed.data;
  const scheduledFor = new Date(payload.scheduledFor);
  const [def] = await db
    .select()
    .from(alertDefinitions)
    .where(eq(alertDefinitions.id, payload.alertDefinitionId))
    .limit(1);
  if (
    !def?.active ||
    (payload.ruleVersion !== undefined && def.version !== payload.ruleVersion)
  )
    return;

  // Every terminal path from here has to advance scheduling state. The scanner
  // only selects a definition whose lastEnqueuedAt predates its
  // nextEvaluationAt, so a throw that escapes this function leaves the rule
  // enqueued-but-never-rescheduled and it goes silent for good.
  try {
    await evaluateAlertRule(def, payload, scheduledFor);
  } catch (cause) {
    await recordEvaluationFailure(def, scheduledFor, cause);
  }
}

async function evaluateAlertRule(
  def: typeof alertDefinitions.$inferSelect,
  payload: z.infer<typeof EvaluatePayloadSchema>,
  scheduledFor: Date,
): Promise<void> {
  const rows = (
    await querySqlApiWithMeta<Record<string, unknown>>(
      def.spec.sql,
      def.organizationId,
    )
  ).rows;

  const evaluatedAt = new Date();
  const evidence = boundEvidence(rows);
  const capturedSamples = captureAlertEvaluationSamples(
    rows,
    def.spec.label_columns,
  );
  const present = rowsToInstances(
    rows.filter((row) => alertingConditionMatches(row, def.spec.condition)),
    def.spec.label_columns,
    evaluatedAt,
  ).map(
    (instance): PresentAlertInstance => ({
      fingerprint: instance.fingerprint,
      labels: instance.labels,
      evidence: instance.row,
      value: alertingConditionValue(instance.row),
    }),
  );
  const presentByFingerprint = new Map(
    present.map((instance) => [instance.fingerprint, instance]),
  );
  const previousRows = await db
    .select()
    .from(alertInstances)
    .where(eq(alertInstances.alertDefinitionId, def.id));
  const previousByFingerprint = new Map(
    previousRows.map((row) => [row.fingerprint, storedInstance(row)]),
  );
  const fingerprints = new Set([
    ...previousByFingerprint.keys(),
    ...presentByFingerprint.keys(),
  ]);
  const transitions = [...fingerprints].map((fingerprint) => {
    const current = presentByFingerprint.get(fingerprint);
    const stored = previousByFingerprint.get(fingerprint);
    let previous: StoredAlertInstance;
    if (stored) {
      previous = stored;
    } else {
      if (!current) {
        throw new Error(
          `missing alert instance for fingerprint ${fingerprint}`,
        );
      }
      previous = newInactiveInstance(current);
    }
    return advanceAlertInstance({
      previous,
      present: current,
      evaluatedAt,
      forSeconds: def.spec.for_secs,
      resolveAfter: def.spec.resolve_after,
    });
  });

  const historyDef = historyDefinition(def);
  const transitionEvents = transitions.flatMap((transition) => {
    if (!transition.event) return [];
    const next = transition.next;
    const bounded = boundEventEvidence(next.evidence, next.labels);
    const firstRow: Record<string, unknown> = {
      ...bounded.evidence,
      ...next.labels,
      value: next.value,
    };
    const id = randomUUID();
    const eventType =
      transition.event === "firing"
        ? ("instance_fired" as const)
        : ("instance_resolved" as const);
    return [
      {
        outbox: {
          id,
          organizationId: def.organizationId,
          repoid: def.repoid,
          previewId: def.previewId,
          sourceDefinitionId: def.id,
          slug: historyDef.slug,
          eventType,
          instanceFingerprint: next.fingerprint,
          instanceLabels: next.labels,
          severity: def.spec.severity,
          notificationTitle: renderMessage(def.spec.annotations.summary ?? "", {
            firstRow,
          }),
          notificationDescription: renderMessage(
            def.spec.annotations.description ?? "",
            { firstRow },
          ),
          suppressed: historyDef.suppressed,
          occurredAt: evaluatedAt,
        } satisfies typeof alertEvents.$inferInsert,
        history: instanceHistoryRow({
          def: historyDef,
          eventId: id,
          eventType,
          scheduledFor,
          occurredAt: evaluatedAt,
          fingerprint: next.fingerprint,
          labels: next.labels,
          evidence: bounded.evidence,
          evidenceTruncated: bounded.truncated,
        }),
      },
    ];
  });

  const applied = await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({
        active: alertDefinitions.active,
        version: alertDefinitions.version,
      })
      .from(alertDefinitions)
      .where(eq(alertDefinitions.id, def.id))
      .for("update")
      .limit(1);
    if (
      !fresh?.active ||
      (payload.ruleVersion !== undefined &&
        fresh.version !== payload.ruleVersion)
    )
      return false;
    const inserted = await tx
      .insert(alertEvaluations)
      .values({
        alertDefinitionId: def.id,
        scheduledFor,
      })
      .onConflictDoNothing()
      .returning({ alertDefinitionId: alertEvaluations.alertDefinitionId });
    if (inserted.length === 0) return false;

    for (const transition of transitions) {
      const next = transition.next;
      const boundedInstanceEvidence = boundEventEvidence(
        next.evidence,
        next.labels,
      );
      await tx
        .insert(alertInstances)
        .values({
          organizationId: def.organizationId,
          alertDefinitionId: def.id,
          fingerprint: next.fingerprint,
          status: next.status,
          labels: next.labels,
          evidence: boundedInstanceEvidence.evidence,
          value: next.value,
          pendingSince: next.pendingSince,
          activeSince: next.activeSince,
          lastSeenAt: next.lastSeenAt,
          absentCount: next.absentCount,
          updatedAt: evaluatedAt,
        })
        .onConflictDoUpdate({
          target: [
            alertInstances.alertDefinitionId,
            alertInstances.fingerprint,
          ],
          set: {
            status: next.status,
            labels: next.labels,
            evidence: boundedInstanceEvidence.evidence,
            value: next.value,
            pendingSince: next.pendingSince,
            activeSince: next.activeSince,
            lastSeenAt: next.lastSeenAt,
            absentCount: next.absentCount,
            updatedAt: evaluatedAt,
          },
        });
    }

    const firing = transitions.filter((item) => item.next.status === "firing");
    const fired = transitions.filter((item) => item.event === "firing");
    const resolved = transitions.filter((item) => item.event === "resolved");
    await tx
      .update(alertDefinitions)
      .set({
        lastError: null,
        healthStatus: "healthy",
        consecutiveFailures: 0,
        degradedSince: null,
        lastEvaluatedAt: evaluatedAt,
        lastSeenAt: present.length > 0 ? evaluatedAt : def.lastSeenAt,
        lastRowCount: evidence.rowCount,
        firingInstanceCount: firing.length,
        currentState: firing.length > 0 ? "firing" : "resolved",
        lastFiredAt: fired.length > 0 ? evaluatedAt : def.lastFiredAt,
        lastResolvedAt: resolved.length > 0 ? evaluatedAt : def.lastResolvedAt,
      })
      .where(eq(alertDefinitions.id, def.id));

    const eventRows = transitionEvents.map(({ outbox }) => outbox);
    if (eventRows.length > 0) {
      const events = await tx
        .insert(alertEvents)
        .values(eventRows)
        .returning({ id: alertEvents.id });
      for (const event of events) {
        await enqueueProcessAlertEvent(tx, event.id);
      }
    }
    await scheduleAlertAtInTransaction(
      tx,
      def,
      nextAlertEvaluationAt(def.organizationId, def.id, def.spec.interval_secs),
    );
    return true;
  });
  if (applied) {
    await recordAlertHistory(def.id, [
      evaluationHistoryRow({
        def: historyDef,
        scheduledFor,
        occurredAt: evaluatedAt,
        rowCount: evidence.rowCount,
        evidenceJson: evidence.json,
        evidenceTruncated: evidence.truncated,
        samples: capturedSamples.samples,
        samplesTruncated: capturedSamples.truncated,
      }),
      ...transitionEvents.map(({ history }) => history),
    ]);
  }
}
