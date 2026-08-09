import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { query } from "@/lib/clickhouse";
import { clickhouseIsoMillis } from "./clickhouse";
import {
  ALERT_OUTCOME_EVENT_TYPES_SQL,
  ALERT_TRANSITION_EVENT_TYPES_SQL,
  type AlertEventType,
} from "./event-types";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AlertEvidence = { [key: string]: JsonValue };

export type AlertEventLogRow = {
  timestamp: string;
  eventType: AlertEventType;
  slug: string;
  instanceFingerprint: string;
  labels: Record<string, string>;
  severity: string;
  suppressed: boolean;
  silenced: boolean;
  inhibited: boolean;
  /** Why a terminal row ended its instance; empty off terminals. */
  reason: string;
  deliveryTargets: string[];
  evidence: AlertEvidence | null;
  evidenceTruncated: boolean;
};

type ClickHouseAlertEventRow = {
  eventId: string;
  timestamp: string;
  eventType: AlertEventType;
  slug: string;
  instanceFingerprint: string;
  labelsJson: string;
  severity: string;
  suppressed: boolean;
  reason: string;
  evidenceJson: string;
  evidenceTruncated: boolean;
};

function parseJsonObject(json: string): Record<string, JsonValue> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, JsonValue>;
    }
  } catch {
    // Malformed evidence must not hide the rest of an event.
  }
  return {};
}

function parseLabels(json: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parseJsonObject(json)).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
}

type NotificationOutcome = {
  silenced: boolean;
  inhibited: boolean;
  deliveryTargets: string[];
};

/**
 * Fold the suppression and delivery rows a transition produced back onto it.
 *
 * These are written by later jobs, so they are separate rows correlated by
 * `notification_event_id` rather than columns on the transition. Reading them
 * from ClickHouse rather than PostgreSQL is what keeps the whole history answer
 * available to `everr cloud query`.
 *
 * No upper time bound: an outcome always lands at or after its transition, and
 * a silence can defer one for as long as the silence lasts. The lower bound
 * still prunes partitions, and `notification_event_id` carries a bloom index.
 */
async function queryNotificationOutcomes(
  organizationId: string,
  eventIds: readonly string[],
  from: Date,
): Promise<Map<string, NotificationOutcome>> {
  type OutcomeRow = {
    eventId: string;
    silenced: boolean;
    inhibited: boolean;
    deliveryTargets: string[];
  };
  const rows = await query<OutcomeRow>(
    `
      SELECT
        toString(notification_event_id) AS eventId,
        max(silenced) AS silenced,
        max(inhibited) AS inhibited,
        arraySort(arrayDistinct(arrayFlatten(groupArray(
          if(event_type = 'delivery_succeeded', arrayFlatten(mapValues(delivery_targets)), [])
        )))) AS deliveryTargets
      FROM app.alert_events
      WHERE tenant_id = {organizationId:String}
        AND event_type IN (${ALERT_OUTCOME_EVENT_TYPES_SQL})
        AND event_time >= {from:DateTime64(3)}
        AND notification_event_id IN {eventIds:Array(UUID)}
      GROUP BY notification_event_id
    `,
    organizationId,
    {
      organizationId,
      from: toClickHouseDateTime(from),
      eventIds: [...eventIds],
    },
  );
  return new Map(
    rows.map((row) => [
      row.eventId,
      {
        silenced: Boolean(row.silenced),
        inhibited: Boolean(row.inhibited),
        deliveryTargets: row.deliveryTargets,
      },
    ]),
  );
}

