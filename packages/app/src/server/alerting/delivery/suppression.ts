import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { enqueueProcessAlertEvent } from "@/data/alerting/delivery/tasks";
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
import { journalTerminalRow, recordAlertHistory } from "../history/clickhouse";
import { instanceKey } from "./grouping";
import { alertEventDispatchLabels } from "./targeting";

export type ActiveSilence = Awaited<
  ReturnType<typeof loadActiveSilences>
>[number];

/**
 * How long a deferred event waits before an inhibition is reconsidered.
 *
 * A silence carries its own end time, so a silenced event is scheduled for
 * exactly that moment and wakes once. An inhibition has no end time: it ends
 * when the source instance stops firing, and nothing notifies this job of that
 * state change, so the only way to notice is to look again. This is that poll
 * period, and it is unrelated to any rule's `evaluationInterval`: it bounds how
 * late a released notification goes out, not how often the condition is
 * measured.
 */
export const INHIBITION_RECHECK_SECONDS = 60;

/**
 * Every silence active for the org right now. Load once per batch of events
 * being evaluated and pass the result to `matchSilence`, rather than
 * re-querying per event: a flush evaluating hundreds of members must not
 * issue hundreds of identical org-wide scans.
 */
export async function loadActiveSilences(organizationId: string, now: Date) {
  const silences = await db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
      ),
    );
  return silences.map((silence) => ({
    ...silence,
    starts_at: silence.startsAt.toISOString(),
    ends_at: silence.endsAt.toISOString(),
  }));
}

export function matchSilence(
  event: typeof alertEvents.$inferSelect,
  silences: ActiveSilence[],
  now: Date,
) {
  return alertingMatchingSilence(
    alertEventDispatchLabels(event),
    silences,
    now.getTime(),
  );
}

export async function matchingSilence(
  event: typeof alertEvents.$inferSelect,
  now: Date,
) {
  return matchSilence(
    event,
    await loadActiveSilences(event.organizationId, now),
    now,
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

/**
 * Which of `events` have an instance that is firing right now, as a set of
 * `instanceKey`s. Load once per batch rather than calling `eventStillFiring`
 * per member: a flush weighing hundreds of members must not issue hundreds of
 * single-row lookups.
 *
 * The two `IN` lists are a cross product, so a firing instance that no caller
 * asked about can enter the set. That is harmless: the set is keyed on the
 * pair, so an unasked key never matches a member, and a member matches only
 * when its own definition and fingerprint really are firing.
 */
export async function loadFiringInstanceKeys(
  organizationId: string,
  events: Pick<
    typeof alertEvents.$inferSelect,
    "sourceDefinitionId" | "instanceFingerprint"
  >[],
): Promise<Set<string>> {
  if (events.length === 0) return new Set();
  const rows = await db
    .select({
      alertDefinitionId: alertInstances.alertDefinitionId,
      fingerprint: alertInstances.fingerprint,
    })
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.organizationId, organizationId),
        eq(alertInstances.status, "firing"),
        inArray(alertInstances.alertDefinitionId, [
          ...new Set(events.map((event) => event.sourceDefinitionId)),
        ]),
        inArray(alertInstances.fingerprint, [
          ...new Set(events.map((event) => event.instanceFingerprint)),
        ]),
      ),
    );
  return new Set(
    rows.map((row) =>
      instanceKey({
        sourceDefinitionId: row.alertDefinitionId,
        instanceFingerprint: row.fingerprint,
      }),
    ),
  );
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
        : new Date(now.getTime() + INHIBITION_RECHECK_SECONDS * 1_000);
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
    journalTerminalRow(event, {
      silenced: Boolean(silence),
      inhibited,
      silenceId: silence?.id ?? null,
    }),
  ]);
}

export type InhibitionContext = Awaited<
  ReturnType<typeof loadInhibitionContext>
>;

/**
 * Every inhibition rule and every firing instance for the org right now, for
 * `matchInhibition` to evaluate in memory. Load once per batch rather than
 * per event: `isInhibited` used to run this pair of org-wide scans for every
 * single member a flush considered.
 */
export async function loadInhibitionContext(organizationId: string): Promise<{
  inhibitions: (typeof alertInhibitions.$inferSelect)[];
  sources: { previewId: string | null; labels: Record<string, string> }[];
}> {
  const inhibitions = await db
    .select()
    .from(alertInhibitions)
    .where(eq(alertInhibitions.organizationId, organizationId));
  // `matchInhibition` answers false with no rules configured, which is the
  // default state, so the org-wide firing-instance scan below would be pure
  // waste. It is also widest exactly when it hurts most: during a storm.
  if (inhibitions.length === 0) return { inhibitions, sources: [] };
  const ruleSources = await db
    .select({ instance: alertInstances, def: alertDefinitions })
    .from(alertInstances)
    .innerJoin(
      alertDefinitions,
      eq(alertInstances.alertDefinitionId, alertDefinitions.id),
    )
    .where(
      and(
        eq(alertInstances.organizationId, organizationId),
        eq(alertInstances.status, "firing"),
      ),
    );
  return {
    inhibitions,
    sources: ruleSources.map(({ instance, def }) => ({
      previewId: def.previewId,
      labels: alertingSyntheticLabels(instance.labels, {
        severity: def.spec.severity,
        status: "firing",
        rule: def.id,
      }),
    })),
  };
}

export function matchInhibition(
  event: typeof alertEvents.$inferSelect,
  context: InhibitionContext,
): boolean {
  if (event.eventType === "instance_resolved") return false;
  const target = alertEventDispatchLabels(event);
  return context.inhibitions.some(({ config }) => {
    if (!alertingRouteMatches(config.target_matchers, target)) return false;
    return context.sources.some(
      (source) =>
        // Sources must come from the same world as the target: live rules
        // for live events, and only the same preview for preview events. A
        // firing preview instance must not mute a live alert. Muted rules
        // stay valid sources on purpose: a muted root cause still holds its
        // dependents.
        source.previewId === event.previewId &&
        alertingRouteMatches(config.source_matchers, source.labels) &&
        config.equal.every(
          (key) => (source.labels[key] ?? "") === (target[key] ?? ""),
        ),
    );
  });
}

export async function isInhibited(event: typeof alertEvents.$inferSelect) {
  if (event.eventType === "instance_resolved") return false;
  return matchInhibition(
    event,
    await loadInhibitionContext(event.organizationId),
  );
}
