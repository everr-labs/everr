import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getHomeOverview } from "./server";

const mockedQuery = vi.mocked(query);
const timeRange = {
  from: "2026-08-11T00:00:00.000Z",
  to: "2026-08-12T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue([]);
});

describe("getHomeOverview", () => {
  it("returns zeroed stats when ClickHouse has no rows", async () => {
    const result = await getHomeOverview({ data: { timeRange } });

    expect(result.logs.total).toBe(0);
    expect(result.traces.total).toBe(0);
    expect(result.services).toEqual([]);
    expect(result.errors.issues).toBe(0);
    expect(result.ci.totalRuns).toBe(0);
    expect(result.ci.prMedianTotalTimeMs).toBe(0);
    expect(result.logs.series.length).toBeGreaterThan(0);
    expect(result.logs.series.every((v) => v === 0)).toBe(true);
  });

  it("never adds a tenant filter and uses parameterized time bounds", async () => {
    await getHomeOverview({ data: { timeRange } });

    for (const call of mockedQuery.mock.calls) {
      const sql = String(call[0]);
      expect(sql).not.toContain("SQL_everr_tenant_id");
      expect(sql).toContain("{fromTime:String}");
      expect(sql).toContain("{toTime:String}");
    }
  });

  it("fills bucketed series across the whole range and sums totals", async () => {
    // 24h range at hour granularity: 25 bucket slots (inclusive bounds).
    const bucket = (h: number) =>
      `2026-08-11T${String(h).padStart(2, "0")}:00:00Z`;

    mockedQuery.mockImplementation(async (sql: string) => {
      // Checked before logCount: the per-service logs query also selects logCount.
      if (sql.includes("AS errorCount")) {
        return [
          { service: "web", logCount: "200", errorCount: "4" },
          { service: "worker", logCount: "50", errorCount: "0" },
        ];
      }
      if (sql.includes("AS logCount")) {
        // WITH ROLLUP: the empty-bucket row carries range-wide totals.
        return [
          { bucket: bucket(0), logCount: "10", issueCount: "0" },
          { bucket: bucket(2), logCount: "3", issueCount: "5" },
          { bucket: bucket(5), logCount: "7", issueCount: "0" },
          { bucket: "", logCount: "20", issueCount: "6" },
        ];
      }
      // Checked before the series query: both select traceCount.
      if (sql.includes("GROUP BY service")) {
        return [{ service: "web", traceCount: "12" }];
      }
      if (sql.includes("AS traceCount")) {
        // WITH ROLLUP: the empty-bucket row carries the range-wide uniq.
        return [
          { bucket: bucket(1), traceCount: "3" },
          { bucket: "", traceCount: "42" },
        ];
      }
      if (sql.includes("AS runCount")) {
        return [
          { bucket: bucket(3), runCount: "4" },
          { bucket: bucket(4), runCount: "6" },
          { bucket: "", runCount: "10" },
        ];
      }
      if (sql.includes("AS prMedianTotalTimeMs")) {
        return [{ prMedianTotalTimeMs: "300000" }];
      }
      return [];
    });

    const result = await getHomeOverview({ data: { timeRange } });

    expect(result.logs.total).toBe(20);
    expect(result.logs.series[0]).toBe(10);
    expect(result.logs.series[5]).toBe(7);
    expect(result.traces.total).toBe(42);
    expect(result.services).toEqual([
      {
        name: "web",
        logCount: 200,
        traceCount: 12,
        errorCount: 4,
      },
      {
        name: "worker",
        logCount: 50,
        traceCount: 0,
        errorCount: 0,
      },
    ]);
    expect(result.errors.issues).toBe(6);
    expect(result.errors.series[2]).toBe(5);
    expect(result.ci.totalRuns).toBe(10);
    expect(result.ci.prMedianTotalTimeMs).toBe(300000);
    expect(result.ci.series[3]).toBe(4);
    // Every series spans the same fixed bucket grid.
    expect(result.traces.series.length).toBe(result.logs.series.length);
    expect(result.ci.series.length).toBe(result.logs.series.length);
  });
});
