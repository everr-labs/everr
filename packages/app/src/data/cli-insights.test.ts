import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getSlowestJobs, getSlowestTests } from "./cli-insights";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSlowestTests", () => {
  it("maps slow test aggregates and keeps the repo and branch filters", async () => {
    mockedQuery.mockResolvedValue([
      {
        test_package: "pkg",
        test_full_name: "pkg/suite/test",
        avg_duration: "12.5",
        p95_duration: "16.2",
        max_duration: "19.4",
        executions: "8",
        pass_count: "6",
        fail_count: "2",
        skip_count: "0",
        last_seen: "2026-03-07 10:00:00",
      },
    ]);

    const result = await getSlowestTests({
      data: {
        repo: "everr-labs/everr",
        branch: "main",
        limit: 5,
        offset: 2,
        timeRange: {
          from: "now-24h",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("test_full_name");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "lowerUTF8(SpanAttributes['everr.test.is_suite']) IN ('false', '0')",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "tuple(test_package, test_full_name) NOT IN",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "tuple(SpanAttributes['everr.test.package'], replaceAll(SpanAttributes['everr.test.parent_test'], ' > ', '/'))",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
    );
    expect(mockedQuery.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        repo: "everr-labs/everr",
        branch: "main",
        limit: 5,
        offset: 2,
      }),
    );
    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: "main",
      timeRange: {
        from: "now-24h",
        to: "now",
      },
      limit: 5,
      items: [
        {
          testPackage: "pkg",
          testFullName: "pkg/suite/test",
          avgDurationSeconds: 12.5,
          p95DurationSeconds: 16.2,
          maxDurationSeconds: 19.4,
          executions: 8,
          passCount: 6,
          failCount: 2,
          skipCount: 0,
          lastSeen: "2026-03-07 10:00:00",
        },
      ],
    });
  });
});

describe("getSlowestJobs", () => {
  it("maps slow job aggregates and defaults missing workflow names", async () => {
    mockedQuery.mockResolvedValue([
      {
        workflow_name: "",
        job_name: "integration",
        avg_duration: "420",
        p95_duration: "610",
        max_duration: "720",
        executions: "4",
        success_count: "3",
        failure_count: "1",
        skip_count: "0",
        last_seen: "2026-03-07 11:00:00",
      },
    ]);

    const result = await getSlowestJobs({
      data: {
        repo: "everr-labs/everr",
        limit: 3,
        offset: 4,
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("job_executions");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
    );
    expect(mockedQuery.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        repo: "everr-labs/everr",
        limit: 3,
        offset: 4,
      }),
    );
    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: null,
      timeRange: {
        from: "now-7d",
        to: "now",
      },
      limit: 3,
      items: [
        {
          workflowName: "Workflow",
          jobName: "integration",
          avgDurationSeconds: 420,
          p95DurationSeconds: 610,
          maxDurationSeconds: 720,
          executions: 4,
          successCount: 3,
          failureCount: 1,
          skipCount: 0,
          lastSeen: "2026-03-07 11:00:00",
        },
      ],
    });
  });
});
