import type { AlertingEvaluationSample } from "@/data/alerting/types";
import { insertAdminRows } from "@/lib/clickhouse";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  capAlertLabels,
  resolveAlertServiceName,
  sanitizeAlertError,
} from "./content";
import { deterministicDeliveryEventId, uuidv7 } from "./ids";

export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// `evaluation_scheduled_at` means one thing: when the evaluation was due. Off
// evaluation rows it is the epoch sentinel, never a smuggled second timestamp.
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

type AlertHistoryEventType =
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
  /** The rule never notifies at all: `spec.suppressed` or a preview copy. */
  ruleMuted: boolean;
  /** Rule-level service fallback when no instance label names one. */
};

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
  reason?: string;
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
    row_count: 1,
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
 */
export function suppressionHistoryRow(opts: {
  def: AlertHistoryDefinition;
  notificationEventId: string;
  occurredAt: Date;
  fingerprint: string;
  labels: Record<string, string>;
  silenced: boolean;
  inhibited: boolean;
  silenceId: string | null;
  /** Set on lifecycle terminals (`rule_paused`, `rule_deleted`); empty when a
   * silence or inhibition made the decision. */
  reason?: string;
}): AlertHistoryRow {
  return {
    ...baseHistoryRow({
      def: opts.def,
      notificationEventId: opts.notificationEventId,
      eventType: "notification_suppressed",
      occurredAt: opts.occurredAt,
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
  occurredAt: Date;
  fingerprint: string;
  labels: Record<string, string>;
  deliveryTargets: AlertDeliveryTargets;
  error?: string;
}): AlertHistoryRow {
  const failed = opts.error !== undefined && opts.error !== "";
  const error = failed ? sanitizeAlertError(opts.error ?? "") : "";
  return {
    ...baseHistoryRow({
      def: opts.def,
      eventId: deterministicDeliveryEventId({
        notificationEventId: opts.notificationEventId,
        dedupKey: opts.dedupKey,
        outcome: failed ? "failed" : "succeeded",
        attemptAt: opts.occurredAt,
      }),
      notificationEventId: opts.notificationEventId,
      eventType: failed ? "delivery_failed" : "delivery_succeeded",
      occurredAt: opts.occurredAt,
    }),
    ...instanceRowFields(opts.fingerprint, opts.labels),
    delivery_targets: opts.deliveryTargets,
    delivery_dedup_key: opts.dedupKey,
    error,
    evidence_json: failed ? JSON.stringify({ error }) : "{}",
  };
}

export async function recordAlertHistory(
  definitionId: string,
  rows: AlertHistoryRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await insertAdminRows("app.alert_events", rows, {
      async_insert: 1,
      wait_for_async_insert: 1,
      date_time_input_format: "best_effort",
    });
  } catch (error) {
    serverLogger.error("alerts.history.insert_failed", {
      ...exceptionAttributes(error),
      "alert.definition_id": definitionId,
      "alert.event_count": rows.length,
      "error.handled": true,
    });
  }
}
