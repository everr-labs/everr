import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: vi.fn(),
  querySqlApi: vi.fn(),
}));

import { query } from "#app/lib/clickhouse.ts";
import { getCostByWorkflow, getCostOverTimeBreakdown, getCostOverview } from "./server";

const mockedQuery = vi.mocked(query);
const timeRange = {
  from: "2026-05-01T00:00:00.000Z",
  to: "2026-05-31T23:59:59.999Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue([]);
});

describe("cost analysis queries", () => {
  it("exposes ResourceAttributes key checks for cost overview skip indexes", async () => {
    await getCostOverview({ data: { timeRange } });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("has(ResourceAttributesKeys, 'cicd.pipeline.worker.labels')");
    expect(sql).toContain("has(ResourceAttributesKeys, 'cicd.pipeline.task.run.id')");
    expect(sql).not.toContain("PREWHERE");
    expect(sql).not.toContain("SQL_everr_tenant_id");
  });

  it("exposes ResourceAttributes key checks for workflow grouping", async () => {
    await getCostByWorkflow({ data: { timeRange } });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("has(ResourceAttributesKeys, 'cicd.pipeline.worker.labels')");
    expect(sql).toContain("has(ResourceAttributesKeys, 'cicd.pipeline.task.run.id')");
    expect(sql).toContain("has(ResourceAttributesKeys, 'vcs.repository.name')");
    expect(sql).toContain("has(ResourceAttributesKeys, 'cicd.pipeline.name')");
  });

  it("exposes ResourceAttributes key checks for over-time breakdown", async () => {
    await getCostOverTimeBreakdown({
      data: { timeRange, dimension: "repo" },
    });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("has(ResourceAttributesKeys, 'cicd.pipeline.worker.labels')");
    expect(sql).toContain("has(ResourceAttributesKeys, 'cicd.pipeline.task.run.id')");
    expect(sql).toContain("has(ResourceAttributesKeys, 'vcs.repository.name')");
  });

  it("starts the over-time hours on the viewer's clock", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        date: "2026-11-18T19:30:00Z",
        series: "everr",
        labels: '["ubuntu-latest"]',
        totalDurationMs: "60000",
        roundedMinutes: "1",
      },
    ]);

    // Today in Kolkata (UTC+5:30): 18:30Z to 18:29:59.999Z the next day.
    const result = await getCostOverTimeBreakdown({
      data: {
        timeRange: { from: "2026-11-18T18:30:00.000Z", to: "2026-11-19T18:29:59.999Z" },
        dimension: "repo",
        utcOffsetMinutes: 330,
      },
    });

    expect(result.points).toHaveLength(24);
    expect(result.points[0]?.date).toBe("2026-11-18T18:30:00Z");
    expect(result.points[1]?.cost.everr).toBeGreaterThan(0);
  });
});
