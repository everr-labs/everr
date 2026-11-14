import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { query } from "#app/lib/clickhouse.ts";
import { getLogsExplorer } from "./logs-explorer/server";
import { searchTraces } from "./traces/server";
import { searchErrorIssues } from "./errors/server";

const queryMock = vi.mocked(query);
const timestamp = "2026-10-21 10:00:00.123456789";
const timeRange = { from: "2026-10-21T10:00:00Z", to: "2026-10-21T11:00:00Z" };
const tracesInput = { fromTs: timeRange.from, toTs: timeRange.to };

beforeEach(() => queryMock.mockReset());

describe("hosted SQL result compatibility", () => {
  it("maps log rows through the authenticated ClickHouse adapter", async () => {
    queryMock.mockResolvedValueOnce([
      {
        timestampRaw: timestamp,
        level: "info",
        body: null,
        traceId: "",
        spanId: "",
        serviceName: "api",
        bodyHash: "18446744073709551615",
      },
    ]);
    const result = await getLogsExplorer({ data: { timeRange } });
    expect(result.logs[0]).toMatchObject({
      body: "",
      level: "info",
      identity: { timestampRaw: timestamp, bodyHash: "18446744073709551615" },
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.any(String),
      "42",
      expect.objectContaining({ limit: 200 }),
    );
  });

  it("preserves trace precision and quoted counts through the hosted adapter", async () => {
    queryMock.mockResolvedValueOnce([
      {
        traceId: "trace",
        rootName: "GET /",
        rootService: "api",
        rootNamespace: "",
        rootStatus: "Unset",
        rootStatusCode: "",
        startTs: timestamp,
        durationNs: "18446744073709551615",
        spanCount: "2",
        errorCount: "0",
        services: ["api"],
      },
    ]);
    expect((await searchTraces({ data: tracesInput }))[0]).toMatchObject({
      startTs: timestamp,
      durationNs: "18446744073709551615",
      spanCount: "2",
      errorCount: "0",
    });
  });

  it("maps error summaries through the hosted adapter", async () => {
    queryMock.mockResolvedValueOnce([
      {
        fingerprint: "fp",
        exceptionType: "Error",
        exceptionMessage: "test",
        body: "test",
        latestServiceName: "api",
        services: ["api"],
        occurrenceCount: "2",
        traceCount: "1",
        firstSeen: timestamp,
        lastSeen: timestamp,
        latestTraceId: "trace",
        latestSpanId: "span",
        latestTimestamp: timestamp,
      },
    ]);
    expect((await searchErrorIssues({ data: tracesInput })).issues[0]).toMatchObject({
      firstSeen: timestamp,
      occurrenceCount: 2,
      traceCount: 1,
    });
  });

  it("passes through trace rows without adding SQL result validation", async () => {
    const rows = [{ traceId: "legacy", spanCount: "not-a-count" }];
    queryMock.mockResolvedValueOnce(rows);
    expect(await searchTraces({ data: tracesInput })).toBe(rows);
  });

  it("retains the existing error count conversion for incomplete rows", async () => {
    queryMock.mockResolvedValueOnce([{}]);
    expect((await searchErrorIssues({ data: tracesInput })).issues[0]).toMatchObject({
      occurrenceCount: Number.NaN,
      traceCount: Number.NaN,
    });
  });
});
