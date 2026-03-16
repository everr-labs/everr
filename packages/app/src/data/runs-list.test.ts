import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getRunsList } from "./runs-list/server";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRunsList", () => {
  it("uses explicit limit and offset when provided", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          trace_id: "trace-1",
          run_id: "run-1",
          run_attempt: "1",
          workflowName: "CI",
          repo: "everr-labs/everr",
          branch: "main",
          conclusion: "success",
          duration: "120",
          timestamp: "2026-03-09 12:00:00",
          sender: "octocat",
          headSha: "abc123",
          jobCount: "4",
        },
      ])
      .mockResolvedValueOnce([{ total: "1" }]);

    const result = await getRunsList({
      data: {
        repo: "everr-labs/everr",
        limit: 15,
        offset: 30,
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("toFloat64(0)");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "max(Duration) / 1000000) as duration",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        repo: "everr-labs/everr",
        limit: 15,
        offset: 30,
      }),
    );
    expect(result).toEqual({
      runs: [
        {
          traceId: "trace-1",
          runId: "run-1",
          runAttempt: 1,
          workflowName: "CI",
          repo: "everr-labs/everr",
          branch: "main",
          conclusion: "success",
          duration: 120,
          timestamp: "2026-03-09 12:00:00",
          sender: "octocat",
          headSha: "abc123",
          jobCount: 4,
        },
      ],
      totalCount: 1,
    });
  });

  it("keeps page-based pagination working for existing callers", async () => {
    mockedQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: "0" }]);

    await getRunsList({
      data: {
        page: 3,
        pageSize: 10,
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        limit: 10,
        offset: 20,
      }),
    );
  });
});
