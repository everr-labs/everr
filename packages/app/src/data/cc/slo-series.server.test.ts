import { describe, expect, it } from "vitest";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import { querySloBudgetSeries } from "./slo-series.server";

// A stub SLI: returns the rows this fixture declares for every window, so the
// series' shaping is exercised without a database. `rowsFor` receives the
// window_end each scan asks for, which lets a group appear only in some windows.
function stubClickhouse(
  rowsFor: (windowEnd: string) => Record<string, string>[],
): ClickhouseQuery {
  return (async (_sql: string, params?: Record<string, unknown>) =>
    rowsFor(String(params?.window_end))) as ClickhouseQuery;
}

const BASE = {
  sliSql: "SELECT 1 WHERE {window_start:DateTime} < {window_end:DateTime}",
  labelColumns: ["ServiceName"],
  targetPercent: 99.5,
  windowSecs: 3600,
  fromISO: "2026-07-28 00:00:00",
  toISO: "2026-07-28 04:00:00",
  points: 4,
};

describe("querySloBudgetSeries", () => {
  it("keeps each SLI group on its own series instead of pooling them", async () => {
    // The shape that made the chart lie: one huge clean group and one small
    // exhausted one. Pooled, this reads 99.7% (a healthy ~39% budget) and hides
    // the group that is 34x past its line.
    const series = await querySloBudgetSeries(
      stubClickhouse(() => [
        { ServiceName: "github-actions", good: "28708", valid: "28708" },
        { ServiceName: "everr-dev-app", good: "546", valid: "664" },
      ]),
      BASE,
    );

    expect(series.map((s) => s.key)).toEqual([
      "github-actions",
      "everr-dev-app",
    ]);
    expect(series[0].labels).toEqual({ ServiceName: "github-actions" });

    const budgets = series.map((s) => s.points.at(-1)?.budgetRemaining);
    // Full budget for the clean group; deeply overspent for the other. Neither
    // is the pooled 0.39 that summing good/valid first would have produced.
    expect(budgets[0]).toBe(1);
    expect(budgets[1]).toBeCloseTo(-34.54, 2);
  });

  it("reports a window with no row for a group as null, not as zero budget", async () => {
    // A group that stops reporting has no measurement, which is different from
    // measuring a budget of zero: the chart must draw a gap, not a crash to 0%.
    const series = await querySloBudgetSeries(
      stubClickhouse((windowEnd) =>
        windowEnd.endsWith("02:00:00")
          ? [{ ServiceName: "alpha", good: "10", valid: "10" }]
          : [
              { ServiceName: "alpha", good: "10", valid: "10" },
              { ServiceName: "beta", good: "10", valid: "10" },
            ],
      ),
      BASE,
    );

    const beta = series.find((s) => s.key === "beta");
    expect(beta).toBeDefined();
    const missing = beta?.points.filter((p) => p.valid === null) ?? [];
    expect(missing).toHaveLength(1);
    expect(missing[0].budgetRemaining).toBeNull();
    // Every group is on the same instant grid, gaps included, so the chart can
    // index them all by point position.
    for (const s of series) {
      expect(s.points.map((p) => p.t)).toEqual(
        series[0].points.map((p) => p.t),
      );
    }
  });

  it("gives a scalar SLO one group keyed by nothing", async () => {
    const series = await querySloBudgetSeries(
      stubClickhouse(() => [{ good: "99", valid: "100" }]),
      { ...BASE, labelColumns: [] },
    );

    expect(series).toHaveLength(1);
    expect(series[0].key).toBe("");
    expect(series[0].labels).toEqual({});
    // 1% bad against a 0.5% budget is a 2x burn, so one budget over.
    expect(series[0].points.at(-1)?.budgetRemaining).toBeCloseTo(-1, 6);
  });
});
