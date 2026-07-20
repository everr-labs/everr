import type { ClickhouseQuery } from "@/lib/clickhouse";
import { createLimiter } from "@/lib/limiter";

/** One point of the error-budget-over-time series (one trailing-window eval). */
export type CcSloBudgetPoint = {
  /** ISO 8601 UTC, e.g. "2026-07-20T13:00:00Z". */
  t: string;
  /** Good events over the budget window ending at `t`, summed across groups. */
  good: number;
  /** Valid events over the budget window ending at `t`, summed across groups. */
  valid: number;
  /**
   * Error budget remaining as a 0..1 fraction (may go negative when overspent);
   * null at zero traffic (or a 100% target). Derived here from good/valid with
   * the same formula as the engine's `sloBudgetRemaining` (engine/slo_math.rs).
   */
  budgetRemaining: number | null;
};

/** Hard upper bound on trailing-window evals for one series (cost ceiling). */
const CC_SLO_BUDGET_MAX_POINTS = 200;

// "Nice" grid steps (ascending). Instants snap to whichever step keeps the point
// count near the target, so each point lands on a round wall-clock time (1m, 5m,
// 1h, ...) instead of an arbitrary sub-second offset. Round instants make the
// series deterministic and cacheable across reloads/polls, and align with how a
// future bucketed rollup would key its buckets.
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

/** Smallest nice step keeping `spanMs / step <= targetPoints` (largest if none). */
function chooseStepMs(spanMs: number, targetPoints: number): number {
  return (
    NICE_STEPS_MS.find((s) => spanMs / s <= targetPoints) ??
    NICE_STEPS_MS[NICE_STEPS_MS.length - 1]
  );
}

// The SLI query returns `good` and `valid` (aliased in its SELECT), plus any
// label columns; the SQL API hands every column back as a string.
type SliRow = { good: string; valid: string };

/** ClickHouse `DateTime` literal ("YYYY-MM-DD HH:MM:SS", UTC) for a ms instant. */
function fmtCh(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Error budget remaining from a window's `(good, valid)`, byte-for-byte the
 * engine's `sloBudgetRemaining`: null at no traffic or a 100% target; otherwise
 * `1 - clamp(1 - good/valid, 0, 1) / ((100 - target) / 100)`.
 */
function budgetRemaining(
  good: number,
  valid: number,
  targetPercent: number,
): number | null {
  if (valid <= 0 || targetPercent >= 100) return null;
  const bad = Math.min(1, Math.max(0, 1 - good / valid));
  return 1 - bad / ((100 - targetPercent) / 100);
}

/**
 * The SLO's error-budget-remaining over time, computed at READ TIME by running
 * the SLI query directly against the raw telemetry once per plotted point. Each
 * point is a trailing-window aggregate: the SLI over `[t - window, t]`, summed
 * across groups, turned into budget remaining. No stored samples and no backfill
 * are involved, so a freshly-created SLO shows history as far back as the raw
 * data goes (bounded only by telemetry retention).
 *
 * This is the deliberately-simple form: N independent full-window scans (one per
 * point), spread evenly across the selected range and run with bounded
 * concurrency. It is expensive by design (the windows overlap heavily) and is
 * the read-time counterpart of the bucketed rollup path in
 * `todo/ideas/slo-sli-rollups.md`. Row-level security pins the tenant, so the
 * SLI runs against this org's telemetry only, exactly as the engine runs it.
 */
export async function querySloBudgetSeries(
  clickhouse: ClickhouseQuery,
  opts: {
    /** The SLO's SLI SQL, parameterized on `{window_start}`/`{window_end}`. */
    sliSql: string;
    targetPercent: number;
    /** Budget window length in seconds (each point's trailing window). */
    windowSecs: number;
    fromISO: string;
    toISO: string;
    /** Target point count; the grid step is chosen to land near it (cap 200). */
    points: number;
  },
): Promise<CcSloBudgetPoint[]> {
  const from = Date.parse(opts.fromISO);
  const to = Date.parse(opts.toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  // Snap instants to a round grid: the largest multiple of `step` at or before
  // each slot, starting at the first grid tick inside the range. Deterministic
  // across reloads (same range -> same instants) and clean tooltip times.
  const step = chooseStepMs(to - from, opts.points);
  const windowMs = opts.windowSecs * 1000;
  const instants: number[] = [];
  for (
    let t = Math.ceil(from / step) * step;
    t <= to && instants.length < CC_SLO_BUDGET_MAX_POINTS;
    t += step
  ) {
    instants.push(t);
  }
  if (instants.length === 0) return [];

  // Bounded concurrency: N heavy scans, capped so one chart load can't flood
  // ClickHouse with the whole series at once.
  const run = createLimiter(8);
  const rows = await Promise.all(
    instants.map((t) =>
      run(undefined, async () => {
        const grouped = await clickhouse<SliRow>(opts.sliSql, {
          window_start: fmtCh(t - windowMs),
          window_end: fmtCh(t),
        });
        let good = 0;
        let valid = 0;
        for (const r of grouped) {
          good += Number(r.good) || 0;
          valid += Number(r.valid) || 0;
        }
        return {
          t: new Date(t).toISOString(),
          good,
          valid,
          budgetRemaining: budgetRemaining(good, valid, opts.targetPercent),
        };
      }),
    ),
  );
  return rows;
}
