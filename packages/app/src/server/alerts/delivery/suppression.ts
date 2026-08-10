import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
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
import {
  recordAlertHistory,
  suppressionHistoryRow,
} from "../history/clickhouse";
import { alertEventDispatchLabels } from "./targeting";
import { enqueueProcessAlertEvent } from "./tasks";

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
  const claimed = await db.transaction(async (tx) => {
    const stamped = await tx
      .update(alertEvents)
      .set({
        silenced: Boolean(silence),
        silenceId: silence?.id ?? null,
        inhibited,
        processedAt: shouldRetry ? null : now,
      })
      // This write is a claim, like the dispatch stamp: a concurrent pause or
      // delete cancels through `processed_at IS NULL` and projects the chain's
      // terminal, and an unguarded defer would overwrite that stamp, revive
      // the canceled event or write a second terminal. Matching the value this
      // processor read keeps exactly one owner: the process path read NULL,
      // the flush path read its own dispatch stamp, and a cancel's stamp
      // matches neither.
      .where(
        and(
          eq(alertEvents.id, event.id),
          event.processedAt === null
            ? isNull(alertEvents.processedAt)
            : eq(alertEvents.processedAt, event.processedAt),
        ),
      )
      .returning({ id: alertEvents.id });
    if (stamped.length === 0) return false;
    if (shouldRetry) {
      const runAt = silence
        ? new Date(silence.ends_at)
        : new Date(now.getTime() + 60_000);
      await enqueueProcessAlertEvent(tx, event.id, {
        keySuffix: runAt.toISOString(),
        runAt,
      });
    }
    return true;
  });
  // The cancel that won the claim owns the terminal; recording one here too
  // would put two suppression rows on one chain.
  if (!claimed) return;
  // Only a terminal suppression is a fact. A deferred event will be
  // reconsidered when the silence lapses, so recording it now would claim a
  // notification was withheld that may still go out.
  if (shouldRetry) return;
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
        // Sources must come from the same world as the target: live rules for
        // live events, and only the same preview for preview events. A firing
        // preview instance must not mute a live alert. Muted rules stay valid
        // sources on purpose: a muted root cause still holds its dependents.
        sql`${alertDefinitions.previewId} IS NOT DISTINCT FROM ${event.previewId}`,
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
