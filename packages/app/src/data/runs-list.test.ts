import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { pool } from "@/db/client";
import { query } from "@/lib/clickhouse";
import { getRunsList } from "./runs-list/server";

const mockedQuery = vi.mocked(pool.query);
const mockedClickhouseQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRunsList", () => {
  it("uses explicit limit and offset when provided", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            traceId: "trace-1",
            runId: "run-1",
            runAttempt: 1,
            workflowName: "CI",
            repo: "everr-labs/everr",
            branch: "main",
            conclusion: "success",
            startedAt: "2026-03-09T11:58:00Z",
            completedAt: "2026-03-09T12:00:00Z",
            lastEventAt: "2026-03-09T12:00:00Z",
            sender: "octocat",
          },
        ],
      } as Awaited<ReturnType<typeof mockedQuery>>)
      .mockResolvedValueOnce({
        rows: [{ count: "1" }],
      } as Awaited<ReturnType<typeof mockedQuery>>);

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
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("FROM workflow_runs");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "COALESCE(run_completed_at, last_event_at) >= $2",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([
      42,
      expect.any(Date),
      expect.any(Date),
      "everr-labs/everr",
      15,
      30,
    ]);
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
          duration: 120000,
          timestamp: "2026-03-09T12:00:00.000Z",
          sender: "octocat",
        },
      ],
      totalCount: 1,
    });
  });

  it("normalizes cancelled runs to cancellation", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [
          {
            traceId: "trace-2",
            runId: "run-2",
            runAttempt: 2,
            workflowName: "Deploy",
            repo: "everr-labs/everr",
            branch: "release",
            conclusion: "cancelled",
            startedAt: "2026-03-10T08:00:00Z",
            completedAt: "2026-03-10T08:00:30Z",
            lastEventAt: "2026-03-10T08:00:30Z",
            sender: null,
          },
        ],
      } as Awaited<ReturnType<typeof mockedQuery>>)
      .mockResolvedValueOnce({
        rows: [{ count: "1" }],
      } as Awaited<ReturnType<typeof mockedQuery>>);

    const result = await getRunsList({
      data: {
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(result).toEqual({
      runs: [
        {
          traceId: "trace-2",
          runId: "run-2",
          runAttempt: 2,
          workflowName: "Deploy",
          repo: "everr-labs/everr",
          branch: "release",
          conclusion: "cancellation",
          duration: 30000,
          timestamp: "2026-03-10T08:00:30.000Z",
          sender: "",
        },
      ],
      totalCount: 1,
    });
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([
      42,
      expect.any(Date),
      expect.any(Date),
      20,
      0,
    ]);
  });

  it("keeps searchRuns on the previous ClickHouse query", async () => {
    mockedClickhouseQuery.mockResolvedValueOnce([
      {
        trace_id: "trace-search-1",
        run_id: "42",
        workflowName: "Build & Test App",
        repo: "everr-labs/everr",
        branch: "feature/search",
        conclusion: "failure",
        timestamp: "2026-03-11 09:00:00",
      },
    ]);

    const { searchRuns } = await import("./runs-list/server");
    const result = await searchRuns({
      data: {
        query: "Build",
      },
    });

    expect(mockedClickhouseQuery).toHaveBeenCalledTimes(1);
    expect(mockedClickhouseQuery.mock.calls[0]?.[0]).toContain("FROM (");
    expect(mockedClickhouseQuery.mock.calls[0]?.[0]).toContain(
      "ResourceAttributes['cicd.pipeline.run.id'] LIKE {pattern:String}",
    );
    expect(mockedClickhouseQuery.mock.calls[0]?.[0]).toContain(
      "ResourceAttributes['cicd.pipeline.name'] ILIKE {pattern:String}",
    );
    expect(mockedClickhouseQuery.mock.calls[0]?.[1]).toEqual({
      pattern: "%Build%",
    });
    expect(result).toEqual([
      {
        traceId: "trace-search-1",
        runId: "42",
        workflowName: "Build & Test App",
        repo: "everr-labs/everr",
        branch: "feature/search",
        conclusion: "failure",
        timestamp: "2026-03-11 09:00:00",
      },
    ]);
  });
});
