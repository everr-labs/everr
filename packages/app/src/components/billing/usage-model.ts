import type { OrgUsage, OrgUsageSeriesPoint } from "@/data/usage";
import { USAGE_METERS, type UsageMeter } from "@/lib/usage-limits";

export type UsagePeriodBounds = {
  from: Date;
  to: Date;
};

export type UsageChartRow = Record<UsageMeter, number> & {
  date: string;
};

export type UsageTotalByMeter = Record<
  UsageMeter,
  { bytes: number; items: number }
>;

const DECIMAL_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

function emptyUsageTotal(): UsageTotalByMeter {
  return {
    traces: { bytes: 0, items: 0 },
    logs: { bytes: 0, items: 0 },
    metrics: { bytes: 0, items: 0 },
  };
}

function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildUsageTotals(rows: OrgUsage[]): UsageTotalByMeter {
  const totals = emptyUsageTotal();

  for (const row of rows) {
    if (!USAGE_METERS.includes(row.meter)) continue;
    totals[row.meter].bytes += row.bytes;
    totals[row.meter].items += row.items;
  }

  return totals;
}

export function buildUsageChartRows(
  points: OrgUsageSeriesPoint[],
  period: UsagePeriodBounds,
): UsageChartRow[] {
  if (
    !Number.isFinite(period.from.getTime()) ||
    !Number.isFinite(period.to.getTime()) ||
    period.from >= period.to
  ) {
    return [];
  }

  const rows = new Map<string, UsageChartRow>();
  for (
    let day = utcDay(period.from);
    day < period.to;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const date = dateKey(day);
    rows.set(date, { date, traces: 0, logs: 0, metrics: 0 });
  }

  for (const point of points) {
    if (!USAGE_METERS.includes(point.meter)) continue;
    const row = rows.get(point.date);
    if (!row) continue;
    row[point.meter] += point.bytes;
  }

  return [...rows.values()];
}

export function hasUsageChartData(rows: UsageChartRow[]): boolean {
  return rows.some((row) => USAGE_METERS.some((meter) => row[meter] > 0));
}

export function formatUsageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const unitIndex = Math.min(
    Math.max(0, Math.floor(Math.log(bytes) / Math.log(1_000))),
    DECIMAL_UNITS.length - 1,
  );
  const value = bytes / 1_000 ** unitIndex;
  const formatted = new Intl.NumberFormat(
    "en-US",
    value < 1
      ? { maximumSignificantDigits: 3 }
      : { maximumFractionDigits: value < 10 ? 2 : 1 },
  ).format(value);

  return `${formatted} ${DECIMAL_UNITS[unitIndex]}`;
}

export function formatUsageItems(items: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, items));
}

export function formatUsagePercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 0.1) return "<0.1%";
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)}%`;
}

export function formatUsageCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUtcDate(date: Date, includeYear: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date);
}

export function formatUsagePeriod(period: UsagePeriodBounds): string {
  const inclusiveEnd = new Date(period.to.getTime() - 1);
  const sameYear =
    period.from.getUTCFullYear() === inclusiveEnd.getUTCFullYear();

  return `${formatUtcDate(period.from, !sameYear)} to ${formatUtcDate(
    inclusiveEnd,
    true,
  )}`;
}

export function formatUsageChartDate(
  value: string,
  includeYear = false,
): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? formatUtcDate(date, includeYear)
    : value;
}
