import type { AlertingEvaluationSample } from "@/data/alerting/types";
import type { AlertingLifecycleReason } from "@/data/alerting/vocabulary";
import { insertAdminRows } from "@/lib/clickhouse";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  capAlertLabels,
  resolveAlertServiceName,
  sanitizeAlertError,
} from "./content";
import {
  deterministicDeliveryEventId,
  deterministicSuppressionEventId,
  uuidv7,
  uuidv7Time,
} from "./ids";

export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// `evaluation_scheduled_at` means one thing: when the evaluation was due. Off
// evaluation rows it is the epoch sentinel, never a smuggled second timestamp.
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

// The single source of truth for what `event_type` can hold in ClickHouse.
// Readers (data/alerting/history/event-types.ts) type-only import this so a
// renamed or removed event type is a compile error everywhere it is
// consumed, not a silently empty query result.
export type AlertHistoryEventType =
  | "evaluation_succeeded"
  | "evaluation_failed"
  | "instance_pending"
  | "instance_fired"
  | "instance_resolved"
  | "instance_closed"
  | "notification_suppressed"
  | "delivery_succeeded"
  | "delivery_failed";

type AlertInstanceEventType =
  | "instance_pending"
  | "instance_fired"
  | "instance_resolved"
  | "instance_closed";

/**
 * Channel name to the targets it reached. Never a URL, token, or address: the
 * table is append-only with a retention TTL, so a secret written here cannot be
 * withdrawn.
 */
export type AlertDeliveryTargets = Record<string, string[]>;

export type AlertHistoryDefinition = {
  id: string;
  organizationId: string;
  repoid: string;
  slug: string;
  previewId: string | null;
  severity: string;
  /**
   * The rule never notifies at all. A preview copy is the only cause today,
   * so this equals `preview_id IS NOT NULL` on every row. It stays a column
   * of its own because the fact it states is "nothing was sent for this
   * rule", which a future reason would join rather than replace.
   */
  ruleMuted: boolean;
};

/**
 * The owning rule's identity as a journal row carries it. Journal rows are
 * self-sufficient on purpose: history rows for a paused, deleted, or raced
 * rule must never need the definition row.
 */
export function historyDefFromJournalRow(row: {
  sourceDefinitionId: string;
  organizationId: string;
  repoid: string;
  slug: string;
  previewId: string | null;
  severity: string;
  suppressed: boolean;
}): AlertHistoryDefinition {
  return {
    id: row.sourceDefinitionId,
    organizationId: row.organizationId,
    repoid: row.repoid,
    slug: row.slug,
    previewId: row.previewId,
    severity: row.severity,
    ruleMuted: row.suppressed,
  };
}

export type AlertHistoryRow = {
  event_id: string;
  notification_event_id: string;
  episode_id: string;
  tenant_id: string;
  alert_definition_id: string;
  repoid: string;
  slug: string;
  preview_id: string;
  event_type: AlertHistoryEventType;
  write_source: "live";
  evaluation_scheduled_at: string;
  event_time: string;
  row_count: number;
  evidence_truncated: boolean;
  evidence_json: string;
  samples_truncated: boolean;
  samples_json: string;
  context_json: string;
  error: string;
  instance_fingerprint: string;
  instance_labels: Record<string, string>;
  service_name: string;
  severity: string;
  rule_muted: boolean;
  reason: string;
  silenced: boolean;
  inhibited: boolean;
  silence_id: string;
  silence_comment: string;
  silence_matchers_json: string;
  inhibition_comment: string;
  inhibition_source_json: string;
  delivery_targets: AlertDeliveryTargets;
  delivery_dedup_key: string;
};

function baseHistoryRow(opts: {
  def: AlertHistoryDefinition;
  eventId?: string;
  notificationEventId?: string;
  eventType: AlertHistoryEventType;
  occurredAt: Date;
}): AlertHistoryRow {
  return {
    event_id: opts.eventId ?? uuidv7(opts.occurredAt),
    notification_event_id: opts.notificationEventId ?? ZERO_UUID,
    episode_id: ZERO_UUID,
    tenant_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    preview_id: opts.def.previewId ?? ZERO_UUID,
    event_type: opts.eventType,
    write_source: "live",
    evaluation_scheduled_at: EPOCH_ISO,
    event_time: opts.occurredAt.toISOString(),
    row_count: 0,
    evidence_truncated: false,
    evidence_json: "{}",
    samples_truncated: false,
    samples_json: "[]",
    context_json: "{}",
    error: "",
    instance_fingerprint: "",
    instance_labels: {},
    service_name: "alert",
    severity: opts.def.severity,
    rule_muted: opts.def.ruleMuted,
    reason: "",
    silenced: false,
    inhibited: false,
    silence_id: ZERO_UUID,
    silence_comment: "",
    silence_matchers_json: "",
    inhibition_comment: "",
    inhibition_source_json: "",
    delivery_targets: {},
    delivery_dedup_key: "",
  };
}

