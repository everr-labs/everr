import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: vi.fn(),
  querySqlApi: vi.fn(),
}));

import { query } from "#app/lib/clickhouse.ts";
import { getWorkflowCostSummary } from "./server";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWorkflowCostSummary", () => {
  it("plots every UTC date a viewer's day touches", async () => {
    const spend = { labels: '["ubuntu-latest"]', durationMs: "60000", roundedMinutes: "1" };
    mockedQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { date: "2026-11-19", ...spend },
        { date: "2026-11-20", ...spend },
      ]);

    // Today in New York: 05:00Z on the 19th to 04:59Z on the 20th.
    const result = await getWorkflowCostSummary({
      data: {
        timeRange: { from: "2026-11-19T05:00:00.000Z", to: "2026-11-20T04:59:59.999Z" },
        workflowName: "ci",
        repo: "everr-labs/everr",
      },
    });

    expect(result.overTime).toHaveLength(2);
    expect(result.overTime.every((cost) => cost > 0)).toBe(true);
  });
});
