import { and, eq, gt, lte } from "drizzle-orm";
import {
  alertingMatchingSilence,
  alertingRouteMatches,
  alertingSyntheticLabels,
} from "@/data/alerting/routing/resolution";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingSloTierSeverity,
} from "@/data/alerting/slos/model";
import { db } from "@/db/client";
import {
  alertDefinitions,
  alertEvents,
  alertInhibitions,
  alertInstances,
  alertSilences,
  sloAlertInstances,
  sloDefinitions,
} from "@/db/schema";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
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
  if (event.sourceKind === "alert") {
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
  if (event.sourceKind === "slo") {
    const [row] = await db
      .select({ id: sloAlertInstances.id })
      .from(sloAlertInstances)
      .where(
        and(
          eq(sloAlertInstances.organizationId, event.organizationId),
          eq(sloAlertInstances.sloDefinitionId, event.sourceDefinitionId),
          eq(sloAlertInstances.tier, event.instanceFingerprint),
          eq(sloAlertInstances.status, "firing"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  return false;
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
}

export async function isInhibited(event: typeof alertEvents.$inferSelect) {
  if (event.eventType === "instance_resolved") return false;
  const inhibitions = await db
    .select()
    .from(alertInhibitions)
    .where(eq(alertInhibitions.organizationId, event.organizationId));
  const [ruleSources, sloSources] = await Promise.all([
    db
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
      ),
    db
      .select({ instance: sloAlertInstances, slo: sloDefinitions })
      .from(sloAlertInstances)
      .innerJoin(
        sloDefinitions,
        eq(sloAlertInstances.sloDefinitionId, sloDefinitions.id),
      )
      .where(
        and(
          eq(sloAlertInstances.organizationId, event.organizationId),
          eq(sloAlertInstances.status, "firing"),
        ),
      ),
  ]);
  const sources = [
    ...ruleSources.map(({ instance, def }) =>
      alertingSyntheticLabels(instance.labels, {
        severity: def.spec.severity,
        status: "firing",
        rule: def.id,
      }),
    ),
    ...sloSources.map(({ instance, slo }) =>
      alertingSyntheticLabels(instance.labels, {
        severity: alertingSloTierSeverity(
          ALERTING_CANONICAL_SLO_TIERS,
          instance.labels,
        ),
        status: "firing",
        rule: slo.id,
        slo: slo.id,
      }),
    ),
  ];
  const target = alertEventDispatchLabels(event);
  if (
    event.sourceKind === "slo" &&
    event.instanceLabels.slo_tier === "ticket" &&
    sloSources.some(
      ({ instance, slo }) =>
        slo.id === event.sourceDefinitionId &&
        alertingSloTierSeverity(
          ALERTING_CANONICAL_SLO_TIERS,
          instance.labels,
        ) === "critical",
    )
  ) {
    return true;
  }
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
