import type { AlertEventRow } from "@/lib/clickhouse";

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
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export function buildEvaluationEvent(opts: {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  eventType: "firing" | "resolved" | "partial_resolved" | "evaluation_failed";
  scheduledFor: Date;
  evidence?: BoundedEvidence;
  deliveryTargets?: Partial<Record<"email" | "telegram", string[]>>;
  silenceId?: string;
}): AlertEventRow {
  return {
    organization_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    event_type: opts.eventType,
    evaluation_scheduled_at: clickhouseDateTime64(opts.scheduledFor),
    row_count: opts.evidence?.rowCount ?? 0,
    evidence_truncated: opts.evidence?.truncated ? 1 : 0,
    evidence_json: opts.evidence?.json ?? "{}",
    delivery_targets: opts.deliveryTargets,
    silence_id: opts.silenceId ?? "",
  };
}

function boundJson(value: unknown): string {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_BYTES ? "{}" : json;
}

export function buildInstanceEvent(opts: {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  eventType: "instance_fired" | "instance_resolved";
  scheduledFor: Date;
  fingerprint: string;
  labels: Record<string, string>;
  row?: Record<string, unknown>;
}): AlertEventRow {
  return {
    organization_id: opts.def.organizationId,
    alert_definition_id: opts.def.id,
    repoid: opts.def.repoid,
    slug: opts.def.slug,
    event_type: opts.eventType,
    evaluation_scheduled_at: clickhouseDateTime64(opts.scheduledFor),
    instance_fingerprint: opts.fingerprint,
    instance_labels_json: boundJson(opts.labels),
    evidence_json: opts.row ? boundJson(opts.row) : "{}",
    row_count: opts.row ? 1 : 0,
  };
}
