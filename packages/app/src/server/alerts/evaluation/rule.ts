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
import { env } from "@/env";
import { querySqlApiWithMeta } from "@/lib/clickhouse";
import { previewDefinitionsEnqueueable } from "@/server/alerts/scheduling/scanner";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import {
  errorMessage,
  exceptionAttributes,
  serverLogger,
} from "@/telemetry/logger";
import { enqueueProcessAlertEvent } from "../delivery/tasks";
import {
  type AlertHistoryDefinition,
  type AlertHistoryRow,
  evaluationFailureHistoryRow,
  evaluationHistoryRow,
  instanceHistoryRow,
  recordAlertHistory,
  ZERO_UUID,
} from "../history/clickhouse";
import { buildAlertContextJson } from "../history/content";
import { uuidv7 } from "../history/ids";
import { boundEventEvidence, boundEvidence } from "./evidence";
import { rowsToInstances } from "./instances";
import { captureAlertEvaluationSamples } from "./samples";
import {
  type AlertInstanceTransition,
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
    ruleMuted: def.spec.suppressed || def.previewId !== null,
  };
}

type TransitionEvent = {
  // The id is minted here, never left to the column default: the episode
  // logic and the enqueue need it before the insert returns.
  outbox: typeof alertEvents.$inferInsert & { id: string };
  history: AlertHistoryRow;
  fingerprint: string;
  /**
   * The value `alert_instances.episode_id` takes with this transition: the
   * event that leaves inactive opens the episode, a terminal closes it.
   * `null` clears.
   */
  episodeUpdate: string | null;
};

// One row per instance transition: the journal event it writes, the stream it
// belongs to, whether it closes the chain, and the close reason a terminal
// carries. `state` rows are born processed and never delivered. Keyed over
// the closed transition vocabulary, so a new transition cannot ship without
// declaring its full shape here.
const TRANSITION_SHAPE = {
  pending: {
    eventType: "instance_pending",
    kind: "state",
    terminal: false,
    reason: undefined,
  },
  firing: {
    eventType: "instance_fired",
    kind: "notifying",
    terminal: false,
    reason: undefined,
  },
  resolved: {
    eventType: "instance_resolved",
    kind: "notifying",
    terminal: true,
    reason: "condition_cleared",
  },
  pending_cleared: {
    eventType: "instance_closed",
    kind: "state",
    terminal: true,
    reason: "pending_cleared",
  },
} as const;

/**
 * State-only rows are born processed: they exist to be projected, and the
 * delivery pipeline must never see them, so no process job may be enqueued
 * for them.
 */
export function shouldEnqueueProcessEvent(
  outbox: Pick<typeof alertEvents.$inferInsert, "kind">,
): boolean {
  return outbox.kind !== "state";
}

/**
 * A row that was already inactive and is still absent carries nothing new:
 * rewriting it every tick would defeat the retention cutoff on
 * `alert_instances`, since `updated_at` would never age.
 */
export function isNoopInactiveTransition(
  transition: Pick<AlertInstanceTransition, "event" | "next">,
): boolean {
  return transition.event === null && transition.next.status === "inactive";
}

