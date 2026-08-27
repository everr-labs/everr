import type { OrgUsage, OrgUsageSeriesPoint } from "@/data/usage";
import {
  isUsageMeter,
  USAGE_METERS,
  type UsageMeter,
} from "@/lib/usage-limits";

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
const SUB_BYTE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 3,
});
const SMALL_BYTE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const BYTE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const ITEM_FORMATTER = new Intl.NumberFormat("en-US");
const FRACTIONAL_PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const WHOLE_PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const UTC_DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

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
    if (!isUsageMeter(row.meter)) continue;
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
    if (!isUsageMeter(point.meter)) continue;
    const row = rows.get(point.date);
    if (!row) continue;
    row[point.meter] += point.bytes;
  }

  return [...rows.values()];
}

export function hasUsageChartData(rows: UsageChartRow[]): boolean {
  return rows.some((row) => USAGE_METERS.some((meter) => row[meter] > 0));
}

export function isTopUsageMeter(
  row: UsageChartRow,
  meter: UsageMeter,
): boolean {
  let topMeter: UsageMeter | undefined;
  for (const candidate of USAGE_METERS) {
    if (row[candidate] > 0) topMeter = candidate;
  }
  return topMeter === meter;
}

function usageByteFormatter(value: number): Intl.NumberFormat {
  if (value < 1) return SUB_BYTE_FORMATTER;
  return value < 10 ? SMALL_BYTE_FORMATTER : BYTE_FORMATTER;
}

function roundsToNextDecimalUnit(value: number): boolean {
  const maximumFractionDigits = value < 10 ? 2 : 1;
  const scale = 10 ** maximumFractionDigits;
  return Math.round(value * scale) / scale >= 1_000;
}

export function formatUsageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let unitIndex = 0;
  let value = bytes;
  while (value >= 1_000 && unitIndex < DECIMAL_UNITS.length - 1) {
    value /= 1_000;
    unitIndex++;
  }

  if (unitIndex < DECIMAL_UNITS.length - 1 && roundsToNextDecimalUnit(value)) {
    value /= 1_000;
    unitIndex++;
  }

  return `${usageByteFormatter(value).format(value)} ${DECIMAL_UNITS[unitIndex]}`;
}

export function formatUsageItems(items: number): string {
  return ITEM_FORMATTER.format(Math.max(0, items));
}

export function formatUsagePercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 0.1) return "<0.1%";
  const formatter =
    value < 10 ? FRACTIONAL_PERCENT_FORMATTER : WHOLE_PERCENT_FORMATTER;
  return `${formatter.format(value)}%`;
}

export function formatUsageCost(value: number): string {
  return USD_FORMATTER.format(value);
}

function formatUtcDate(date: Date, includeYear: boolean): string {
  return (
    includeYear ? UTC_DATE_WITH_YEAR_FORMATTER : UTC_DATE_FORMATTER
  ).format(date);
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
