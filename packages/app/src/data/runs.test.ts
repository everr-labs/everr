import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getRunJobs, getRunSpans, getStepLogs } from "./runs/server";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRunJobs", () => {
  it("queries job durations from max(Duration)", async () => {
    mockedQuery.mockResolvedValue([
      {
        jobId: "job-1",
        name: "build",
        conclusion: "success",
        duration: "1200",
      },
    ]);

    const result = await getRunJobs({ data: "trace-1" });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "max(Duration) / 1000000 as duration",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "WHERE TraceId = {traceId:String}",
    );
    expect(result).toEqual([
      {
        jobId: "job-1",
        name: "build",
        conclusion: "success",
        duration: 1200,
      },
    ]);
  });
});

describe("getRunSpans", () => {
  it("maps the isSuite attribute when present", async () => {
    mockedQuery.mockResolvedValue([
      {
        spanId: "suite-span",
        parentSpanId: "step-span",
        name: "formatDuration",
        startTime: "1000",
        endTime: "2000",
        duration: "1000",
        conclusion: "",
        jobId: "job-1",
        jobName: "test",
        stepNumber: "3",
        createdAt: "",
        startedAt: "",
        headBranch: "",
        headSha: "",
        runnerName: "",
        labels: "",
        sender: "",
        runAttempt: "",
        htmlUrl: "",
        testName: "src/test.ts > formatDuration",
        testResult: "pass",
        testDuration: "1",
        testFramework: "vitest",
        testLanguage: "typescript",
        isSubtest: "1",
        isSuite: "true",
      },
    ]);

    const result = await getRunSpans({ data: "trace-1" });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("everr.test.is_suite");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "ResourceAttributes['everr.test.framework']",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "ResourceAttributes['everr.test.language']",
    );
    expect(result).toEqual([
      {
        spanId: "suite-span",
        parentSpanId: "step-span",
        name: "formatDuration",
        startTime: 1000,
        endTime: 2000,
        duration: 1000,
        conclusion: "success",
        jobId: "job-1",
        jobName: "test",
        stepNumber: "3",
        queueTime: undefined,
        headBranch: undefined,
        headSha: undefined,
        runnerName: undefined,
        labels: undefined,
        sender: undefined,
        runAttempt: undefined,
        htmlUrl: undefined,
        testName: "src/test.ts > formatDuration",
        testResult: "pass",
        testDuration: 1,
        testFramework: "vitest",
        testLanguage: "typescript",
        isSubtest: true,
        isSuite: true,
      },
    ]);
  });
});

describe("getStepLogs", () => {
  it("normalizes full log timestamps to timezone-aware UTC ISO strings", async () => {
    mockedQuery.mockResolvedValueOnce([{ cnt: "2" }]).mockResolvedValueOnce([
      {
        timestamp: "2026-03-09T12:00:01",
        body: "Compiling",
      },
      {
        timestamp: "2026-03-09 12:00:00.123",
        body: "Starting build",
      },
    ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "WHERE TraceId = {traceId:String}",
    );
    expect(result).toEqual({
      logs: [
        {
          timestamp: "2026-03-09T12:00:00.123Z",
          body: "Starting build",
        },
        {
          timestamp: "2026-03-09T12:00:01.000Z",
          body: "Compiling",
        },
      ],
      totalCount: 2,
      offset: 0,
    });
  });

  it("uses tail mode when tail param is provided", async () => {
    mockedQuery.mockResolvedValueOnce([{ cnt: "1" }]).mockResolvedValueOnce([
      {
        timestamp: "2026-03-09 12:00:02",
        body: "Last line",
      },
    ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        tail: 500,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[1]?.[0]).toContain("ORDER BY Timestamp DESC");
    expect(mockedQuery.mock.calls[1]?.[0]).toContain("LIMIT {maxLines:UInt32}");
    expect(mockedQuery.mock.calls[1]?.[2]).toMatchObject({
      maxLines: 500,
    });
    expect(result).toEqual({
      logs: [
        {
          timestamp: "2026-03-09T12:00:02.000Z",
          body: "Last line",
        },
      ],
      totalCount: 1,
      offset: 0,
    });
  });

  it("uses oldest-first limit and offset for explicit raw log paging", async () => {
    mockedQuery.mockResolvedValueOnce([{ cnt: "2001" }]).mockResolvedValueOnce([
      {
        timestamp: "2026-03-09 12:00:03",
        body: "Line three",
      },
    ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        limit: 1001,
        offset: 1000,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[1]?.[0]).toContain("ORDER BY Timestamp ASC");
    expect(mockedQuery.mock.calls[1]?.[0]).toContain("LIMIT {maxLines:UInt32}");
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "OFFSET {offsetLines:UInt32}",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "WHERE TraceId = {traceId:String}",
    );
    expect(mockedQuery.mock.calls[1]?.[2]).toEqual({
      traceId: "trace-1",
      jobName: "build",
      stepNumber: "2",
      maxLines: 1001,
      offsetLines: 1000,
    });
    expect(result).toEqual({
      logs: [
        {
          timestamp: "2026-03-09T12:00:03.000Z",
          body: "Line three",
        },
      ],
      totalCount: 2001,
      offset: 1000,
    });
  });

  it("defaults paged raw logs to 1000 lines when only an offset is provided", async () => {
    mockedQuery.mockResolvedValueOnce([{ cnt: "5000" }]).mockResolvedValueOnce([
      {
        timestamp: "2026-03-09 12:00:04",
        body: "Line four",
      },
    ]);

    await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        offset: 2000,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[1]?.[2]).toMatchObject({
      maxLines: 1000,
      offsetLines: 2000,
    });
  });

  it("adds match(Body) clause to both count and fetch queries when egrep is set", async () => {
    mockedQuery
      .mockResolvedValueOnce([{ cnt: "3" }])
      .mockResolvedValueOnce([
        { timestamp: "2026-03-09 12:00:00", body: "Error: timeout" },
      ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        egrep: "Error",
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "match(Body, {egrep:String})",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "match(Body, {egrep:String})",
    );
    expect(mockedQuery.mock.calls[0]?.[2]).toMatchObject({ egrep: "Error" });
    expect(mockedQuery.mock.calls[1]?.[2]).toMatchObject({ egrep: "Error" });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]?.body).toBe("Error: timeout");
  });

  it("omits match(Body) clause when egrep is not set", async () => {
    mockedQuery
      .mockResolvedValueOnce([{ cnt: "1" }])
      .mockResolvedValueOnce([
        { timestamp: "2026-03-09 12:00:00", body: "ok" },
      ]);

    await getStepLogs({
      data: { traceId: "trace-1", jobName: "build", stepNumber: "2" },
    });

    expect(mockedQuery.mock.calls[0]?.[0]).not.toContain("match(Body");
    expect(mockedQuery.mock.calls[1]?.[0]).not.toContain("match(Body");
  });
});
