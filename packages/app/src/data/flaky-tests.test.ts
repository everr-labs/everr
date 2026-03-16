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
import { getTestHistory } from "./flaky-tests";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTestHistory", () => {
  it("applies limit and offset to test execution history queries", async () => {
    mockedQuery.mockResolvedValue([
      {
        trace_id: "trace-1",
        run_id: "run-1",
        run_attempt: "2",
        head_sha: "abc123",
        head_branch: "main",
        test_result: "pass",
        test_duration: "3.5",
        runner_name: "ubuntu-latest",
        workflow_name: "CI",
        job_name: "test",
        timestamp: "2026-03-09 12:00:00",
      },
    ]);

    const result = await getTestHistory({
      data: {
        repo: "everr-labs/everr",
        testModule: "suite",
        testName: "should work",
        limit: 25,
        offset: 50,
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        repo: "everr-labs/everr",
        testModule: "suite",
        testNamePattern: "%should work%",
        limit: 25,
        offset: 50,
      }),
    );
    expect(result).toEqual([
      {
        traceId: "trace-1",
        runId: "run-1",
        attempts: 2,
        headSha: "abc123",
        headBranch: "main",
        testResult: "pass",
        testDuration: 3.5,
        runnerName: "ubuntu-latest",
        workflowName: "CI",
        jobName: "test",
        timestamp: "2026-03-09 12:00:00",
      },
    ]);
  });
});
