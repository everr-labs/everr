import type { ClickhouseQuery } from "@/lib/clickhouse";
import { createLimiter } from "@/lib/limiter";
import { CC_SLO_INGEST_DELAY_SECS, type CcFreshBudgetGroup } from "./slo";

/** One point of one group's error-budget-over-time series. */
export type CcSloBudgetPoint = {
  /** ISO 8601 UTC, e.g. "2026-07-20T13:00:00Z". */
  t: string;
  /** Good events over the budget window ending at `t`. Null: no rows. */
  good: number | null;
  /** Valid events over the budget window ending at `t`. Null: no rows. */
  valid: number | null;
  /**
   * Error budget remaining as a 0..1 fraction (may go negative when overspent);
   * null at zero traffic (or a 100% target). Derived here from good/valid with
   * the same formula as the engine's `sloBudgetRemaining` (engine/slo_math.rs).
   */
  budgetRemaining: number | null;
};

/**
 * One SLI group's budget over time. A grouped SLO promises its target to each
 * group SEPARATELY, so each gets its own line: pooling them into one series
 * would let a big healthy group bury a small exhausted one, and the resulting
 * figure would answer no objective anyone declared.
 */
export type CcSloBudgetGroupSeries = {
  /** Stable identity for the group: its label values, joined. "" when scalar. */
  key: string;
  /** The SLI's label columns and their values for this group; {} when scalar. */
  labels: Record<string, string>;
  /** One entry per plotted instant, on the same grid for every group. */
  points: CcSloBudgetPoint[];
};

/**
 * Group identity from an SLI row: the label values in `labelColumns` order,
 * NUL-separated so no combination of values can forge another group's key.
 */
function groupKeyOf(
  row: Record<string, string>,
  labelColumns: string[],
): { key: string; labels: Record<string, string> } {
  const labels: Record<string, string> = {};
  for (const col of labelColumns) labels[col] = row[col] ?? "";
  return { key: labelColumns.map((c) => labels[c]).join("\0"), labels };
}

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

/**
 * SLI window bounds for an instant, mirroring the engine's `sli_window_bounds`:
 * the window ends the ingest-delay allowance before the instant so it reads
 * only settled rows, and keeps its full length.
 */
function sliWindowMs(
  instantMs: number,
  windowSecs: number,
): { start: number; end: number } {
  const end = instantMs - CC_SLO_INGEST_DELAY_SECS * 1000;
  return { start: end - windowSecs * 1000, end };
}

/**
 * The SLO's CURRENT error budget per group, computed at read time from a single
 * SLI scan over the trailing window `[now - windowSecs, now]` — the point-in-time
 * counterpart of `querySloBudgetSeries` (which walks many trailing windows across
 * a range). One scan, grouped by the SLI's own label columns, so the status hero
 * and the listing can show budget as of page view instead of the engine's
 * throttled last evaluation (the budget window only re-evaluates every
 * ~windowSecs/12). Row-level security pins the tenant, exactly as the engine runs
 * the SLI.
 */
export async function querySloBudgetNow(
  clickhouse: ClickhouseQuery,
  opts: {
    /** The SLO's SLI SQL, parameterized on `{window_start}`/`{window_end}`. */
    sliSql: string;
    /** The SLI's grouping columns: an output row's keys beyond good/valid. */
    labelColumns: string[];
    targetPercent: number;
    /** Budget window length in seconds (the trailing window's span). */
    windowSecs: number;
    /** Read-time "now" as a ms instant; the trailing window ends here. */
    nowMs: number;
  },
): Promise<CcFreshBudgetGroup[]> {
  const { start, end } = sliWindowMs(opts.nowMs, opts.windowSecs);
  const rows = await clickhouse<Record<string, string>>(opts.sliSql, {
    window_start: fmtCh(start),
    window_end: fmtCh(end),
  });
  return rows.map((r) => {
    const labels: Record<string, string> = {};
    for (const col of opts.labelColumns) labels[col] = r[col] ?? "";
    const good = Number(r.good) || 0;
    const valid = Number(r.valid) || 0;
    return {
      labels,
      sli: valid > 0 ? good / valid : null,
      budgetRemaining: budgetRemaining(good, valid, opts.targetPercent),
    };
  });
}

