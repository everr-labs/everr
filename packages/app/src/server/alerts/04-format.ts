// Shared formatting for alert notification bodies, across channels.

import { formatLabels } from "@/data/alerts/matchers";
import { renderMessage } from "@/data/alerts/template";
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
    runbookProject?: string;
    runbookSlug?: string;
  };
  kind: DeliveryKind;
  instances: NotifiableInstance[];
}

// What a channel body builder needs beyond the input itself.
export interface BuildOptions {
  url: string;
  now: Date;
  runbookUrl?: string;
}

// Escapes dynamic content (label values, rendered templates) before it is
// embedded in a channel's markup. Telegram sends plain text, so it leaves the
// default identity; Slack passes an mrkdwn escaper so values like `<!channel>`
// or `<@U…>` in alert data can't trigger mentions or distort the message.
export type EscapeFn = (text: string) => string;
const identity: EscapeFn = (text) => text;

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
// The label and detail text are dynamic, so they pass through `escapeText`; the
// `—` separator is ours and stays literal.
function instanceDetailText(
  instance: NotifiableInstance,
  kind: DeliveryKind,
  now: Date,
  escapeText: EscapeFn,
): string {
  const detail = instanceDetail(instance, kind, now);
  return `${escapeText(formatLabels(instance.labels))}${detail ? ` — ${escapeText(detail)}` : ""}`;
}

export function instanceLine(
  instance: NotifiableInstance,
  kind: DeliveryKind,
  now: Date,
  bullet: string,
  escapeText: EscapeFn = identity,
): string {
  return `${bullet} ${instanceDetailText(instance, kind, now, escapeText)}`;
}

export function renderTitle(
  def: DeliveryInput["def"],
  instance: NotifiableInstance,
): string {
  return renderMessage(def.notificationTitleTemplate, {
    firstRow: instance.row,
  });
}

export function renderDescription(
  def: DeliveryInput["def"],
  instance: NotifiableInstance,
): string {
  return def.notificationDescriptionTemplate
    ? renderMessage(def.notificationDescriptionTemplate, {
        firstRow: instance.row,
      })
    : "";
}

// Two lines per firing instance: the title (rendered from this instance's row)
// and its labels + breaching values indented beneath. Both are dynamic, so they
// pass through `escapeText`; the bullet and indentation are ours.
export function pushFiringBlock(
  lines: string[],
  def: DeliveryInput["def"],
  instance: NotifiableInstance,
  now: Date,
  escapeText: EscapeFn = identity,
): void {
  lines.push(`• ${escapeText(renderTitle(def, instance))}`);
  lines.push(`  ${instanceDetailText(instance, "firing", now, escapeText)}`);
}