export function transitionEventRows(opts: {
  def: typeof alertDefinitions.$inferSelect;
  historyDef: AlertHistoryDefinition;
  transition: AlertInstanceTransition;
  evaluatedAt: Date;
  /** The instance's open episode before this evaluation, if any. */
  storedEpisodeId: string | null;
  /**
   * Precomputed `boundEventEvidence(transition.next.evidence,
   * transition.next.labels)`, when the caller already needs it elsewhere for
   * the same transition. Computed on demand otherwise.
   */
  bounded?: { evidence: Record<string, unknown>; truncated: boolean };
}): TransitionEvent[] {
  const { def, historyDef, transition, evaluatedAt } = opts;
  if (!transition.event) return [];
  const next = transition.next;
  const bounded =
    opts.bounded ?? boundEventEvidence(next.evidence, next.labels);
  const firstRow: Record<string, unknown> = {
    ...bounded.evidence,
    ...next.labels,
    value: next.value,
  };
  // The journal row and its projection share this id, and the surface
  // promises a time-decodable id, so it must be v7.
  const id = uuidv7(evaluatedAt);
  const { eventType, kind, terminal, reason } =
    TRANSITION_SHAPE[transition.event];
  // The event that leaves inactive opens the episode with its own id: the
  // pending row when a for-duration exists, else the fired row. A fire that
  // follows a pending phase inherits the open episode, and the terminals
  // carry the episode they close.
  const opens =
    eventType === "instance_pending" ||
    (eventType === "instance_fired" && opts.storedEpisodeId === null);
  const episodeId = opens ? id : opts.storedEpisodeId;
  const notificationTitle = renderMessage(def.spec.annotations.summary ?? "", {
    firstRow,
  });
  const notificationDescription = renderMessage(
    def.spec.annotations.description ?? "",
    { firstRow },
  );
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
        kind,
        episodeId,
        reason,
        instanceFingerprint: next.fingerprint,
        instanceLabels: next.labels,
        severity: def.spec.severity,
        notificationTitle,
        notificationDescription,
        suppressed: historyDef.ruleMuted,
        occurredAt: evaluatedAt,
        ...(kind === "state" ? { processedAt: evaluatedAt } : {}),
      } satisfies typeof alertEvents.$inferInsert,
      history: instanceHistoryRow({
        def: historyDef,
        eventId: id,
        eventType,
        occurredAt: evaluatedAt,
        episodeId: episodeId ?? ZERO_UUID,
        fingerprint: next.fingerprint,
        labels: next.labels,
        evidence: bounded.evidence,
        evidenceTruncated: bounded.truncated,
        reason,
        contextJson: buildAlertContextJson({
          summary: notificationTitle,
          description: notificationDescription,
          alertLink: def.spec.annotations["link.alert"],
          runbookLink: def.spec.annotations["link.runbook"],
          condition: {
            operator: def.spec.condition.operator,
            threshold: def.spec.condition.threshold,
            value: next.value,
          },
        }),
      }),
      fingerprint: next.fingerprint,
      episodeUpdate: terminal ? null : episodeId,
    },
  ];
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
    .set({ nextEvaluationAt: runAt, lastEnqueuedAt: runAt })
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
  payload: z.infer<typeof EvaluatePayloadSchema>,
  scheduledFor: Date,
  cause: unknown,
) {
  const message = errorMessage(cause).slice(0, 8_000);
  const occurredAt = new Date();
  const applied = await db.transaction(async (tx) => {
    // Mirrors the success path's guard: a rule paused or deleted between the
    // outer read and this transaction must not be written back degraded
    // with a queued retry, and a deleted rule's id would violate the
    // alert_evaluations FK below.
    const [fresh] = await tx
      .select({
        active: alertDefinitions.active,
        version: alertDefinitions.version,
        consecutiveFailures: alertDefinitions.consecutiveFailures,
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
    const failureCount = fresh.consecutiveFailures + 1;
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
  // The kill switch has to stop chains, not only the scanner backstop:
  // evaluations reschedule themselves and applies enqueue directly, so gating
  // only the scanner sheds no load. Returning here without rescheduling ends
  // the chain; when the switch turns back on, the scanner's stale-enqueue
  // clause picks the overdue definition up again.
  if (
    def.previewId !== null &&
    !previewDefinitionsEnqueueable(env.EVERR_PREVIEW_ALERTS)
  )
    return;

  // Every terminal path from here has to advance scheduling state. The scanner
  // only selects a definition whose lastEnqueuedAt predates its
  // nextEvaluationAt, so a throw that escapes this function leaves the rule
  // enqueued-but-never-rescheduled and it goes silent for good.
  try {
    await evaluateAlertRule(def, payload, scheduledFor);
  } catch (cause) {
    await recordEvaluationFailure(def, payload, scheduledFor, cause);
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
  const present = rowsToInstances(
    rows.filter((row) => alertingConditionMatches(row, def.spec.condition)),
    def.spec.label_columns,
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
  // Matching rows first, so a rule with more than the sample cap's worth of
  // label sets never buries the breaching ones under healthy filler and the
  // series doesn't miss a breach that paged someone.
  const capturedSamples = captureAlertEvaluationSamples(
    rows,
    def.spec.label_columns,
    new Set(presentByFingerprint.keys()),
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

  const storedEpisodeByFingerprint = new Map(
    previousRows.map((row) => [row.fingerprint, row.episodeId]),
  );
  const historyDef = historyDefinition(def);
  // Computed once per transition and reused for both the journal row below
  // and the instance upsert further down, instead of recomputing the same
  // bound evidence twice from the same inputs.
  const boundedEvidenceByFingerprint = new Map(
    transitions
      .filter((transition) => !isNoopInactiveTransition(transition))
      .map((transition) => [
        transition.next.fingerprint,
        boundEventEvidence(transition.next.evidence, transition.next.labels),
      ]),
  );
  const transitionEvents = transitions.flatMap((transition) =>
    transitionEventRows({
      def,
      historyDef,
      transition,
      evaluatedAt,
      storedEpisodeId:
        storedEpisodeByFingerprint.get(transition.next.fingerprint) ?? null,
      bounded: boundedEvidenceByFingerprint.get(transition.next.fingerprint),
    }),
  );
  const episodeUpdateByFingerprint = new Map(
    transitionEvents.map((event) => [event.fingerprint, event.episodeUpdate]),
  );

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
      if (isNoopInactiveTransition(transition)) continue;
      const next = transition.next;
      const boundedInstanceEvidence = boundedEvidenceByFingerprint.get(
        next.fingerprint,
      );
      // Every non-skipped transition got an entry above, keyed by the same
      // fingerprint.
      if (!boundedInstanceEvidence) {
        throw new Error(
          `missing bounded evidence for fingerprint ${next.fingerprint}`,
        );
      }
      // Only a transition moves the episode; a quiet evaluation must not
      // clear an open one.
      const episodeUpdate = episodeUpdateByFingerprint.get(next.fingerprint);
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
          episodeId: episodeUpdate ?? null,
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
            ...(episodeUpdate === undefined
              ? {}
              : { episodeId: episodeUpdate }),
          },
        });
    }

    const firing = transitions.filter((item) => item.next.status === "firing");
    const pending = transitions.filter(
      (item) => item.next.status === "pending",
    );
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
        currentState:
          firing.length > 0
            ? "firing"
            : pending.length > 0
              ? "pending"
              : "resolved",
        lastFiredAt: fired.length > 0 ? evaluatedAt : def.lastFiredAt,
        lastResolvedAt: resolved.length > 0 ? evaluatedAt : def.lastResolvedAt,
      })
      .where(eq(alertDefinitions.id, def.id));

    const eventRows = transitionEvents.map(({ outbox }) => outbox);
    if (eventRows.length > 0) {
      await tx.insert(alertEvents).values(eventRows);
      for (const outbox of eventRows.filter(shouldEnqueueProcessEvent)) {
        await enqueueProcessAlertEvent(tx, outbox.id);
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
