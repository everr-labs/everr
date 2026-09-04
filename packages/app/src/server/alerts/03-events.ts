import type {
  AlertChannel,
  AlertDeliveryTargets,
} from "@/data/alerts/delivery-settings";
import { insertAdminRows } from "@/lib/clickhouse";
import { retentionForOrg } from "@/lib/retention.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

export interface AlertEventRow {
  tenant_id: string;
  alert_definition_id: string;
  repoid: string;
  slug: string;
  // Preview namespace ('' = live); projected to ServiceName/env in app.logs.
  preview: string;
  event_type:
    | "firing"
    | "resolved"
    | "evaluation_failed"
    | "instance_fired"
    | "instance_resolved"
    | "delivery_failed";
  evaluation_scheduled_at?: string;
  row_count?: number;
  evidence_truncated?: 0 | 1;
  evidence_json?: string;
  delivery_targets?: AlertDeliveryTargets;
  silence_id?: string;
  instance_fingerprint?: string;
  instance_labels_json?: string;
}

// Operational detail rather than state transitions: queryable in ClickHouse
// (and projected to app.logs) but excluded from the alert history UI.
export const OPERATIONAL_EVENT_TYPES = [
  "instance_fired",
  "instance_resolved",
  "delivery_failed",
] as const;

// Alert history follows the tenant's logs retention, like its projection
// into app.logs. Every caller builds its rows from one alert definition, so
// the batch is a single tenant and one lookup covers it.
async function insertAlertEvents(rows: AlertEventRow[]): Promise<void> {
  const { logsDays } = await retentionForOrg(rows[0].tenant_id);
  const stamped = rows.map((row) => ({ ...row, retention_days: logsDays }));
  return insertAdminRows("app.alert_events", stamped, {
    async_insert: 1,
    wait_for_async_insert: 1,
    date_time_input_format: "best_effort",
  });
}

// Best-effort insert: recording history must never fail the operation that
// produced it. Failures are logged under the caller's event name.
export async function recordAlertEvents(
  def: { id: string },
  events: AlertEventRow[],
  logEvent: string,
): Promise<void> {
  if (events.length === 0) return;
  try {
    await insertAlertEvents(events);
  } catch (error) {
    serverLogger.error(logEvent, {
      ...exceptionAttributes(error),
      "alert.definition_id": def.id,
      "alert.event_count": events.length,
    });
  }
}

export const MAX_EVIDENCE_ROWS = 50;
export const MAX_EVIDENCE_BYTES = 64 * 1024;

export interface BoundedEvidence {
  json: string;
  truncated: boolean;
  rowCount: number;
  firstRow: Record<string, unknown> | undefined;
  rows: Record<string, unknown>[];
}

export function boundEvidence(
  rows: Record<string, unknown>[],
): BoundedEvidence {
  let kept = rows.slice(0, MAX_EVIDENCE_ROWS);
  let truncated = rows.length > MAX_EVIDENCE_ROWS;
  let json = JSON.stringify(kept);

  while (
    Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_BYTES &&
    kept.length > 1
  ) {
    kept = kept.slice(0, Math.ceil(kept.length / 2));
    truncated = true;
    json = JSON.stringify(kept);
  }

  if (Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_BYTES) {
    kept = [];
    truncated = true;
    json = "[]";
  }

  return {
    json,
    truncated,
    rowCount: rows.length,
    firstRow: rows[0],
    rows: kept,
  };
}

function clickhouseDateTime64(date: Date): string {
  // Keep the UTC designator; ClickHouse parses it with best_effort above.
  return date.toISOString();
}

export function buildEvaluationEvent(opts: {
  def: {
    id: string;
    organizationId: string;
    repoid: string;
    slug: string;
    preview: string;
  };
  eventType: "firing" | "resolved" | "evaluation_failed";
  scheduledFor: Date;
  evidence?: BoundedEvidence;
  deliveryTargets?: AlertDeliveryTargets;
  silenceId?: string;
}): AlertEventRow {
  return {
    tenant_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    preview: opts.def.preview,
    event_type: opts.eventType,
    evaluation_scheduled_at: clickhouseDateTime64(opts.scheduledFor),
    row_count: opts.evidence?.rowCount ?? 0,
    evidence_truncated: opts.evidence?.truncated ? 1 : 0,
    evidence_json: opts.evidence?.json ?? "{}",
    delivery_targets: opts.deliveryTargets,
    silence_id: opts.silenceId ?? "",
  };
}

// Serialize an object, keeping the leading entries that fit the evidence
// budget — partial labels/rows beat losing the whole object. Single pass:
// each entry is stringified once and byte-counted into a running total.
function boundJson(value: Record<string, unknown>): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") <= MAX_EVIDENCE_BYTES) return json;

  const parts: string[] = [];
  let bytes = 2; // the surrounding braces
  for (const [key, entry] of Object.entries(value)) {
    const entryJson = JSON.stringify(entry);
    // JSON.stringify(value) drops undefined/function entries; mirror that.
    if (entryJson === undefined) continue;
    const part = `${JSON.stringify(key)}:${entryJson}`;
    const partBytes =
      Buffer.byteLength(part, "utf8") + (parts.length > 0 ? 1 : 0);
    if (bytes + partBytes > MAX_EVIDENCE_BYTES) break;
    parts.push(part);
    bytes += partBytes;
  }
  return `{${parts.join(",")}}`;
}

// Delivery failures are operational events, not state transitions: they are
// queryable in ClickHouse (and projected to app.logs) but excluded from the
// alert history UI. delivery_targets identifies the channel + target; the
// error message travels in evidence_json.
export function buildDeliveryFailureEvent(opts: {
  def: {
    id: string;
    organizationId: string;
    repoid: string;
    slug: string;
    preview: string;
  };
  scheduledFor: Date;
  failure: { channel: AlertChannel; target: string; error: string };
}): AlertEventRow {
  return {
    tenant_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    preview: opts.def.preview,
    event_type: "delivery_failed",
    evaluation_scheduled_at: clickhouseDateTime64(opts.scheduledFor),
    delivery_targets: { [opts.failure.channel]: [opts.failure.target] },
    evidence_json: boundJson({ error: opts.failure.error }),
  };
}

export function buildInstanceEvent(opts: {
  def: {
    id: string;
    organizationId: string;
    repoid: string;
    slug: string;
    preview: string;
  };
  eventType: "instance_fired" | "instance_resolved";
  scheduledFor: Date;
  fingerprint: string;
  labels: Record<string, string>;
  row?: Record<string, unknown>;
}): AlertEventRow {
  return {
    tenant_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    preview: opts.def.preview,
    event_type: opts.eventType,
    evaluation_scheduled_at: clickhouseDateTime64(opts.scheduledFor),
    instance_fingerprint: opts.fingerprint,
    instance_labels_json: boundJson(opts.labels),
    evidence_json: opts.row ? boundJson(opts.row) : "{}",
    row_count: opts.row ? 1 : 0,
  };
}
