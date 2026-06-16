// Shared formatting for alert notification bodies (telegram).

import { formatLabels } from "@/data/alerts/matchers";
import { isNumericValue } from "@/lib/numeric";

export type DeliveryKind = "firing" | "resolved" | "mixed";

export interface DeliveryInput {
  def: {
    id: string;
    organizationId: string;
    repoid: string;
    slug: string;
    notificationTitleTemplate: string;
    notificationDescriptionTemplate?: string;
  };
  kind: DeliveryKind;
  instances: NotifiableInstance[];
}

// What a channel body builder needs beyond the input itself.
export interface BuildOptions {
  url: string;
  now: Date;
}

// One definition of how each kind presents across channels; telegram lowercases
// the label for its headline.
export const KIND_STATUS: Record<
  DeliveryKind,
  { emoji: string; label: string }
> = {
  firing: { emoji: "🔥", label: "Firing" },
  resolved: { emoji: "✅", label: "Resolved" },
  mixed: { emoji: "🔥", label: "Firing + Resolved" },
};

const MAX_INSTANCE_VALUES = 3;

export interface NotifiableInstance {
  labels: Record<string, string>;
  firedAt?: Date;
  row?: Record<string, unknown>;
  // Whether this instance newly fired or resolved in the evaluation. Drives the
  // firing/resolved split in a mixed notification rather than inferring it from
  // the presence of `row`.
  kind?: "firing" | "resolved";
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
function instanceDetail(
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

// The instance's labels with its breaching values or fired-for duration
// appended, without a bullet, so callers can prefix or indent it themselves.
export function instanceDetailText(
  instance: NotifiableInstance,
  kind: DeliveryKind,
  now: Date,
): string {
  const detail = instanceDetail(instance, kind, now);
  return `${formatLabels(instance.labels)}${detail ? ` — ${detail}` : ""}`;
}

export function instanceLine(
  instance: NotifiableInstance,
  kind: DeliveryKind,
  now: Date,
  bullet: string,
): string {
  return `${bullet} ${instanceDetailText(instance, kind, now)}`;
}
