import { randomUUID } from "node:crypto";
import type { AlertingEvaluationSample } from "@/data/alerting/types";
import { insertAdminRows } from "@/lib/clickhouse";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

type AlertHistoryEventType =
  | "evaluation_succeeded"
  | "evaluation_failed"
  | "instance_fired"
  | "instance_resolved"
  | "notification_suppressed"
  | "delivery_succeeded"
  | "delivery_failed";

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
  suppressed: boolean;
};

export type AlertHistoryRow = {
  event_id: string;
  notification_event_id: string;
  tenant_id: string;
  alert_definition_id: string;
  repoid: string;
  slug: string;
  preview_id: string;
  event_type: AlertHistoryEventType;
  evaluation_scheduled_at: string;
  event_time: string;
  row_count: number;
  evidence_truncated: boolean;
  evidence_json: string;
  samples_truncated: boolean;
  samples_json: string;
  error: string;
  instance_fingerprint: string;
  instance_labels_json: string;
  severity: string;
  suppressed: boolean;
  silenced: boolean;
  inhibited: boolean;
  silence_id: string;
  delivery_targets: AlertDeliveryTargets;
};

function baseHistoryRow(opts: {
  def: AlertHistoryDefinition;
  eventId?: string;
  notificationEventId?: string;
  eventType: AlertHistoryEventType;
  scheduledFor: Date;
  occurredAt: Date;
}): AlertHistoryRow {
  return {
    event_id: opts.eventId ?? randomUUID(),
    notification_event_id: opts.notificationEventId ?? ZERO_UUID,
    tenant_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    preview_id: opts.def.previewId ?? "00000000-0000-0000-0000-000000000000",
    event_type: opts.eventType,
    evaluation_scheduled_at: opts.scheduledFor.toISOString(),
    event_time: opts.occurredAt.toISOString(),
    row_count: 0,
    evidence_truncated: false,
    evidence_json: "{}",
    samples_truncated: false,
    samples_json: "[]",
    error: "",
    instance_fingerprint: "",
    instance_labels_json: "{}",
    severity: opts.def.severity,
    suppressed: opts.def.suppressed,
    silenced: false,
    inhibited: false,
    silence_id: "",
    delivery_targets: {},
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
      scheduledFor: opts.scheduledFor,
      occurredAt: opts.occurredAt,
    }),
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
  return {
    ...baseHistoryRow({
      def: opts.def,
      eventType: "evaluation_failed",
      scheduledFor: opts.scheduledFor,
      occurredAt: opts.occurredAt,
    }),
    error: opts.error,
    evidence_json: JSON.stringify({ error: opts.error }),
  };
}

export function instanceHistoryRow(opts: {
  def: AlertHistoryDefinition;
  eventId: string;
  eventType: "instance_fired" | "instance_resolved";
  scheduledFor: Date;
  occurredAt: Date;
  fingerprint: string;
  labels: Record<string, string>;
  evidence: Record<string, unknown>;
  evidenceTruncated: boolean;
}): AlertHistoryRow {
  return {
    ...baseHistoryRow({
      def: opts.def,
      eventId: opts.eventId,
      // A transition is the head of its own notification chain: the
      // suppression and delivery rows written by later jobs point back here.
      notificationEventId: opts.eventId,
      eventType: opts.eventType,
      scheduledFor: opts.scheduledFor,
      occurredAt: opts.occurredAt,
    }),
    row_count: 1,
    evidence_json: JSON.stringify(opts.evidence),
    evidence_truncated: opts.evidenceTruncated,
    instance_fingerprint: opts.fingerprint,
    instance_labels_json: JSON.stringify(opts.labels),
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
  scheduledFor: Date;
  fingerprint: string;
  labels: Record<string, string>;
  silenced: boolean;
  inhibited: boolean;
  silenceId: string | null;
}): AlertHistoryRow {
  return {
    ...baseHistoryRow({
      def: opts.def,
      notificationEventId: opts.notificationEventId,
      eventType: "notification_suppressed",
      scheduledFor: opts.scheduledFor,
      occurredAt: opts.occurredAt,
    }),
    instance_fingerprint: opts.fingerprint,
    instance_labels_json: JSON.stringify(opts.labels),
    silenced: opts.silenced,
    inhibited: opts.inhibited,
    silence_id: opts.silenceId ?? "",
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
  occurredAt: Date;
  scheduledFor: Date;
  fingerprint: string;
  labels: Record<string, string>;
  deliveryTargets: AlertDeliveryTargets;
  error?: string;
}): AlertHistoryRow {
  const failed = opts.error !== undefined && opts.error !== "";
  return {
    ...baseHistoryRow({
      def: opts.def,
      notificationEventId: opts.notificationEventId,
      eventType: failed ? "delivery_failed" : "delivery_succeeded",
      scheduledFor: opts.scheduledFor,
      occurredAt: opts.occurredAt,
    }),
    instance_fingerprint: opts.fingerprint,
    instance_labels_json: JSON.stringify(opts.labels),
    delivery_targets: opts.deliveryTargets,
    error: failed ? (opts.error ?? "") : "",
    evidence_json: failed ? JSON.stringify({ error: opts.error }) : "{}",
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