// Every instance-scoped row inherits the label cap and write-time service
// resolution from here, so no builder can bypass either.
function instanceRowFields(
  fingerprint: string,
  labels: Record<string, string>,
) {
  const capped = capAlertLabels(labels);
  return {
    instance_fingerprint: fingerprint,
    instance_labels: capped,
    service_name: resolveAlertServiceName(capped),
  };
}

export function evaluationHistoryRow(opts: {
  def: AlertHistoryDefinition;
  scheduledFor: Date;
  occurredAt: Date;
  rowCount: number;
  evidenceJson: string;
  evidenceTruncated: boolean;
  samples: AlertingEvaluationSample[];
  samplesTruncated: boolean;
}): AlertHistoryRow {
  return {
    ...baseHistoryRow({
      def: opts.def,
      eventType: "evaluation_succeeded",
      occurredAt: opts.occurredAt,
    }),
    evaluation_scheduled_at: opts.scheduledFor.toISOString(),
    row_count: opts.rowCount,
    evidence_json: opts.evidenceJson,
    evidence_truncated: opts.evidenceTruncated,
    samples_json: JSON.stringify(opts.samples),
    samples_truncated: opts.samplesTruncated,
  };
}

export function evaluationFailureHistoryRow(opts: {
  def: AlertHistoryDefinition;
  scheduledFor: Date;
  occurredAt: Date;
  error: string;
}): AlertHistoryRow {
  const error = sanitizeAlertError(opts.error);
  return {
    ...baseHistoryRow({
      def: opts.def,
      eventType: "evaluation_failed",
      occurredAt: opts.occurredAt,
    }),
    evaluation_scheduled_at: opts.scheduledFor.toISOString(),
    error,
    evidence_json: JSON.stringify({ error }),
  };
}

export function instanceHistoryRow(opts: {
  def: AlertHistoryDefinition;
  eventId: string;
  eventType: AlertInstanceEventType;
  occurredAt: Date;
  /** The episode's opening event id: the pending event's own id, or the fired
   * event's own id when there is no pending phase. */
  episodeId: string;
  fingerprint: string;
  labels: Record<string, string>;
  evidence: Record<string, unknown>;
  evidenceTruncated: boolean;
  contextJson: string;
  /** `condition_cleared` on a resolve; the closing reason on `instance_closed`. */
  reason?: AlertingLifecycleReason;
}): AlertHistoryRow {
  // Only the notifying transitions head a notification chain: the suppression
  // and delivery rows written by later jobs point back here. Pending and
  // closed rows never notify, so their chain id stays zero.
  const notifies =
    opts.eventType === "instance_fired" ||
    opts.eventType === "instance_resolved";
  return {
    ...baseHistoryRow({
      def: opts.def,
      eventId: opts.eventId,
      ...(notifies ? { notificationEventId: opts.eventId } : {}),
      eventType: opts.eventType,
      occurredAt: opts.occurredAt,
    }),
    ...instanceRowFields(opts.fingerprint, opts.labels),
    episode_id: opts.episodeId,
    // row_count means one thing: rows the rule's query returned. A
    // transition or a lifecycle terminal runs no query, so it stays 0, the
    // DDL default, rather than a hardcoded 1 that claims a query result.
    row_count: 0,
    evidence_json: JSON.stringify(opts.evidence),
    evidence_truncated: opts.evidenceTruncated,
    context_json: opts.contextJson,
    reason: opts.reason ?? "",
  };
}

/**
 * A notification that was decided against. Written when a silence or an
 * inhibition rule stops an event from reaching any channel, so "why was I not
 * paged" is answerable from the same table as the transition itself.
 *
 * There is no `occurredAt`: the row is one per chain, so `event_time` is the
 * chain's own time, read back out of the notification event's UUIDv7. A
 * decision clock would put a different time on each attempt, and two rows that
 * differ in any byte are two permanent rows on a MergeTree.
 */
export function suppressionHistoryRow(opts: {
  def: AlertHistoryDefinition;
  notificationEventId: string;
  fingerprint: string;
  labels: Record<string, string>;
  silenced: boolean;
  inhibited: boolean;
  silenceId: string | null;
  /** Set on lifecycle terminals (`rule_paused`, `rule_deleted`); empty when a
   * silence or inhibition made the decision. */
  reason?: AlertingLifecycleReason;
}): AlertHistoryRow {
  return {
    ...baseHistoryRow({
      def: opts.def,
      // One terminal suppression per chain, so the id derives from the chain:
      // a projection retry or a racing second writer converges on one row id
      // instead of minting a phantom second terminal.
      eventId: deterministicSuppressionEventId(opts.notificationEventId),
      notificationEventId: opts.notificationEventId,
      eventType: "notification_suppressed",
      occurredAt: uuidv7Time(opts.notificationEventId),
    }),
    ...instanceRowFields(opts.fingerprint, opts.labels),
    silenced: opts.silenced,
    inhibited: opts.inhibited,
    silence_id: opts.silenceId ?? ZERO_UUID,
    reason: opts.reason ?? "",
  };
}

