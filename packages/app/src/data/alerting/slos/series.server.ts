import type { ClickhouseQuery } from "@/lib/clickhouse";
import { createLimiter } from "@/lib/limiter";
import {
  ALERTING_SLO_INGEST_DELAY_SECS,
  type AlertingFreshBudget,
  alertingFormatClickHouseDateTime,
} from "./model";

export type AlertingSloBudgetPoint = {
  t: string;
  good: number | null;
  valid: number | null;
  budgetRemaining: number | null;
};

const ALERTING_SLO_BUDGET_MAX_POINTS = 200;

// Round steps make series stable across reloads and keep labels readable.
const NICE_STEPS_MS = [
  60_000, // 1m
  5 * 60_000, // 5m
  15 * 60_000, // 15m
  30 * 60_000, // 30m
  60 * 60_000, // 1h
  2 * 60 * 60_000, // 2h
  6 * 60 * 60_000, // 6h
  12 * 60 * 60_000, // 12h
  24 * 60 * 60_000, // 1d
  7 * 24 * 60 * 60_000, // 1w
];

function chooseStepMs(spanMs: number, targetPoints: number): number {
  return (
    NICE_STEPS_MS.find((s) => spanMs / s <= targetPoints) ??
    NICE_STEPS_MS[NICE_STEPS_MS.length - 1]
  );
}

// The SQL API returns every SLI column as a string.
type SliRow = { good: string; valid: string };

function sliWindowMs(
  instantMs: number,
  windowSecs: number,
): { start: number; end: number } {
  const end = instantMs - ALERTING_SLO_INGEST_DELAY_SECS * 1000;
  return { start: end - windowSecs * 1000, end };
}

export async function querySloBudgetNow(
  clickhouse: ClickhouseQuery,
  opts: {
    sliSql: string;
    targetPercent: number;
    windowSecs: number;
    nowMs: number;
  },
): Promise<AlertingFreshBudget | null> {
  const { start, end } = sliWindowMs(opts.nowMs, opts.windowSecs);
  const rows = await clickhouse<Record<string, string>>(opts.sliSql, {
    window_start: alertingFormatClickHouseDateTime(new Date(start)),
    window_end: alertingFormatClickHouseDateTime(new Date(end)),
  });
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new Error("SLI query must return at most one row");
  const good = Number(rows[0].good) || 0;
  const valid = Number(rows[0].valid) || 0;
  return {
    sli: valid > 0 ? good / valid : null,
    budgetRemaining: budgetRemaining(good, valid, opts.targetPercent),
  };
}

// ClickHouse returns a UTC time without a zone. Add the zone before parsing so
// the server does not interpret the value as local time.
function parseChUtc(s: string): number {
  return Date.parse(`${s.replace(" ", "T")}Z`);
}

function budgetRemaining(
  good: number,
  valid: number,
  targetPercent: number,
): number | null {
  if (valid <= 0 || targetPercent >= 100) return null;
  const bad = Math.min(1, Math.max(0, 1 - good / valid));
  const remaining = 1 - bad / ((100 - targetPercent) / 100);
  return Math.abs(remaining) < 1e-12 ? 0 : remaining;
}

// Run one trailing-window scan for each point.
export async function querySloBudgetSeries(
  clickhouse: ClickhouseQuery,
  opts: {
    sliSql: string;
    targetPercent: number;
    windowSecs: number;
    fromISO: string;
    toISO: string;
    points: number;
  },
): Promise<AlertingSloBudgetPoint[]> {
  const from = parseChUtc(opts.fromISO);
  const to = parseChUtc(opts.toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  // Use a round grid so the same range produces the same points.
  const step = chooseStepMs(to - from, opts.points);
  const instants: number[] = [];
  for (
    let t = Math.ceil(from / step) * step;
    t <= to && instants.length < ALERTING_SLO_BUDGET_MAX_POINTS;
    t += step
  ) {
    instants.push(t);
  }
  if (instants.length === 0) return [];
  // End at `to` so the chart and summary measure the same window.
  if (
    instants[instants.length - 1] < to &&
    instants.length < ALERTING_SLO_BUDGET_MAX_POINTS
  ) {
    instants.push(to);
  }

  // Limit concurrent scans to protect ClickHouse.
  const run = createLimiter(8);
  const scans = await Promise.all(
    instants.map((t) =>
      run(undefined, () => {
        const { start, end } = sliWindowMs(t, opts.windowSecs);
        return clickhouse<SliRow>(opts.sliSql, {
          window_start: alertingFormatClickHouseDateTime(new Date(start)),
          window_end: alertingFormatClickHouseDateTime(new Date(end)),
        });
      }),
    ),
  );

  return scans.map((rows, i) => {
    if (rows.length > 1)
      throw new Error("SLI query must return at most one row");
    const row = rows[0];
    const good = row === undefined ? null : Number(row.good) || 0;
    const valid = row === undefined ? null : Number(row.valid) || 0;
    return {
      t: new Date(instants[i]).toISOString(),
      good,
      valid,
      budgetRemaining:
        good === null || valid === null
          ? null
          : budgetRemaining(good, valid, opts.targetPercent),
    };
  });
}
