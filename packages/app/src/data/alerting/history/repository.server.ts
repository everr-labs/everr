import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { query } from "@/lib/clickhouse";
import {
  type AlertingLifecycleReason,
  isAlertingLifecycleReason,
} from "../vocabulary";
import { clickhouseIsoMillis } from "./clickhouse";
import {
  ALERT_OUTCOME_EVENT_TYPES_SQL,
  ALERT_TRANSITION_EVENT_TYPES_SQL,
  type AlertTransitionEventType,
} from "./event-types";

// Per-query, not a client default (@/lib/clickhouse.query is shared with
// dashboards, where a global cap could break a long-running scan): every
// query in this file is a bounded alerting history read, so 30s is a bug, not
// a legitimate slow query.
const ALERTING_QUERY_SETTINGS = { max_execution_time: 30 };

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
  eventType: AlertTransitionEventType;
  slug: string;
  instanceFingerprint: string;
  labels: Record<string, string>;
  severity: string;
  suppressed: boolean;
  silenced: boolean;
  inhibited: boolean;
  /** Why a terminal row ended its instance; empty off terminals. */
  reason: AlertingLifecycleReason | "";
  deliveryTargets: string[];
  evidence: AlertEvidence | null;
  evidenceTruncated: boolean;
};

type ClickHouseAlertEventRow = {
  eventId: string;
  timestamp: string;
  eventType: AlertTransitionEventType;
  slug: string;
  instanceFingerprint: string;
  labels: Record<string, string>;
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
    ALERTING_QUERY_SETTINGS,
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
    /**
     * The sort key is (tenant_id, repoid, slug, ...), so a per-rule read
     * (one known repoid) should always supply this: without it, the read
     * falls back to a generic exclusion search past the repoid prefix. Leave
     * unset only for a caller that genuinely spans repos (org-wide history).
     */
    repoid?: string;
    /** null selects live events; an array selects those previews' events. */
    previewIds: readonly string[] | null;
    /**
     * The repoids those previews cover. Live events of a covered repo are the
     * ones the preview replaces, so they drop out: the rules that raised them
     * are not the rules the branch would run.
     */
    coveredRepoids?: readonly string[];
  },
): Promise<AlertEventLogRow[]> {
  const filters = [
    "tenant_id = {organizationId:String}",
    `event_type IN (${ALERT_TRANSITION_EVENT_TYPES_SQL})`,
    "event_time >= {from:DateTime64(3)}",
    "event_time <= {to:DateTime64(3)}",
  ];
  // A definition id already names one side of the overlay, so scoping by it
  // answers the live-or-preview question on its own. Asking again would drop
  // every event a preview definition ever wrote, since none of them are live.
  if (opts.sourceId === undefined) {
    // No previews asked for, and an empty list, mean the same thing: live only.
    filters.push(
      opts.previewIds?.length
        ? "(preview_id IN {previewIds:Array(UUID)} OR (is_live AND repoid NOT IN {coveredRepoids:Array(String)}))"
        : "is_live",
    );
  }
  if (opts.repoid !== undefined) {
    filters.push("repoid = {repoid:String}");
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
        instance_labels AS labels,
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
      ...(opts.previewIds?.length
        ? {
            previewIds: [...opts.previewIds],
            coveredRepoids: [...(opts.coveredRepoids ?? [])],
          }
        : {}),
      ...(opts.repoid !== undefined ? { repoid: opts.repoid } : {}),
      ...(opts.fingerprint !== undefined
        ? { fingerprint: opts.fingerprint }
        : {}),
      ...(opts.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
      ...(opts.slugs !== undefined ? { slugs: [...opts.slugs] } : {}),
    },
    ALERTING_QUERY_SETTINGS,
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
      labels: row.labels,
      severity: row.severity,
      suppressed: Boolean(row.suppressed),
      silenced: outcome?.silenced ?? false,
      inhibited: outcome?.inhibited ?? false,
      reason: isAlertingLifecycleReason(row.reason) ? row.reason : "",
      deliveryTargets: outcome?.deliveryTargets ?? [],
      evidence: parseJsonObject(row.evidenceJson),
      evidenceTruncated: Boolean(row.evidenceTruncated),
    };
  });
}

// Shared by both label-suggestion queries: recent, unmuted instance labels,
// the population the suggestion ranks over.
const OBSERVED_LABEL_FILTERS = `
        tenant_id = {organizationId:String}
        AND event_type IN ('instance_fired', 'instance_resolved')
        AND rule_muted = false
        AND event_time >= {from:DateTime64(3)}
        AND event_time <= {to:DateTime64(3)}`;

/**
 * Rank observed label keys (or, given `key`, values for that key) by
 * frequency in ClickHouse rather than pulling up to 10,000 label blobs into
 * Node to count there. `arrayJoin` explodes each row's keys before the
 * `GROUP BY`, so `count()` ranks over rows, not blobs.
 */
export async function queryClickHouseObservedLabelKeys(
  organizationId: string,
  opts: { limit: number; from: Date; to: Date },
): Promise<string[]> {
  const rows = await query<{ key: string }>(
    `
      SELECT arrayJoin(mapKeys(instance_labels)) AS key
      FROM app.alert_events
      WHERE ${OBSERVED_LABEL_FILTERS}
      GROUP BY key
      ORDER BY count() DESC, key ASC
      LIMIT {limit:UInt32}
    `,
    organizationId,
    {
      organizationId,
      from: toClickHouseDateTime(opts.from),
      to: toClickHouseDateTime(opts.to),
      limit: opts.limit,
    },
    ALERTING_QUERY_SETTINGS,
  );
  return rows.map((row) => row.key);
}

export async function queryClickHouseObservedLabelValues(
  organizationId: string,
  key: string,
  opts: { limit: number; from: Date; to: Date },
): Promise<string[]> {
  const rows = await query<{ value: string }>(
    `
      SELECT instance_labels[{key:String}] AS value
      FROM app.alert_events
      WHERE ${OBSERVED_LABEL_FILTERS}
        AND has(instance_labels, {key:String})
      GROUP BY value
      ORDER BY count() DESC, value ASC
      LIMIT {limit:UInt32}
    `,
    organizationId,
    {
      organizationId,
      key,
      from: toClickHouseDateTime(opts.from),
      to: toClickHouseDateTime(opts.to),
      limit: opts.limit,
    },
    ALERTING_QUERY_SETTINGS,
  );
  return rows.map((row) => row.value);
}
