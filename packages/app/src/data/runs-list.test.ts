import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: vi.fn(() => {
    const chain = {
      inputValidator: () => chain,
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    };
    return chain;
  }),
}));

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getRunsList } from "./runs-list";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRunsList", () => {
  it("merges completed and active runs when using explicit limit and offset", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          trace_id: "trace-1",
          run_id: "run-1",
          run_attempt: "1",
          workflowName: "CI",
          repo: "everr-labs/everr",
          branch: "main",
          status: "completed",
          conclusion: "success",
          duration: "120",
          timestamp: "2026-03-09 12:00:00",
          sender: "octocat",
          headSha: "abc123",
          jobCount: "4",
          htmlUrl: "",
        },
        {
          trace_id: "",
          run_id: "run-2",
          run_attempt: "0",
          workflowName: "Deploy",
          repo: "everr-labs/everr",
          branch: "main",
          status: "in_progress",
          conclusion: "",
          duration: "45000",
          timestamp: "2026-03-09 12:05:00",
          sender: "",
          headSha: "def456",
          jobCount: "0",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/2",
        },
      ])
      .mockResolvedValueOnce([{ total: "2" }]);

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
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("UNION ALL");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("FROM app.cdevents");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
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
          status: "completed",
          conclusion: "success",
          duration: 120,
          timestamp: "2026-03-09 12:00:00",
          sender: "octocat",
          headSha: "abc123",
          jobCount: 4,
        },
        {
          runId: "run-2",
          workflowName: "Deploy",
          repo: "everr-labs/everr",
          branch: "main",
          status: "in_progress",
          conclusion: "",
          duration: 45000,
          timestamp: "2026-03-09 12:05:00",
          sender: "",
          headSha: "def456",
          jobCount: 0,
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/2",
        },
      ],
      totalCount: 2,
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

  it("applies status filtering across the merged result set", async () => {
    mockedQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: "0" }]);

    await getRunsList({
      data: {
        status: "queued",
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "status = {status:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        status: "queued",
      }),
    );
  });

  it("promotes queued pipeline runs to in_progress when active jobs exist", async () => {
    mockedQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: "0" }]);

    await getRunsList({
      data: {
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "event_kind IN ('taskrun', 'workflowjob')",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "countIf(event_phase != 'finished') as activeJobCount",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "coalesce(activeJobCount, 0) > 0",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "coalesce(lastActiveJobEventTime, max(event_time))",
    );
  });

  it("only enriches failing steps for completed failed runs with a trace id", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          trace_id: "trace-1",
          run_id: "run-1",
          run_attempt: "1",
          workflowName: "CI",
          repo: "everr-labs/everr",
          branch: "main",
          status: "completed",
          conclusion: "failure",
          duration: "120",
          timestamp: "2026-03-09 12:00:00",
          sender: "octocat",
          headSha: "abc123",
          jobCount: "4",
          htmlUrl: "",
        },
        {
          trace_id: "",
          run_id: "run-2",
          run_attempt: "0",
          workflowName: "Deploy",
          repo: "everr-labs/everr",
          branch: "main",
          status: "in_progress",
          conclusion: "",
          duration: "45000",
          timestamp: "2026-03-09 12:05:00",
          sender: "",
          headSha: "def456",
          jobCount: "0",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/2",
        },
      ])
      .mockResolvedValueOnce([{ total: "2" }])
      .mockResolvedValueOnce([
        {
          trace_id: "trace-1",
          jobName: "test",
          jobId: "job-1",
          stepNumber: "9",
          stepName: "Run tests",
        },
      ]);

    const result = await getRunsList({
      data: {
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(3);
    expect(mockedQuery.mock.calls[2]?.[1]).toEqual({ traceIds: ["trace-1"] });
    expect(result.runs[0]?.failingSteps).toEqual([
      {
        jobName: "test",
        jobId: "job-1",
        stepNumber: 9,
        stepName: "Run tests",
      },
    ]);
    expect(result.runs[1]?.failingSteps).toBeUndefined();
  });
});
