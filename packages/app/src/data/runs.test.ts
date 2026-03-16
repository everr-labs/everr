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
import {
  buildFailingLinePredicateSql,
  buildFailingStepLogsSql,
  getRunJobs,
  getRunSpans,
  getStepLogs,
} from "./runs";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRunJobs", () => {
  it("uses a Float64 zero for skipped job durations", async () => {
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
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("toFloat64(0)");
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
    mockedQuery.mockResolvedValue([
      {
        timestamp: "2026-03-09 12:00:00.123",
        body: "Starting build",
      },
      {
        timestamp: "2026-03-09T12:00:01",
        body: "Compiling",
      },
    ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        fullLogs: true,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "WHERE TraceId = {traceId:String}",
    );
    expect(result).toEqual([
      {
        timestamp: "2026-03-09T12:00:00.123Z",
        body: "Starting build",
      },
      {
        timestamp: "2026-03-09T12:00:01.000Z",
        body: "Compiling",
      },
    ]);
  });

  it("normalizes focused failing log timestamps before returning them", async () => {
    mockedQuery.mockResolvedValueOnce([{ hit: "1" }]).mockResolvedValueOnce([
      {
        timestamp: "2026-03-09 12:00:02",
        body: "##[error]Build failed",
      },
    ]);

    const result = await getStepLogs({
      data: {
        traceId: "trace-1",
        jobName: "build",
        stepNumber: "2",
        fullLogs: false,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("SELECT 1 as hit");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("LIMIT 1");
    expect(result).toEqual([
      {
        timestamp: "2026-03-09T12:00:02.000Z",
        body: "##[error]Build failed",
      },
    ]);
  });

  it("uses oldest-first limit and offset for explicit raw log paging", async () => {
    mockedQuery.mockResolvedValue([
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

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("ORDER BY Timestamp ASC");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("LIMIT {maxLines:UInt32}");
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "OFFSET {offsetLines:UInt32}",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "WHERE TraceId = {traceId:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual({
      traceId: "trace-1",
      jobName: "build",
      stepNumber: "2",
      maxLines: 1001,
      offsetLines: 1000,
    });
    expect(result).toEqual([
      {
        timestamp: "2026-03-09T12:00:03.000Z",
        body: "Line three",
      },
    ]);
  });

  it("defaults paged raw logs to 1000 lines when only an offset is provided", async () => {
    mockedQuery.mockResolvedValue([
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

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[1]).toMatchObject({
      maxLines: 1000,
      offsetLines: 2000,
    });
  });
});

describe("buildFailingStepLogsSql", () => {
  it("uses a windowed anchor scan instead of materializing anchor arrays", () => {
    const sql = buildFailingStepLogsSql();

    expect(sql).toContain("ROWS BETWEEN 50 PRECEDING");
    expect(sql).toContain("AND 50 FOLLOWING");
    expect(sql).not.toContain("groupArray");
    expect(sql).not.toContain("arrayExists");
  });
});

describe("buildFailingLinePredicateSql", () => {
  it("includes the expanded failure vocabulary", () => {
    const sql = buildFailingLinePredicateSql();

    expect(sql).toContain("stack trace");
    expect(sql).toContain("connection refused");
    expect(sql).toContain("process completed with exit code");
    expect(sql).toContain("ModuleNotFound");
    expect(sql).toContain("oomkilled");
  });
});
