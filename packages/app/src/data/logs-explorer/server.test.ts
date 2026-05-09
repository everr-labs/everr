import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import {
  getLogDetail,
  getLogFilterOptions,
  getLogsExplorer,
  getLogsHistogram,
  getLogsTotals,
} from "./server";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLogsExplorer", () => {
  it("queries time-bounded logs with parameterized filters", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        timestampRaw: "2026-03-09 12:00:03",
        level: "error",
        body: "Error: timeout",
        traceId: "trace-1",
        spanId: "span-1",
        serviceName: "github-actions",
        bodyHash: "12345",
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
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("FROM logs");
    expect(sql).toContain(
      "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    );
    expect(sql).toContain("positionCaseInsensitive(Body, {query:String}) > 0");
    expect(sql).toContain("ServiceName IN {services:Array(String)}");
    expect(sql).toContain("TraceId = {traceId:String}");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(sql).toContain("IN {levels:Array(String)}");
    expect(sql).not.toContain("count()");
    expect(sql).not.toContain("toStartOfInterval");
    expect(sql).not.toContain("ResourceAttributes['vcs.ref.head.name']");
    expect(sql).not.toContain("cicd.pipeline.task.run.id");
    expect(sql).toContain("toString(cityHash64(Body)) AS bodyHash");
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
      identity: {
        timestampRaw: "2026-03-09 12:00:03",
        traceId: "trace-1",
        spanId: "span-1",
        serviceName: "github-actions",
        bodyHash: "12345",
      },
    });
  });
});

describe("getLogDetail", () => {
  it("looks up a single row by identity tuple and returns full attribute maps", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        timestampRaw: "2026-03-09 12:00:03.123456789",
        level: "error",
        severityText: "ERROR",
        severityNumber: "17",
        serviceName: "github-actions",
        traceId: "trace-1",
        spanId: "span-1",
        resourceAttributes: { "vcs.repository.name": "everr-labs/everr" },
        logAttributes: { "everr.github.workflow_job_step.number": "3" },
        scopeAttributes: { "cicd.pipeline.task.name": "test" },
      },
    ]);

    const result = await getLogDetail({
      data: {
        timestampRaw: "2026-03-09 12:00:03.123456789",
        traceId: "trace-1",
        spanId: "span-1",
        serviceName: "github-actions",
        bodyHash: "12345",
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain(
      "Timestamp = parseDateTime64BestEffort({timestampRaw:String}, 9)",
    );
    expect(sql).toContain("ServiceName = {serviceName:String}");
    expect(sql).toContain("TraceId = {traceId:String}");
    expect(sql).toContain("SpanId = {spanId:String}");
    expect(sql).toContain("toString(cityHash64(Body)) = {bodyHash:String}");
    expect(sql).toContain("ResourceAttributes AS resourceAttributes");
    expect(sql).not.toContain("Body AS body");
    expect(sql).toContain("LIMIT 1");
    expect(result.resourceAttributes["vcs.repository.name"]).toBe(
      "everr-labs/everr",
    );
    expect(result.scopeAttributes["cicd.pipeline.task.name"]).toBe("test");
    expect(result.logAttributes["everr.github.workflow_job_step.number"]).toBe(
      "3",
    );
    expect(result.severityNumber).toBe(17);
  });

  it("throws when the row cannot be found", async () => {
    mockedQuery.mockResolvedValueOnce([]);
    await expect(
      getLogDetail({
        data: {
          timestampRaw: "2026-03-09 12:00:03",
          traceId: "trace-x",
          spanId: "span-x",
          serviceName: "svc",
          bodyHash: "0",
        },
      }),
    ).rejects.toThrow("Log entry not found");
  });
});

describe("getLogsTotals", () => {
  it("returns the per-level breakdown ignoring the level filter, with totalCount summing only selected levels", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        error: "3",
        warning: "5",
        info: "20",
        debug: "0",
        trace: "0",
        unknown: "1",
      },
    ]);

    const result = await getLogsTotals({
      data: {
        timeRange: {
          from: "2026-03-09T11:00:00.000Z",
          to: "2026-03-09T13:00:00.000Z",
        },
        levels: ["error", "warning"],
        services: [],
        repos: [],
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).not.toContain("IN {levels:Array(String)}");
    expect(sql).not.toContain("LIMIT");
    expect(result.levelCounts).toEqual({
      error: 3,
      warning: 5,
      info: 20,
      debug: 0,
      trace: 0,
      unknown: 1,
    });
    expect(result.totalCount).toBe(8);
  });

  it("totalCount sums every level when no level filter is set", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        error: "1",
        warning: "2",
        info: "3",
        debug: "4",
        trace: "5",
        unknown: "6",
      },
    ]);

    const result = await getLogsTotals({
      data: {
        timeRange: {
          from: "2026-03-09T11:00:00.000Z",
          to: "2026-03-09T13:00:00.000Z",
        },
        levels: [],
        services: [],
        repos: [],
      },
    });

    expect(result.totalCount).toBe(21);
  });
});

describe("getLogsHistogram", () => {
  it("fetches only log volume buckets", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        bucket: "2026-03-09 12:00:00",
        total: "3",
        error: "1",
        warning: "1",
        info: "1",
        debug: "0",
        trace: "0",
        unknown: "0",
      },
    ]);

    const result = await getLogsHistogram({
      data: {
        timeRange: {
          from: "2026-03-09T11:00:00.000Z",
          to: "2026-03-09T13:00:00.000Z",
        },
        query: "timeout",
        levels: ["error", "warning"],
        services: ["github-actions"],
        repos: ["everr-labs/everr"],
        traceId: "trace-1",
        histogramBuckets: 24,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("toStartOfInterval");
    expect(sql).toContain("INTERVAL 300 SECOND");
    expect(sql).toContain("TimestampTime >=");
    expect(sql).toContain("positionCaseInsensitive(Body, {query:String}) > 0");
    expect(sql).toContain("IN {levels:Array(String)}");
    expect(sql).not.toContain("LIMIT {limit:UInt32}");
    expect(sql).not.toContain("PREWHERE");
    expect(sql).not.toContain("SQL_everr_tenant_id");
    expect(result.find((bucket) => bucket.total === 3)).toMatchObject({
      timestamp: "2026-03-09T12:00:00.000Z",
      endTimestamp: "2026-03-09T12:05:00.000Z",
      total: 3,
      error: 1,
      warning: 1,
      info: 1,
    });
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
