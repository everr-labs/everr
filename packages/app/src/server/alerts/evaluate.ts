import { eq } from "drizzle-orm";
import { z } from "zod";
import { renderMessage } from "@/data/alerts/template";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import { querySqlApiWithMeta } from "@/lib/clickhouse";
import {
  errorMessage,
  exceptionAttributes,
  serverLogger,
} from "@/telemetry/logger";
import { type DeliveryMetadata, deliverAlertNotification } from "./delivery";
import {
  type AlertEventRow,
  boundEvidence,
  buildDeliveryFailureEvent,
  buildEvaluationEvent,
  buildInstanceEvent,
  insertAlertEvents,
} from "./events";
import {
  diffInstances,
  type FiringInstance,
  fetchFiringInstances,
  rowsToInstances,
} from "./instances";
import type { EvaluatePayload } from "./scanner";

const EvaluatePayloadSchema = z.object({
  alertDefinitionId: z.string().uuid(),
  scheduledFor: z.coerce.date(),
});

function parsePayload(payload: EvaluatePayload) {
  const parsed = EvaluatePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    serverLogger.warn("alerts.evaluate.invalid_payload", {
      "alert.definition_id": String(payload.alertDefinitionId),
      "alert.scheduled_for": String(payload.scheduledFor),
    });
    return null;
  }

  return parsed.data;
}

function deliveryFields(metadata: DeliveryMetadata | null) {
  return metadata
    ? {
        deliveryTargets: metadata.deliveryTargets,
        silenceId: metadata.silenceId,
      }
    : {};
}

export async function evaluateAlert(payload: EvaluatePayload): Promise<void> {
  const parsedPayload = parsePayload(payload);
  if (!parsedPayload) return;

  const [def] = await db
    .select()
    .from(alertDefinitions)
    .where(eq(alertDefinitions.id, parsedPayload.alertDefinitionId))
    .limit(1);
  if (!def?.active) return;

  const scheduledFor = parsedPayload.scheduledFor;
  const now = new Date();
  const query = def.parsedQuery;

  async function recordAlertEvents(events: AlertEventRow[]) {
    if (events.length === 0) return;
    try {
      await insertAlertEvents(events);
    } catch (error) {
      serverLogger.error("alerts.evaluate.event_insert_failed", {
        ...exceptionAttributes(error),
        "alert.definition_id": def.id,
        "alert.event_count": events.length,
        "error.handled": true,
      });
    }
  }

  async function recordEvaluationFailure(error: unknown, logEvent: string) {
    const message = errorMessage(error);
    await db
      .update(alertDefinitions)
      .set({
        lastEvaluationStatus: "error",
        lastEvaluationError: message,
        lastEvaluatedAt: now,
      })
      .where(eq(alertDefinitions.id, def.id));
    serverLogger.error(logEvent, {
      ...exceptionAttributes(error),
      "alert.definition_id": def.id,
      "error.handled": true,
    });
    await recordAlertEvents([
      buildEvaluationEvent({
        def,
        eventType: "evaluation_failed",
        scheduledFor,
      }),
    ]);
  }

  // Independent ClickHouse reads — run them concurrently. The pre-attached
  // no-op catch keeps an early return on query failure from leaving an
  // unhandled rejection behind.
  const queryPromise = querySqlApiWithMeta<Record<string, unknown>>(
    query,
    def.organizationId,
  );
  const firingPromise = fetchFiringInstances(def);
  firingPromise.catch(() => {});

  let rows: Record<string, unknown>[];
  try {
    rows = (await queryPromise).rows;
  } catch (error) {
    await recordEvaluationFailure(error, "alerts.evaluate.query_failed");
    return;
  }

  let previous: FiringInstance[];
  try {
    previous = await firingPromise;
  } catch (error) {
    await recordEvaluationFailure(
      error,
      "alerts.evaluate.firing_set_read_failed",
    );
    return;
  }

  const evidence = boundEvidence(rows);
  const current = rowsToInstances(
    evidence.rows,
    def.instanceLabelColumns ?? [],
    now,
  );
  const diff = diffInstances(previous, current);
  const wasFiring = previous.length > 0;
  const isFiring = current.length > 0;

  const summary = renderMessage(def.summaryTemplate, {
    rowCount: evidence.rowCount,
    firstRow: evidence.firstRow,
  });
  const description = def.descriptionTemplate
    ? renderMessage(def.descriptionTemplate, {
        rowCount: evidence.rowCount,
        firstRow: evidence.firstRow,
      })
    : "";

  await db
    .update(alertDefinitions)
    .set({
      lastEvaluationStatus: "ok",
      lastEvaluationError: "",
      lastEvaluatedAt: now,
      lastRowCount: evidence.rowCount,
      lastEvidenceSnapshot: evidence.rows,
      currentState: isFiring ? "firing" : "resolved",
      firingInstanceCount: current.length,
      ...(isFiring ? { lastSeenAt: now } : {}),
      ...(diff.newlyFired.length > 0 && !wasFiring ? { lastFiredAt: now } : {}),
      ...(wasFiring && !isFiring ? { lastResolvedAt: now } : {}),
    })
    .where(eq(alertDefinitions.id, def.id));

  const events: AlertEventRow[] = [
    ...diff.newlyFired.map((instance) =>
      buildInstanceEvent({
        def,
        eventType: "instance_fired",
        scheduledFor,
        fingerprint: instance.fingerprint,
        labels: instance.labels,
        row: instance.row,
      }),
    ),
    ...diff.nowResolved.map((instance) =>
      buildInstanceEvent({
        def,
        eventType: "instance_resolved",
        scheduledFor,
        fingerprint: instance.fingerprint,
        labels: instance.labels,
      }),
    ),
  ];
  // nowResolved > 0 implies wasFiring; an empty current set means a full
  // resolve (all previous instances are in nowResolved), otherwise partial.
  // The two deliveries are independent — run them concurrently so an instance
  // churn (some fired, some resolved) doesn't serialize two send fan-outs.
  const resolvedKind = isFiring ? "partial_resolved" : "resolved";
  const [firingDelivery, resolvedDelivery] = await Promise.all([
    diff.newlyFired.length > 0
      ? deliverAlertNotification({
          def,
          kind: "firing",
          summary,
          description,
          firingCount: current.length,
          instances: diff.newlyFired,
        })
      : null,
    diff.nowResolved.length > 0
      ? deliverAlertNotification({
          def,
          kind: resolvedKind,
          summary,
          description,
          firingCount: current.length,
          instances: diff.nowResolved,
        })
      : null,
  ]);
  if (diff.newlyFired.length > 0) {
    events.push(
      buildEvaluationEvent({
        def,
        eventType: "firing",
        scheduledFor,
        evidence,
        ...deliveryFields(firingDelivery),
      }),
    );
  }
  if (diff.nowResolved.length > 0) {
    events.push(
      buildEvaluationEvent({
        def,
        eventType: resolvedKind,
        scheduledFor,
        evidence,
        ...deliveryFields(resolvedDelivery),
      }),
    );
  }
  for (const delivery of [firingDelivery, resolvedDelivery]) {
    for (const failure of delivery?.failures ?? []) {
      events.push(buildDeliveryFailureEvent({ def, scheduledFor, failure }));
    }
  }
  await recordAlertEvents(events);
}
