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

/** Upper bound on trailing-window evals spread across the selected range. */
const CC_SLO_BUDGET_MAX_POINTS = 200;

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
    /** Points to plot across [from, to]; clamped to CC_SLO_BUDGET_MAX_POINTS. */
    points: number;
  },
): Promise<CcSloBudgetPoint[]> {
  const from = Date.parse(opts.fromISO);
  const to = Date.parse(opts.toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  const n = Math.max(2, Math.min(opts.points, CC_SLO_BUDGET_MAX_POINTS));
  const step = (to - from) / (n - 1);
  const windowMs = opts.windowSecs * 1000;
  const instants = Array.from({ length: n }, (_, i) => from + i * step);

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
