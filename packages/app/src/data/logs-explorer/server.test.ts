import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getLogFilterOptions, getLogsExplorer } from "./server";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLogsExplorer", () => {
  it("queries time-bounded logs with parameterized filters", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          timestamp: "2026-03-09 12:00:03",
          serviceName: "github-actions",
          level: "error",
          severityText: "ERROR",
          severityNumber: "17",
          body: "Error: timeout",
          traceId: "trace-1",
          spanId: "span-1",
          repo: "everr-labs/everr",
          branch: "main",
          workflowName: "CI",
          runId: "42",
          jobId: "99",
          jobName: "test",
          stepNumber: "3",
        },
      ])
      .mockResolvedValueOnce([
        {
          total: "1",
        },
      ])
      .mockResolvedValueOnce([
        {
          error: "1",
          warning: "2",
          info: "0",
          debug: "0",
          trace: "0",
          unknown: "0",
        },
      ])
      .mockResolvedValueOnce([
        {
          bucket: "2026-03-09 12:00:00",
          total: "1",
          error: "1",
          warning: "0",
          info: "0",
          debug: "0",
          trace: "0",
          unknown: "0",
        },
      ]);

    const result = await getLogsExplorer({
      data: {
        timeRange: {
          from: "2026-03-09T11:00:00.000Z",
          to: "2026-03-09T13:00:00.000Z",
        },
        query: "timeout",
        levels: ["error"],
        services: ["github-actions"],
        repos: ["everr-labs/everr"],
        traceId: "trace-1",
        limit: 50,
        offset: 100,
        histogramBuckets: 24,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(4);
    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    const countSql = mockedQuery.mock.calls[1]?.[0] ?? "";
    const levelCountsSql = mockedQuery.mock.calls[2]?.[0] ?? "";
    const histogramSql = mockedQuery.mock.calls[3]?.[0] ?? "";
    expect(sql).toContain("FROM logs");
    expect(sql).toContain(
      "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    );
    expect(sql).toContain("positionCaseInsensitive(Body, {query:String}) > 0");
    expect(sql).toContain("ServiceName IN {services:Array(String)}");
    expect(sql).toContain("TraceId = {traceId:String}");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(sql).toContain("IN {levels:Array(String)}");
    expect(countSql).toContain("IN {levels:Array(String)}");
    expect(levelCountsSql).not.toContain("IN {levels:Array(String)}");
    expect(histogramSql).toContain("INTERVAL 300 SECOND");
    expect(sql).not.toContain("PREWHERE");
    expect(sql).not.toContain("SQL_everr_tenant_id");
    expect(mockedQuery.mock.calls[0]?.[2]).toMatchObject({
      query: "timeout",
      levels: ["error"],
      services: ["github-actions"],
      repos: ["everr-labs/everr"],
      traceId: "trace-1",
      limit: 50,
      offset: 100,
    });
    expect(result.logs[0]).toMatchObject({
      timestamp: "2026-03-09T12:00:03.000Z",
      level: "error",
      body: "Error: timeout",
    });
    expect(result.totalCount).toBe(1);
    expect(result.levelCounts.error).toBe(1);
    expect(result.levelCounts.warning).toBe(2);
    expect(result.histogram).toHaveLength(25);
    expect(result.histogram.find((bucket) => bucket.total === 1)).toMatchObject(
      {
        timestamp: "2026-03-09T12:00:00.000Z",
        rangeLabel: "12:00 PM - 12:05 PM",
        total: 1,
      },
    );
  });

  it("can fetch additional log pages without summary queries", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        timestamp: "2026-03-09 12:00:01",
        serviceName: "api",
        level: "info",
        severityText: "INFO",
        severityNumber: "9",
        body: "loaded next page",
        traceId: "trace-2",
        spanId: "span-2",
        repo: "",
        branch: "",
        workflowName: "",
        runId: "",
        jobId: "",
        jobName: "",
        stepNumber: "",
      },
    ]);

    const result = await getLogsExplorer({
      data: {
        timeRange: {
          from: "2026-03-09T11:00:00.000Z",
          to: "2026-03-09T13:00:00.000Z",
        },
        levels: [],
        services: [],
        repos: [],
        limit: 200,
        offset: 200,
        includeSummary: false,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[2]).toMatchObject({
      limit: 200,
      offset: 200,
    });
    expect(result.logs).toHaveLength(1);
    expect(result.totalCount).toBe(0);
    expect(result.histogram).toEqual([]);
  });
});

describe("getLogFilterOptions", () => {
  it("returns distinct services and repositories for the time range", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        services: ["github-actions"],
        repos: ["everr-labs/everr"],
      },
    ]);

    const result = await getLogFilterOptions({
      data: {
        timeRange: {
          from: "now-1h",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "SELECT DISTINCT ServiceName",
    );
    expect(result).toEqual({
      services: ["github-actions"],
      repos: ["everr-labs/everr"],
    });
  });
});
