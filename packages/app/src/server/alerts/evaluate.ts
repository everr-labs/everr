import { eq } from "drizzle-orm";
import { renderMessage } from "@/data/alerts/template";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema";
import {
  type AlertEventRow,
  insertAlertEvents,
  querySqlApiWithMeta,
} from "@/lib/clickhouse";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { type DeliveryMetadata, deliverAlertNotification } from "./delivery";
import {
  boundEvidence,
  buildEvaluationEvent,
  buildInstanceEvent,
} from "./events";
import {
  diffInstances,
  type FiringInstance,
  fetchFiringInstances,
  rowsToInstances,
} from "./instances";
import type { EvaluatePayload } from "./scanner";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePayload(payload: EvaluatePayload) {
  const scheduledFor = new Date(payload.scheduledFor);
  if (
    !UUID_RE.test(payload.alertDefinitionId) ||
    Number.isNaN(scheduledFor.getTime())
  ) {
    serverLogger.warn("alerts.evaluate.invalid_payload", {
      "alert.definition_id": String(payload.alertDefinitionId),
      "alert.scheduled_for": String(payload.scheduledFor),
    });
    return null;
  }

  return {
    alertDefinitionId: payload.alertDefinitionId,
    scheduledFor,
  };
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
    const message = error instanceof Error ? error.message : String(error);
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

  let rows: Record<string, unknown>[];
  try {
    const result = await querySqlApiWithMeta<Record<string, unknown>>(
      query,
      def.organizationId,
    );
    rows = result.rows;
  } catch (error) {
    await recordEvaluationFailure(error, "alerts.evaluate.query_failed");
    return;
  }

  let previous: FiringInstance[];
  try {
    previous = await fetchFiringInstances(def);
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
  if (diff.newlyFired.length > 0) {
    const delivery = await deliverAlertNotification({
      def,
      kind: "firing",
      summary,
      description,
      firingCount: current.length,
      instances: diff.newlyFired.map(({ fingerprint, labels }) => ({
        fingerprint,
        labels,
      })),
    });
    events.push(
      buildEvaluationEvent({
        def,
        eventType: "firing",
        scheduledFor,
        evidence,
        ...deliveryFields(delivery),
      }),
    );
  }
  if (wasFiring && !isFiring) {
    const delivery = await deliverAlertNotification({
      def,
      kind: "resolved",
      summary,
      description,
      firingCount: 0,
      instances: diff.nowResolved,
    });
    events.push(
      buildEvaluationEvent({
        def,
        eventType: "resolved",
        scheduledFor,
        evidence,
        ...deliveryFields(delivery),
      }),
    );
  } else if (diff.nowResolved.length > 0) {
    const delivery = await deliverAlertNotification({
      def,
      kind: "partial_resolved",
      summary,
      description,
      firingCount: current.length,
      instances: diff.nowResolved,
    });
    events.push(
      buildEvaluationEvent({
        def,
        eventType: "partial_resolved",
        scheduledFor,
        evidence,
        ...deliveryFields(delivery),
      }),
    );
  }
  await recordAlertEvents(events);
}
