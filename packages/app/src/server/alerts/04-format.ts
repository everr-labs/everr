// Shared formatting for alert notification bodies (email and telegram).

import { formatLabels } from "@/data/alerts/matchers";
import { isNumericValue } from "@/lib/numeric";

export type DeliveryKind = "firing" | "resolved" | "partial_resolved";

export interface DeliveryInput {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  kind: DeliveryKind;
  summary: string;
  description: string;
  // Current firing instance count after this evaluation.
  firingCount: number;
  // newlyFired for "firing", nowResolved for "resolved" and
  // "partial_resolved". Firing instances carry the query result row they came
  // from; resolved ones only have the labels (the row is gone by then).
  instances: NotifiableInstance[];
}

// What a channel body builder needs beyond the input itself.
export interface BuildOptions {
  url: string;
  now: Date;
}

// One definition of how each kind presents across channels; email layers its
// colors on top, telegram lowercases the label for its headline.
export const KIND_STATUS: Record<
  DeliveryKind,
  { emoji: string; label: string }
> = {
  firing: { emoji: "🔥", label: "Firing" },
  partial_resolved: { emoji: "✅", label: "Partially resolved" },
  resolved: { emoji: "✅", label: "Resolved" },
};

export const MAX_LISTED_INSTANCES = 10;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MAX_INSTANCE_VALUES = 3;

export interface NotifiableInstance {
  labels: Record<string, string>;
  firedAt?: Date;
  row?: Record<string, unknown>;
}

// Notification timestamps are always UTC: recipients of one alert can be in
// different timezones, and UTC matches the dashboards.
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatDuration(from: Date, to: Date): string {
  const minutes = Math.floor((to.getTime() - from.getTime()) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
}

// The queried values for an instance: numeric, non-label columns of the result
// row, capped so notification lines stay readable.
export function extractInstanceValues(
  row: Record<string, unknown> | undefined,
  labels: Record<string, string>,
): string[] {
  if (!row) return [];
  const values: string[] = [];
  for (const [column, value] of Object.entries(row)) {
    if (column in labels || !isNumericValue(value)) continue;
    values.push(`${column}: ${String(value)}`);
    if (values.length === MAX_INSTANCE_VALUES) break;
  }
  return values;
}

// What to show next to an instance's labels: the breaching values while
// firing, how long it fired once resolved. Empty when neither is available.
export function instanceDetail(
  instance: NotifiableInstance,
  kind: DeliveryKind,
  now: Date,
): string {
  if (kind === "firing") {
    return extractInstanceValues(instance.row, instance.labels).join(", ");
  }
  return instance.firedAt
    ? `fired for ${formatDuration(instance.firedAt, now)}`
    : "";
}

// One bullet line per listed instance plus the overflow line, shared between
// the telegram body and the email text part so the channels can't drift.
export function instanceLines(
  listed: readonly NotifiableInstance[],
  kind: DeliveryKind,
  now: Date,
  bullet: string,
): string[] {
  const lines = listed.slice(0, MAX_LISTED_INSTANCES).map((instance) => {
    const detail = instanceDetail(instance, kind, now);
    return `${bullet} ${formatLabels(instance.labels)}${detail ? ` — ${detail}` : ""}`;
  });
  if (listed.length > MAX_LISTED_INSTANCES) {
    lines.push(`… and ${listed.length - MAX_LISTED_INSTANCES} more`);
  }
  return lines;
}

// Longest firing duration across instances; "" when no timestamps survive.
export function longestDuration(
  instances: readonly NotifiableInstance[],
  now: Date,
): string {
  let earliest: Date | undefined;
  for (const instance of instances) {
    if (instance.firedAt && (!earliest || instance.firedAt < earliest)) {
      earliest = instance.firedAt;
    }
  }
  return earliest ? formatDuration(earliest, now) : "";
}
