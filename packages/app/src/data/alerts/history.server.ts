import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { alertDeliveries, alertDeliveryEvents, alertEvents } from "@/db/schema";
import type { AlertEventType } from "./event-types";

// An explicit JSON type keeps evidence serializable across server functions.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// Source-row evidence stored with an alert transition.
export type AlertEvidence = { [key: string]: JsonValue };

// One row of the rule-agnostic alerting event log (all slugs, all event types).
export type AlertEventLogRow = {
  timestamp: string;
  // The event-type vocabulary lives in ./event-types.
  eventType: AlertEventType;
  slug: string; // The source's first-class project/slug name.
  instanceFingerprint: string;
  labels: Record<string, string>;
  severity: string;
  suppressed: boolean;
  silenced: boolean;
  inhibited: boolean;
  deliveryTargets: string[];
  evidence: AlertEvidence | null;
  evidenceTruncated: boolean;
};

export async function queryPostgresAlertEventLog(
  organizationId: string,
  opts: {
    limit: number;
    from: Date;
    to: Date;
    fingerprint?: string;
    slugs?: readonly string[];
    /** null selects live events; an array overlays those Preview ids on live. */
    previewIds: readonly string[] | null;
  },
): Promise<AlertEventLogRow[]> {
  const filters = [
    eq(alertEvents.organizationId, organizationId),
    gte(alertEvents.occurredAt, opts.from),
    lte(alertEvents.occurredAt, opts.to),
  ];
  if (opts.previewIds === null) {
    filters.push(isNull(alertEvents.previewId));
    filters.push(eq(alertEvents.suppressed, false));
  } else if (opts.previewIds.length === 0) {
    filters.push(isNull(alertEvents.previewId));
  } else {
    const previewScope = or(
      isNull(alertEvents.previewId),
      inArray(alertEvents.previewId, [...opts.previewIds]),
    );
    if (previewScope) filters.push(previewScope);
  }
  if (opts.fingerprint !== undefined) {
    filters.push(eq(alertEvents.instanceFingerprint, opts.fingerprint));
  }
  if (opts.slugs !== undefined) {
    filters.push(inArray(alertEvents.slug, [...opts.slugs]));
  }
  const rows = await db
    .select()
    .from(alertEvents)
    .where(and(...filters))
    .orderBy(desc(alertEvents.occurredAt))
    .limit(opts.limit);
  const targetRows =
    rows.length === 0
      ? []
      : await db
          .select({
            eventId: alertDeliveryEvents.eventId,
            channelName: alertDeliveries.channelName,
          })
          .from(alertDeliveryEvents)
          .innerJoin(
            alertDeliveries,
            and(
              eq(
                alertDeliveryEvents.organizationId,
                alertDeliveries.organizationId,
              ),
              eq(
                alertDeliveryEvents.deliveryDedupKey,
                alertDeliveries.dedupKey,
              ),
            ),
          )
          .where(
            and(
              eq(alertDeliveryEvents.organizationId, organizationId),
              eq(alertDeliveries.status, "sent"),
              inArray(
                alertDeliveryEvents.eventId,
                rows.map((row) => row.id),
              ),
            ),
          );
  const targetsByEvent = new Map<string, Set<string>>();
  for (const target of targetRows) {
    const names = targetsByEvent.get(target.eventId) ?? new Set<string>();
    names.add(target.channelName);
    targetsByEvent.set(target.eventId, names);
  }
  return rows.map((row) => ({
    timestamp: row.occurredAt.toISOString(),
    eventType: row.eventType as AlertEventType,
    slug: row.slug,
    instanceFingerprint: row.instanceFingerprint,
    labels: row.instanceLabels,
    severity: row.severity,
    suppressed: row.suppressed,
    silenced: row.silenced,
    inhibited: row.inhibited,
    deliveryTargets: [...(targetsByEvent.get(row.id) ?? [])].sort(),
    evidence: (row.evidence as AlertEvidence | null) ?? null,
    evidenceTruncated: row.evidenceTruncated,
  }));
}

async function recentPostgresLabels(
  organizationId: string,
  opts: { from: Date; to: Date },
) {
  return db
    .select({ labels: alertEvents.instanceLabels })
    .from(alertEvents)
    .where(
      and(
        eq(alertEvents.organizationId, organizationId),
        eq(alertEvents.suppressed, false),
        gte(alertEvents.occurredAt, opts.from),
        lte(alertEvents.occurredAt, opts.to),
      ),
    )
    .orderBy(desc(alertEvents.occurredAt))
    .limit(10_000);
}

export async function queryPostgresObservedLabelKeys(
  organizationId: string,
  opts: { limit: number; from: Date; to: Date },
): Promise<string[]> {
  const counts = new Map<string, number>();
  for (const row of await recentPostgresLabels(organizationId, opts)) {
    for (const key of Object.keys(row.labels)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(
      ([keyA, countA], [keyB, countB]) =>
        countB - countA || keyA.localeCompare(keyB),
    )
    .slice(0, opts.limit)
    .map(([key]) => key);
}

export async function queryPostgresObservedLabelValues(
  organizationId: string,
  key: string,
  opts: { limit: number; from: Date; to: Date },
): Promise<string[]> {
  const counts = new Map<string, number>();
  for (const row of await recentPostgresLabels(organizationId, opts)) {
    const value = row.labels[key];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .sort(
      ([valueA, countA], [valueB, countB]) =>
        countB - countA || valueA.localeCompare(valueB),
    )
    .slice(0, opts.limit)
    .map(([value]) => value);
}