/**
 * One row per delivery outcome. `delivery_targets` carries the channel name and
 * a non-secret label for what it reached, so a delivery trail is readable
 * without joining PostgreSQL.
 */
export function deliveryHistoryRow(opts: {
  def: AlertHistoryDefinition;
  notificationEventId: string;
  dedupKey: string;
  /** When the delivery was queued. Attempt-independent, and the success row's
   * time for that reason: one success row stands for the whole delivery, so
   * nothing on it may move between attempts. How long the send itself took
   * lives in PostgreSQL, on the delivery row's own timestamps. */
  deliveryCreatedAt: Date;
  /** The attempt this row records. It reaches the row, and the id, on a
   * failure only: failures keep one row per attempt. */
  attemptAt: Date;
  fingerprint: string;
  labels: Record<string, string>;
  deliveryTargets: AlertDeliveryTargets;
  // The caller states the outcome from the branch it is in; it is never
  // inferred from the message. A failure with an empty message must stay a
  // failure: classified as a success it would take the convergent success id,
  // and the append-only table would carry a lie the reconciler cannot detect.
  outcome: "succeeded" | "failed";
  error?: string;
}): AlertHistoryRow {
  const failed = opts.outcome === "failed";
  const error = failed ? sanitizeAlertError(opts.error ?? "") : "";
  return {
    ...baseHistoryRow({
      def: opts.def,
      eventId: deterministicDeliveryEventId({
        notificationEventId: opts.notificationEventId,
        dedupKey: opts.dedupKey,
        outcome: opts.outcome,
        attemptAt: opts.attemptAt,
      }),
      notificationEventId: opts.notificationEventId,
      eventType: failed ? "delivery_failed" : "delivery_succeeded",
      occurredAt: failed ? opts.attemptAt : opts.deliveryCreatedAt,
    }),
    ...instanceRowFields(opts.fingerprint, opts.labels),
    delivery_targets: opts.deliveryTargets,
    delivery_dedup_key: opts.dedupKey,
    error,
    evidence_json: failed ? JSON.stringify({ error }) : "{}",
  };
}

function insertAlertHistoryRowsAsync(rows: AlertHistoryRow[]): Promise<void> {
  return insertAdminRows("app.alert_events", rows, {
    async_insert: 1,
    wait_for_async_insert: 1,
    date_time_input_format: "best_effort",
    insert_deduplication_token: alertHistoryDedupToken(rows),
  });
}

// Anchors dedup to the batch's logical identity (which journal or hold-decision
// rows it projects), not to matching insert bytes: the same rows in a
// different order, or from a racing second writer, still converge.
function alertHistoryDedupToken(rows: readonly AlertHistoryRow[]): string {
  const ids = rows.map((row) => row.event_id).sort();
  return `app.alert_events:${ids.join(",")}`;
}

// Synchronous because this path is a rare lifecycle projection rather than the
// hot path, so the stronger write is cheap here. The token, not the insert
// mode, is what makes a retry converge: it dedups under async_insert too,
// which is why the live path carries the same one.
function insertAlertHistoryRowsSync(rows: AlertHistoryRow[]): Promise<void> {
  return insertAdminRows("app.alert_events", rows, {
    async_insert: 0,
    date_time_input_format: "best_effort",
    insert_deduplication_token: alertHistoryDedupToken(rows),
  });
}

/**
 * The throwing form, for callers whose only job is the insert: the lifecycle
 * projection runs as a Graphile task with retries, and a swallowed failure
 * there would report success while the chain's terminals are lost. This path
 * inserts synchronously with insert_deduplication_token set from the sorted
 * row ids, so a retry that resends the same logical batch converges on one
 * write instead of duplicating terminal rows.
 */
export async function recordAlertHistoryStrict(
  rows: AlertHistoryRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await insertAlertHistoryRowsSync(rows);
}

export async function recordAlertHistory(
  // Null when one batch spans many definitions; a single arbitrary id would
  // misattribute the whole failure to one rule.
  definitionId: string | null,
  rows: AlertHistoryRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await insertAlertHistoryRowsAsync(rows);
  } catch (error) {
    serverLogger.error("alerts.history.insert_failed", {
      ...exceptionAttributes(error),
      ...(definitionId ? { "alert.definition_id": definitionId } : {}),
      "alert.event_count": rows.length,
      "error.handled": true,
    });
  }
}
