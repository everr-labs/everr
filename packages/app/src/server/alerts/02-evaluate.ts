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
//   6. Resolve and enqueue the transition's notifications as retryable
//      `alerts/deliver` jobs (one per channel target — see delivery.ts).
//   7. Record the evaluation in ClickHouse: one row per instance transition
//      and one per notification, carrying the targets it was queued for.
//      Send failures are recorded later by the delivery job itself.
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
import type { EvaluatePayload } from "./01-scanner";
import {
  diffInstances,
  type FiringInstance,
  fetchFiringInstances,
  type InstanceDiff,
  rowsToInstances,
} from "./02-instances";
import { type AlertTransition, buildAlertTransition } from "./02-transition";
import {
  type AlertEventRow,
  type BoundedEvidence,
  boundEvidence,
  buildEvaluationEvent,
  buildInstanceEvent,
  recordAlertEvents,
} from "./03-events";
import { type DeliveryMetadata, enqueueAlertNotification } from "./04-delivery";

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

  // 4. Derive the transition (pure). Instance identity and counts come from the
  // full result; `evidence` is only the bounded snapshot kept for storage and
  // message rendering. Deriving `current` from the bounded rows would cap the
  // firing set at MAX_EVIDENCE_ROWS and falsely resolve everything past it.
  const evidence = boundEvidence(rows);
  const current = rowsToInstances(rows, def.instanceLabelColumns ?? [], now);
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

  // 6. Resolve and enqueue the transition's notifications. This runs BEFORE the
  // events are recorded: instance_fired/instance_resolved events are the firing
  // set the next run reads, so recording them before the notification is durably
  // enqueued would make a retry see the instance as already firing and skip the
  // re-enqueue, dropping the notification. On failure we throw without recording,
  // letting the job retry re-derive and re-enqueue (delivery jobKeys replace, so
  // re-enqueuing is idempotent).
  const { title, description } = renderMessages(def, evidence);
  const deliveries: (DeliveryMetadata | null)[] = [];
  for (const action of transition.actions) {
    deliveries.push(
      await enqueueAlertNotification(
        {
          def,
          kind: action.kind,
          title,
          description,
          firingCount: transition.firingCount,
          instances: action.instances,
        },
        scheduledFor,
      ),
    );
  }

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
    "alerts.evaluate.event_insert_failed",
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
    title: renderMessage(def.notificationTitleTemplate, input),
    description: def.notificationDescriptionTemplate
      ? renderMessage(def.notificationDescriptionTemplate, input)
      : "",
  };
}

// One row per instance transition, then one evaluation event per notification
// carrying the targets it was queued for (or the suppressing silence).
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
  }

  return events;
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
  await recordAlertEvents(
    def,
    [
      buildEvaluationEvent({
        def,
        eventType: "evaluation_failed",
        scheduledFor,
      }),
    ],
    "alerts.evaluate.event_insert_failed",
  );
}
