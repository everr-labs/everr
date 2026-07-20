import type { ClickhouseQuery } from "@/lib/clickhouse";

/** One point of the error-budget-over-time series (one evaluation tick). */
export type CcSloBudgetPoint = {
  /** ISO 8601 UTC, e.g. "2026-07-20T13:00:00Z". */
  t: string;
  /** Good events over the budget window, summed across groups at this tick. */
  good: number;
  /** Valid events over the budget window, summed across groups at this tick. */
  valid: number;
  /**
   * Error budget remaining as a 0..1 fraction (may go negative when overspent);
   * null at zero traffic. Computed by the sloBudgetRemaining ClickHouse UDF, so
   * the formula matches the engine's exactly.
   */
  budgetRemaining: number | null;
};

/**
 * The SLO's error-budget-remaining over time, reconstructed from the raw
 * (good, valid) sample gauges the engine records into app.metrics_gauge. One
 * point per evaluation tick of the budget window: the per-group counts summed
 * across groups (each (slo, eval_ts) evaluates at most once, so a plain sumIf
 * over a tick's rows never double-counts), then wrapped in the sloBudgetRemaining
 * UDF so the budget formula lives in one place. Row-level security pins the
 * tenant, so this never filters by organization_id in SQL.
 *
 * The time params are DateTime64(3) (not the column's own precision) because
 * resolveTimeRange emits millisecond strings; ClickHouse promotes for the
 * comparison against TimeUnix.
 */
// The SQL API returns every column as a string (JSONEachRow), so numeric
// aggregates arrive as strings and a nullable UDF result as string | null.
type RawRow = {
  t: string;
  good: string;
  valid: string;
  budgetRemaining: string | null;
};

export async function querySloBudgetSeries(
  clickhouse: ClickhouseQuery,
  opts: {
    sloId: string;
    /** Budget window key as the engine stamps it, e.g. "2592000s". */
    window: string;
    targetPercent: number;
    fromISO: string;
    toISO: string;
    limit: number;
  },
): Promise<CcSloBudgetPoint[]> {
  const rows = await clickhouse<RawRow>(
    `
      SELECT
        concat(formatDateTime(TimeUnix, '%Y-%m-%dT%H:%i:%S', 'UTC'), 'Z') AS t,
        sumIf(Value, MetricName = 'cc.slo.good')  AS good,
        sumIf(Value, MetricName = 'cc.slo.valid') AS valid,
        sloBudgetRemaining(
          sumIf(Value, MetricName = 'cc.slo.good'),
          sumIf(Value, MetricName = 'cc.slo.valid'),
          {target:Float64}
        ) AS budgetRemaining
      FROM app.metrics_gauge
      WHERE ScopeName = 'everr.slo'
        AND MetricName IN ('cc.slo.good', 'cc.slo.valid')
        AND Attributes['slo.id'] = {sloId:String}
        AND Attributes['slo.window'] = {window:String}
        AND TimeUnix >= {fromTime:DateTime64(3)}
        AND TimeUnix <= {toTime:DateTime64(3)}
      GROUP BY TimeUnix
      ORDER BY TimeUnix ASC
      LIMIT {limit:UInt32}
    `,
    {
      sloId: opts.sloId,
      window: opts.window,
      target: opts.targetPercent,
      fromTime: opts.fromISO,
      toTime: opts.toISO,
      limit: opts.limit,
    },
  );
  return rows.map((r) => ({
    t: r.t,
    good: Number(r.good),
    valid: Number(r.valid),
    budgetRemaining:
      r.budgetRemaining === null ? null : Number(r.budgetRemaining),
  }));
}
