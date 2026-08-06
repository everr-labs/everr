import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  alertingConditionMatches,
  alertingConditionValue,
} from "@/data/alerting/condition";
import { renderMessage } from "@/data/alerts/template";
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
import {
  ALERT_EVALUATE_TASK,
  alertEvaluationJobKey,
  alertingPartitionQueue,
  type EvaluatePayload,
} from "./01-scanner";
import { rowsToInstances } from "./02-instances";
import { boundEventEvidence, boundEvidence } from "./03-events";
import { ALERT_PROCESS_EVENT_TASK } from "./dispatcher";
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

function nextEvaluationAt(
  scheduledFor: Date,
  intervalSeconds: number,
  now: Date,
) {
  return new Date(
    Math.max(
      scheduledFor.getTime() + intervalSeconds * 1_000,
      now.getTime() + 1_000,
    ),
  );
}

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

async function scheduleNextInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  def: typeof alertDefinitions.$inferSelect,
  scheduledFor: Date,
  intervalSeconds = def.spec.interval_secs,
) {
  const runAt = nextEvaluationAt(scheduledFor, intervalSeconds, new Date());
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
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(alertEvaluations)
      .values({ alertDefinitionId: def.id, scheduledFor, error: message })
      .onConflictDoNothing()
      .returning({ alertDefinitionId: alertEvaluations.alertDefinitionId });
    if (inserted.length === 0) return;
    await tx
      .update(alertDefinitions)
      .set({
        lastError: message,
        lastEvaluatedAt: new Date(),
        lastErrorAt: new Date(),
        consecutiveFailures: sql`${alertDefinitions.consecutiveFailures} + 1`,
        healthStatus: sql`CASE WHEN ${alertDefinitions.consecutiveFailures} + 1 >= 3 THEN 'degraded'::alert_health ELSE ${alertDefinitions.healthStatus} END`,
        degradedSince: sql`CASE WHEN ${alertDefinitions.consecutiveFailures} + 1 >= 3 THEN coalesce(${alertDefinitions.degradedSince}, now()) ELSE ${alertDefinitions.degradedSince} END`,
      })
      .where(eq(alertDefinitions.id, def.id));
    const failureCount = def.consecutiveFailures + 1;
    const maximum = def.spec.max_interval_secs ?? def.spec.interval_secs * 16;
    const backoff = Math.min(
      maximum,
      def.spec.interval_secs * 2 ** Math.min(failureCount, 10),
    );
    await scheduleNextInTransaction(tx, def, new Date(), backoff);
  });
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

  let rows: Record<string, unknown>[];
  try {
    rows = (
      await querySqlApiWithMeta<Record<string, unknown>>(
        def.spec.sql,
        def.organizationId,
      )
    ).rows;
  } catch (cause) {
    await recordEvaluationFailure(def, scheduledFor, cause);
    return;
  }

  const evaluatedAt = new Date();
  const evidence = boundEvidence(rows);
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

  await db.transaction(async (tx) => {
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
      return;
    const inserted = await tx
      .insert(alertEvaluations)
      .values({ alertDefinitionId: def.id, scheduledFor })
      .onConflictDoNothing()
      .returning({ alertDefinitionId: alertEvaluations.alertDefinitionId });
    if (inserted.length === 0) return;

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

    const eventRows: (typeof alertEvents.$inferInsert)[] = transitions.flatMap(
      (transition) => {
        if (!transition.event) return [];
        const next = transition.next;
        const bounded = boundEventEvidence(next.evidence, next.labels);
        const firstRow: Record<string, unknown> = {
          ...bounded.evidence,
          ...next.labels,
        };
        firstRow.value = next.value;
        return [
          {
            organizationId: def.organizationId,
            repoid: def.repoid,
            previewId: def.previewId,
            sourceKind: "alert" as const,
            sourceDefinitionId: def.id,
            slug: `${def.project}/${def.slug}`,
            eventType:
              transition.event === "firing"
                ? "instance_fired"
                : "instance_resolved",
            instanceFingerprint: next.fingerprint,
            instanceLabels: next.labels,
            severity: def.spec.severity,
            notificationTitle: renderMessage(
              def.spec.annotations.summary ?? "",
              {
                firstRow,
              },
            ),
            notificationDescription: renderMessage(
              def.spec.annotations.description ?? "",
              { firstRow },
            ),
            suppressed: def.spec.suppressed || def.previewId !== null,
            evidence: bounded.evidence,
            evidenceTruncated: bounded.truncated,
            occurredAt: evaluatedAt,
          },
        ];
      },
    );
    if (eventRows.length > 0) {
      const events = await tx
        .insert(alertEvents)
        .values(eventRows)
        .returning({ id: alertEvents.id });
      for (const event of events) {
        await addWorkerJobInTransaction(
          tx,
          ALERT_PROCESS_EVENT_TASK,
          { eventId: event.id },
          {
            jobKey: `${ALERT_PROCESS_EVENT_TASK}:${event.id}`,
            jobKeyMode: "replace",
            maxAttempts: 5,
          },
        );
      }
    }
    await scheduleNextInTransaction(tx, def, scheduledFor);
  });
}
