// Shared formatting for alert notification bodies (email and telegram).

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
    if (column in labels || !isNumeric(value)) continue;
    values.push(`${column}: ${String(value)}`);
    if (values.length === MAX_INSTANCE_VALUES) break;
  }
  return values;
}

// What to show next to an instance's labels: the breaching values while
// firing, how long it fired once resolved. Empty when neither is available.
export function instanceDetail(
  instance: NotifiableInstance,
  kind: "firing" | "resolved" | "partial_resolved",
  now: Date,
): string {
  if (kind === "firing") {
    return extractInstanceValues(instance.row, instance.labels).join(", ");
  }
  return instance.firedAt
    ? `fired for ${formatDuration(instance.firedAt, now)}`
    : "";
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

function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  // ClickHouse returns 64-bit integers as strings.
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim());
}
