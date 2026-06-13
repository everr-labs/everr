// The imperative shell of one alert evaluation. The state machine itself is
// pure and lives in transition.ts; this module sequences the I/O around it:
//
//   1. Validate the queued payload — stale or malformed jobs are dropped with
//      a warning, never retried.
//   2. Load the definition from Postgres; skip if missing or deactivated.
//   3. Read concurrently from ClickHouse: the rule's query result and the
//      currently firing instance set. If either read fails, mark the
//      definition errored, record an `evaluation_failed` event, and stop.
//   4. Derive (pure): bound the evidence, turn rows into labeled instances,
//      diff them against the previous firing set, and build the transition —
//      the definition patch plus the notifications to send.
//   5. Persist the evaluation bookkeeping and the transition's patch to
//      Postgres.
//   6. Deliver the transition's notifications; they are independent, so
//      instance churn (some fired, some resolved) fans out concurrently.
//   7. Record the evaluation in ClickHouse: one row per instance transition,
//      one per notification (carrying its delivery outcome), and one per
//      failed delivery target.
//
// Evaluations of one definition never run concurrently (per-org Graphile
// queue + job_key), so each run may assume it sees the previous run's state.

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
  type BoundedEvidence,
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
  type InstanceDiff,
  rowsToInstances,
} from "./instances";
import type { EvaluatePayload } from "./scanner";
import { type AlertTransition, buildAlertTransition } from "./transition";

type AlertDefinition = typeof alertDefinitions.$inferSelect;

const EvaluatePayloadSchema = z.object({
  alertDefinitionId: z.string().uuid(),
  scheduledFor: z.coerce.date(),
});

export async function evaluateAlert(payload: EvaluatePayload): Promise<void> {
  // 1. Validate the payload.
  const parsedPayload = parsePayload(payload);
  if (!parsedPayload) return;
  const { alertDefinitionId, scheduledFor } = parsedPayload;

  // 2. Load the definition.
  const [def] = await db
    .select()
    .from(alertDefinitions)
    .where(eq(alertDefinitions.id, alertDefinitionId))
    .limit(1);
  if (!def?.active) return;
  const now = new Date();

  // 3. Concurrent ClickHouse reads. The pre-attached no-op catch keeps an
  // early return on query failure from leaving an unhandled rejection behind.
  const queryPromise = querySqlApiWithMeta<Record<string, unknown>>(
    def.parsedQuery,
    def.organizationId,
  );
  const firingPromise = fetchFiringInstances(def);
  firingPromise.catch(() => {});

  let rows: Record<string, unknown>[];
  try {
    rows = (await queryPromise).rows;
  } catch (error) {
    await recordEvaluationFailure({
      def,
      now,
      scheduledFor,
      error,
      logEvent: "alerts.evaluate.query_failed",
    });
    return;
  }

  let previous: FiringInstance[];
  try {
    previous = await firingPromise;
  } catch (error) {
    await recordEvaluationFailure({
      def,
      now,
      scheduledFor,
      error,
      logEvent: "alerts.evaluate.firing_set_read_failed",
    });
    return;
  }

  // 4. Derive the transition (pure).
  const evidence = boundEvidence(rows);
  const current = rowsToInstances(
    evidence.rows,
    def.instanceLabelColumns ?? [],
    now,
  );
  const diff = diffInstances(previous, current);
  const transition = buildAlertTransition({ previous, current, diff, now });

  // 5. Persist the evaluation bookkeeping and the transition's patch.
  await db
    .update(alertDefinitions)
    .set({
      lastEvaluationStatus: "ok",
      lastEvaluationError: "",
      lastEvaluatedAt: now,
      lastRowCount: evidence.rowCount,
      lastEvidenceSnapshot: evidence.rows,
      ...transition.definitionUpdate,
    })
    .where(eq(alertDefinitions.id, def.id));

  // 6. Deliver the transition's notifications.
  const { summary, description } = renderMessages(def, evidence);
  const deliveries = await Promise.all(
    transition.actions.map((action) =>
      deliverAlertNotification({
        def,
        kind: action.kind,
        summary,
        description,
        firingCount: transition.firingCount,
        instances: action.instances,
      }),
    ),
  );

  // 7. Record the evaluation's events.
  await recordAlertEvents(
    def,
    buildEventRows({
      def,
      scheduledFor,
      evidence,
      diff,
      transition,
      deliveries,
    }),
  );
}

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

function renderMessages(def: AlertDefinition, evidence: BoundedEvidence) {
  const input = { rowCount: evidence.rowCount, firstRow: evidence.firstRow };
  return {
    summary: renderMessage(def.summaryTemplate, input),
    description: def.descriptionTemplate
      ? renderMessage(def.descriptionTemplate, input)
      : "",
  };
}

// One row per instance transition, then per notification one evaluation event
// (carrying its delivery outcome) followed by its delivery failures.
function buildEventRows(opts: {
  def: AlertDefinition;
  scheduledFor: Date;
  evidence: BoundedEvidence;
  diff: InstanceDiff;
  transition: AlertTransition;
  deliveries: (DeliveryMetadata | null)[];
}): AlertEventRow[] {
  const { def, scheduledFor, evidence, diff, transition, deliveries } = opts;

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

  for (const [index, action] of transition.actions.entries()) {
    const delivery = deliveries[index] ?? null;
    events.push(
      buildEvaluationEvent({
        def,
        eventType: action.kind,
        scheduledFor,
        evidence,
        ...(delivery
          ? {
              deliveryTargets: delivery.deliveryTargets,
              silenceId: delivery.silenceId,
            }
          : {}),
      }),
    );
    for (const failure of delivery?.failures ?? []) {
      events.push(buildDeliveryFailureEvent({ def, scheduledFor, failure }));
    }
  }

  return events;
}

async function recordAlertEvents(
  def: Pick<AlertDefinition, "id">,
  events: AlertEventRow[],
): Promise<void> {
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

// A ClickHouse read failed before any state could be derived: mark the
// definition errored, log, and record an `evaluation_failed` event.
async function recordEvaluationFailure(opts: {
  def: AlertDefinition;
  now: Date;
  scheduledFor: Date;
  error: unknown;
  logEvent: string;
}): Promise<void> {
  const { def, now, scheduledFor, error, logEvent } = opts;
  await db
    .update(alertDefinitions)
    .set({
      lastEvaluationStatus: "error",
      lastEvaluationError: errorMessage(error),
      lastEvaluatedAt: now,
    })
    .where(eq(alertDefinitions.id, def.id));
  serverLogger.error(logEvent, {
    ...exceptionAttributes(error),
    "alert.definition_id": def.id,
    "error.handled": true,
  });
  await recordAlertEvents(def, [
    buildEvaluationEvent({
      def,
      eventType: "evaluation_failed",
      scheduledFor,
    }),
  ]);
}
