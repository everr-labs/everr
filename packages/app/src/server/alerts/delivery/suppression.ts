import { and, eq, gt, lte } from "drizzle-orm";
import {
  alertingMatchingSilence,
  alertingRouteMatches,
  alertingSyntheticLabels,
} from "@/data/alerting/routing/resolution";
import { db } from "@/db/client";
import {
  alertDefinitions,
  alertEvents,
  alertInhibitions,
  alertInstances,
  alertSilences,
} from "@/db/schema";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import {
  recordAlertHistory,
  suppressionHistoryRow,
} from "../history/clickhouse";
import { alertServiceFallback } from "../history/content";
import { alertEventDispatchLabels } from "./targeting";
import { ALERT_PROCESS_EVENT_TASK } from "./tasks";

export async function matchingSilence(
  event: typeof alertEvents.$inferSelect,
  now: Date,
) {
  const silences = await db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, event.organizationId),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
      ),
    );
  return alertingMatchingSilence(
    alertEventDispatchLabels(event),
    silences.map((silence) => ({
      ...silence,
      starts_at: silence.startsAt.toISOString(),
      ends_at: silence.endsAt.toISOString(),
    })),
    now.getTime(),
  );
}

export async function eventStillFiring(event: typeof alertEvents.$inferSelect) {
  if (event.eventType === "instance_resolved") return false;
  const [row] = await db
    .select({ id: alertInstances.id })
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.organizationId, event.organizationId),
        eq(alertInstances.alertDefinitionId, event.sourceDefinitionId),
        eq(alertInstances.fingerprint, event.instanceFingerprint),
        eq(alertInstances.status, "firing"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function deferSuppressedEvent(
  event: typeof alertEvents.$inferSelect,
  silence: Awaited<ReturnType<typeof matchingSilence>>,
  inhibited: boolean,
  now: Date,
) {
  const shouldRetry =
    event.eventType !== "instance_resolved" && (await eventStillFiring(event));
  await db.transaction(async (tx) => {
    await tx
      .update(alertEvents)
      .set({
        silenced: Boolean(silence),
        silenceId: silence?.id ?? null,
        inhibited,
        processedAt: shouldRetry ? null : now,
      })
      .where(eq(alertEvents.id, event.id));
    if (!shouldRetry) return;
    const runAt = silence
      ? new Date(silence.ends_at)
      : new Date(now.getTime() + 60_000);
    await addWorkerJobInTransaction(
      tx,
      ALERT_PROCESS_EVENT_TASK,
      { eventId: event.id },
      {
        jobKey: `${ALERT_PROCESS_EVENT_TASK}:${event.id}:${runAt.toISOString()}`,
        jobKeyMode: "replace",
        maxAttempts: 5,
        runAt,
      },
    );
  });
  // Only a terminal suppression is a fact. A deferred event will be
  // reconsidered when the silence lapses, so recording it now would claim a
  // notification was withheld that may still go out.
  if (shouldRetry) return;
  // The journal row does not carry the rule's annotations; a rule deleted in
  // the meantime falls back to the `alert` marker.
  const [rule] = await db
    .select({ spec: alertDefinitions.spec })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, event.organizationId),
        eq(alertDefinitions.id, event.sourceDefinitionId),
      ),
    )
    .limit(1);
  await recordAlertHistory(event.sourceDefinitionId, [
    suppressionHistoryRow({
      def: {
        id: event.sourceDefinitionId,
        organizationId: event.organizationId,
        repoid: event.repoid,
        slug: event.slug,
        previewId: event.previewId,
        severity: event.severity,
        ruleMuted: event.suppressed,
        serviceFallback: alertServiceFallback(rule?.spec.annotations ?? {}),
      },
      notificationEventId: event.id,
      occurredAt: now,
      fingerprint: event.instanceFingerprint,
      labels: event.instanceLabels,
      silenced: Boolean(silence),
      inhibited,
      silenceId: silence?.id ?? null,
    }),
  ]);
}

export async function isInhibited(event: typeof alertEvents.$inferSelect) {
  if (event.eventType === "instance_resolved") return false;
  const inhibitions = await db
    .select()
    .from(alertInhibitions)
    .where(eq(alertInhibitions.organizationId, event.organizationId));
  const ruleSources = await db
    .select({ instance: alertInstances, def: alertDefinitions })
    .from(alertInstances)
    .innerJoin(
      alertDefinitions,
      eq(alertInstances.alertDefinitionId, alertDefinitions.id),
    )
    .where(
      and(
        eq(alertInstances.organizationId, event.organizationId),
        eq(alertInstances.status, "firing"),
      ),
    );
  const sources = ruleSources.map(({ instance, def }) =>
    alertingSyntheticLabels(instance.labels, {
      severity: def.spec.severity,
      status: "firing",
      rule: def.id,
    }),
  );
  const target = alertEventDispatchLabels(event);
  return inhibitions.some(({ config }) => {
    if (!alertingRouteMatches(config.target_matchers, target)) return false;
    return sources.some(
      (source) =>
        alertingRouteMatches(config.source_matchers, source) &&
        config.equal.every(
          (key) => (source[key] ?? "") === (target[key] ?? ""),
        ),
    );
  });
}