export async function queryClickHouseAlertEventLog(
  organizationId: string,
  opts: {
    limit: number;
    from: Date;
    to: Date;
    fingerprint?: string;
    sourceId?: string;
    slugs?: readonly string[];
    /** null selects live events; an array overlays those Preview ids on live. */
    previewIds: readonly string[] | null;
  },
): Promise<AlertEventLogRow[]> {
  const filters = [
    "tenant_id = {organizationId:String}",
    `event_type IN (${ALERT_TRANSITION_EVENT_TYPES_SQL})`,
    "event_time >= {from:DateTime64(3)}",
    "event_time <= {to:DateTime64(3)}",
  ];
  if (opts.previewIds === null) {
    filters.push(
      "preview_id = toUUID('00000000-0000-0000-0000-000000000000')",
      "rule_muted = false",
    );
  } else if (opts.previewIds.length === 0) {
    filters.push("preview_id = toUUID('00000000-0000-0000-0000-000000000000')");
  } else {
    filters.push(
      "(preview_id = toUUID('00000000-0000-0000-0000-000000000000') OR preview_id IN {previewIds:Array(UUID)})",
    );
  }
  if (opts.fingerprint !== undefined) {
    filters.push("instance_fingerprint = {fingerprint:String}");
  }
  if (opts.sourceId !== undefined) {
    filters.push("alert_definition_id = {sourceId:UUID}");
  }
  if (opts.slugs !== undefined) {
    filters.push("slug IN {slugs:Array(String)}");
  }

  const rows = await query<ClickHouseAlertEventRow>(
    `
      SELECT
        toString(event_id) AS eventId,
        ${clickhouseIsoMillis("event_time")} AS timestamp,
        event_type AS eventType,
        slug,
        instance_fingerprint AS instanceFingerprint,
        toJSONString(instance_labels) AS labelsJson,
        severity,
        rule_muted AS suppressed,
        reason,
        evidence_json AS evidenceJson,
        evidence_truncated AS evidenceTruncated
      FROM app.alert_events
      WHERE ${filters.join("\n        AND ")}
      ORDER BY event_time DESC, event_id DESC
      LIMIT {limit:UInt32}
    `,
    organizationId,
    {
      organizationId,
      from: toClickHouseDateTime(opts.from),
      to: toClickHouseDateTime(opts.to),
      limit: opts.limit,
      ...(opts.previewIds?.length ? { previewIds: [...opts.previewIds] } : {}),
      ...(opts.fingerprint !== undefined
        ? { fingerprint: opts.fingerprint }
        : {}),
      ...(opts.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
      ...(opts.slugs !== undefined ? { slugs: [...opts.slugs] } : {}),
    },
  );

  if (rows.length === 0) return [];
  const outcomes = await queryNotificationOutcomes(
    organizationId,
    rows.map((row) => row.eventId),
    opts.from,
  );

  return rows.map((row) => {
    const outcome = outcomes.get(row.eventId);
    return {
      timestamp: row.timestamp,
      eventType: row.eventType,
      slug: row.slug,
      instanceFingerprint: row.instanceFingerprint,
      labels: parseLabels(row.labelsJson),
      severity: row.severity,
      suppressed: Boolean(row.suppressed),
      silenced: outcome?.silenced ?? false,
      inhibited: outcome?.inhibited ?? false,
      reason: row.reason,
      deliveryTargets: outcome?.deliveryTargets ?? [],
      evidence: parseJsonObject(row.evidenceJson),
      evidenceTruncated: Boolean(row.evidenceTruncated),
    };
  });
}

async function recentClickHouseLabels(
  organizationId: string,
  opts: { from: Date; to: Date },
) {
  return query<{ labelsJson: string }>(
    `
      SELECT toJSONString(instance_labels) AS labelsJson
      FROM app.alert_events
      WHERE tenant_id = {organizationId:String}
        AND event_type IN ('instance_fired', 'instance_resolved')
        AND rule_muted = false
        AND event_time >= {from:DateTime64(3)}
        AND event_time <= {to:DateTime64(3)}
      ORDER BY event_time DESC
      LIMIT 10000
    `,
    organizationId,
    {
      organizationId,
      from: toClickHouseDateTime(opts.from),
      to: toClickHouseDateTime(opts.to),
    },
  );
}

export async function queryClickHouseObservedLabelKeys(
  organizationId: string,
  opts: { limit: number; from: Date; to: Date },
): Promise<string[]> {
  const counts = new Map<string, number>();
  for (const row of await recentClickHouseLabels(organizationId, opts)) {
    for (const key of Object.keys(parseLabels(row.labelsJson))) {
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

export async function queryClickHouseObservedLabelValues(
  organizationId: string,
  key: string,
  opts: { limit: number; from: Date; to: Date },
): Promise<string[]> {
  const counts = new Map<string, number>();
  for (const row of await recentClickHouseLabels(organizationId, opts)) {
    const value = parseLabels(row.labelsJson)[key];
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
