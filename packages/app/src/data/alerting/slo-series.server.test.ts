import { describe, expect, it } from "vitest";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import { querySloBudgetNow, querySloBudgetSeries } from "./slo-series.server";

// A stub SLI: returns the rows this fixture declares for every window, so the
// series' shaping is exercised without a database. `rowsFor` receives the
// window_end each scan asks for, which lets data be absent in some windows.
function stubClickhouse(
  rowsFor: (windowEnd: string) => Record<string, string>[],
): ClickhouseQuery {
  return (async (_sql: string, params?: Record<string, unknown>) =>
    rowsFor(String(params?.window_end))) as ClickhouseQuery;
}

const BASE = {
  sliSql: "SELECT 1 WHERE {window_start:DateTime} < {window_end:DateTime}",
  targetPercent: 99.5,
  windowSecs: 3600,
  fromISO: "2026-07-28 00:00:00",
  toISO: "2026-07-28 04:00:00",
  points: 4,
};

describe("querySloBudgetSeries", () => {
  it("computes one scalar budget series", async () => {
    const points = await querySloBudgetSeries(
      stubClickhouse(() => [{ good: "99", valid: "100" }]),
      BASE,
    );

    expect(points).not.toHaveLength(0);
    // 1% bad against a 0.5% budget is a 2x burn, so one budget over.
    expect(points.at(-1)?.budgetRemaining).toBeCloseTo(-1, 6);
  });

  it("reports a window with no row as null, not as zero budget", async () => {
    // Missing data is different from
    // measuring a budget of zero: the chart must draw a gap, not a crash to 0%.
    const points = await querySloBudgetSeries(
      stubClickhouse((windowEnd) =>
        // The 02:00:00 instant's window, which ends 10s earlier (ingest delay).
        windowEnd.endsWith("01:59:50") ? [] : [{ good: "10", valid: "10" }],
      ),
      BASE,
    );

    const missing = points.filter((p) => p.valid === null);
    expect(missing).toHaveLength(1);
    expect(missing[0].budgetRemaining).toBeNull();
  });

  it("normalizes floating-point noise at exactly zero budget", async () => {
    const current = await querySloBudgetNow(
      stubClickhouse(() => [{ good: "999", valid: "1000" }]),
      {
        sliSql: BASE.sliSql,
        targetPercent: 99.9,
        windowSecs: 3600,
        nowMs: Date.parse("2026-07-28T01:00:00Z"),
      },
    );

    expect(current?.budgetRemaining).toBe(0);
  });

  it("ends every window 10s before its instant, matching the engine's ingest delay", async () => {
    // The engine shifts window_end back by ALERTING_SLO_INGEST_DELAY_SECS (default
    // 10) so it reads only settled rows; read-time scans must measure the same
    // intervals or the page and the engine disagree at the recent edge. The
    // point stays plotted at its round instant.
    const windows: { start: string; end: string }[] = [];
    const capture = (async (_sql: string, params?: Record<string, unknown>) => {
      windows.push({
        start: String(params?.window_start),
        end: String(params?.window_end),
      });
      return [];
    }) as ClickhouseQuery;

    const series = await querySloBudgetSeries(capture, {
      ...BASE,
      toISO: "2026-07-28 01:00:00",
      points: 1,
    });
    expect(series).toHaveLength(2);
    // The 01:00:00 instant scans [00:59:50 - 1h, 00:59:50).
    expect(windows.at(-1)).toEqual({
      start: "2026-07-27 23:59:50",
      end: "2026-07-28 00:59:50",
    });

    windows.length = 0;
    await querySloBudgetNow(capture, {
      sliSql: BASE.sliSql,
      targetPercent: 99.5,
      windowSecs: 3600,
      nowMs: Date.parse("2026-07-28T01:00:00Z"),
    });
    expect(windows).toEqual([
      { start: "2026-07-27 23:59:50", end: "2026-07-28 00:59:50" },
    ]);
  });

  it("rejects a query that returns multiple rows", async () => {
    await expect(
      querySloBudgetSeries(
        stubClickhouse(() => [
          { good: "99", valid: "100" },
          { good: "98", valid: "100" },
        ]),
        BASE,
      ),
    ).rejects.toThrow("at most one row");
  });
});
