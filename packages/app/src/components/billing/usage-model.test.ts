import { describe, expect, it } from "vitest";
import type { OrgUsage, OrgUsageSeriesPoint } from "@/data/usage";
import {
  buildUsageChartRows,
  buildUsageTotals,
  formatUsageBytes,
  formatUsagePercent,
  formatUsagePeriod,
  hasUsageChartData,
  isTopUsageMeter,
} from "./usage-model";

describe("billing usage model", () => {
  it("fills every UTC day and missing signal with zero", () => {
    const points: OrgUsageSeriesPoint[] = [
      { date: "2026-08-30", meter: "logs", bytes: 5, items: 1 },
      { date: "2026-09-01", meter: "metrics", bytes: 8, items: 2 },
    ];

    expect(
      buildUsageChartRows(points, {
        from: new Date("2026-08-30T12:00:00.000Z"),
        to: new Date("2026-09-02T00:00:00.000Z"),
      }),
    ).toEqual([
      { date: "2026-08-30", traces: 0, logs: 5, metrics: 0 },
      { date: "2026-08-31", traces: 0, logs: 0, metrics: 0 },
      { date: "2026-09-01", traces: 0, logs: 0, metrics: 8 },
    ]);
  });

  it("sums duplicate totals and ignores unknown future meters", () => {
    const rows = [
      { meter: "logs", bytes: 10, items: 2 },
      { meter: "logs", bytes: 15, items: 3 },
      { meter: "queries", bytes: 999, items: 999 },
    ] as OrgUsage[];

    expect(buildUsageTotals(rows)).toEqual({
      traces: { bytes: 0, items: 0 },
      logs: { bytes: 25, items: 5 },
      metrics: { bytes: 0, items: 0 },
    });
  });

  it("ignores points outside the requested period", () => {
    const points = [
      { date: "2026-07-31", meter: "logs", bytes: 10, items: 1 },
      { date: "2026-08-01", meter: "traces", bytes: 20, items: 1 },
      { date: "2026-09-01", meter: "metrics", bytes: 30, items: 1 },
    ] as OrgUsageSeriesPoint[];
    const rows = buildUsageChartRows(points, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(rows[0]).toEqual({
      date: "2026-08-01",
      traces: 20,
      logs: 0,
      metrics: 0,
    });
    expect(rows.at(-1)?.date).toBe("2026-08-31");
    expect(hasUsageChartData(rows)).toBe(true);
  });

  it("detects an all-zero series as empty", () => {
    const rows = buildUsageChartRows([], {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-03T00:00:00.000Z"),
    });

    expect(rows).toHaveLength(2);
    expect(hasUsageChartData(rows)).toBe(false);
  });

  it("identifies the top visible signal for each stacked row", () => {
    const logsOnly = { date: "2026-08-01", traces: 0, logs: 5, metrics: 0 };
    const tracesAndMetrics = {
      date: "2026-08-02",
      traces: 3,
      logs: 0,
      metrics: 7,
    };

    expect(isTopUsageMeter(logsOnly, "logs")).toBe(true);
    expect(isTopUsageMeter(logsOnly, "metrics")).toBe(false);
    expect(isTopUsageMeter(tracesAndMetrics, "metrics")).toBe(true);
  });

  it("formats decimal bytes, small percentages, and half-open periods", () => {
    expect(formatUsageBytes(1_250_000_000)).toBe("1.25 GB");
    expect(formatUsageBytes(0.5)).toBe("0.5 B");
    expect(formatUsageBytes(0.001)).toBe("0.001 B");
    expect(formatUsageBytes(0)).toBe("0 B");
    expect(formatUsagePercent(0.04)).toBe("<0.1%");
    expect(
      formatUsagePeriod({
        from: new Date("2026-08-01T00:00:00.000Z"),
        to: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).toBe("Aug 1 to Aug 31, 2026");
  });

  it("promotes values whose display rounding crosses a decimal unit", () => {
    expect(formatUsageBytes(999_949)).toBe("999.9 KB");
    expect(formatUsageBytes(999_999)).toBe("1 MB");
    expect(formatUsageBytes(999_999_999)).toBe("1 GB");
    expect(formatUsageBytes(999_999_999_999)).toBe("1 TB");
    expect(formatUsageBytes(999_999_999_999_999)).toBe("1 PB");
  });
});