/** ClickHouse `DateTime` literal ("YYYY-MM-DD HH:MM:SS", UTC) for a ms instant. */
function fmtCh(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Parse a ClickHouse UTC wall-clock string ("YYYY-MM-DD HH:MM:SS", no zone) as
 * UTC. Plain `Date.parse` reads that space-separated, zone-less form as LOCAL
 * time, which skews the whole series (and the recent edge) by the server's
 * offset. These strings are always UTC (they come from `toClickHouseDateTime`).
 */
function parseChUtc(s: string): number {
  return Date.parse(`${s.replace(" ", "T")}Z`);
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
 * The SLO's error-budget-remaining over time, PER GROUP, computed at READ TIME
 * by running the SLI query directly against the raw telemetry once per plotted
 * point. Each point is a trailing-window aggregate: the SLI over
 * `[t - window, t]`, one budget per group it returns. No stored samples and no
 * backfill are involved, so a freshly-created SLO shows history as far back as
 * the raw data goes (bounded only by telemetry retention).
 *
 * Groups are kept separate on purpose. The SLO promises its target to each
 * group, and the engine fires per group, so summing good/valid across them
 * first (as this used to) produces a figure no objective corresponds to — one
 * high-volume healthy group can hold the pooled line near 100% while another
 * sits far past its own line.
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
    /** The SLI's grouping columns: an output row's keys beyond good/valid. */
    labelColumns: string[];
    targetPercent: number;
    /** Budget window length in seconds (each point's trailing window). */
    windowSecs: number;
    fromISO: string;
    toISO: string;
    /** Target point count; the grid step is chosen to land near it (cap 200). */
    points: number;
  },
): Promise<CcSloBudgetGroupSeries[]> {
  const from = parseChUtc(opts.fromISO);
  const to = parseChUtc(opts.toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  // Snap instants to a round grid: the largest multiple of `step` at or before
  // each slot, starting at the first grid tick inside the range. Deterministic
  // across reloads (same range -> same instants) and clean tooltip times.
  const step = chooseStepMs(to - from, opts.points);
  const instants: number[] = [];
  for (
    let t = Math.ceil(from / step) * step;
    t <= to && instants.length < CC_SLO_BUDGET_MAX_POINTS;
    t += step
  ) {
    instants.push(t);
  }
  if (instants.length === 0) return [];
  // Finish exactly at `to` (now): the grid snaps ticks down, so the last tick
  // can fall a step short, and the chart's final point would then measure a
  // different window than the status hero (which reads the window ending now).
  if (
    instants[instants.length - 1] < to &&
    instants.length < CC_SLO_BUDGET_MAX_POINTS
  ) {
    instants.push(to);
  }

  // Bounded concurrency: N heavy scans, capped so one chart load can't flood
  // ClickHouse with the whole series at once.
  // Each point stays plotted at `t` even though its window ends earlier,
  // matching how the engine keys an evaluation on its instant, not the shifted
  // window end.
  const run = createLimiter(8);
  const scans = await Promise.all(
    instants.map((t) =>
      run(undefined, () => {
        const { start, end } = sliWindowMs(t, opts.windowSecs);
        return clickhouse<SliRow>(opts.sliSql, {
          window_start: fmtCh(start),
          window_end: fmtCh(end),
        });
      }),
    ),
  );

  // Pivot the scans (instant -> rows) into groups (group -> points). A group is
  // discovered the first time any window returns it; instants where it produced
  // no row become null points, which the chart draws as gaps rather than as a
  // budget of zero. Insertion order is preserved so the output is deterministic.
  const series = new Map<string, CcSloBudgetGroupSeries>();
  const byInstant = scans.map((rows) => {
    const seen = new Map<string, SliRow>();
    for (const row of rows) {
      const { key, labels } = groupKeyOf(row, opts.labelColumns);
      seen.set(key, row);
      if (!series.has(key)) series.set(key, { key, labels, points: [] });
    }
    return seen;
  });

  for (const group of series.values()) {
    group.points = instants.map((t, i) => {
      const row = byInstant[i].get(group.key);
      const good = row === undefined ? null : Number(row.good) || 0;
      const valid = row === undefined ? null : Number(row.valid) || 0;
      return {
        t: new Date(t).toISOString(),
        good,
        valid,
        budgetRemaining:
          good === null || valid === null
            ? null
            : budgetRemaining(good, valid, opts.targetPercent),
      };
    });
  }
  return [...series.values()];
}
