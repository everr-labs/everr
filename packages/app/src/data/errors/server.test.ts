import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import {
  ERROR_FINGERPRINT_SQL,
  EXCEPTION_LOG_FILTER_SQL,
  NORMALIZED_EXCEPTION_MESSAGE_SQL,
} from "./fingerprint";
import type {
  ErrorIssueSearch,
  ErrorSort,
  GetErrorIssueInput,
  ListErrorServicesInput,
  SearchErrorIssuesInput,
} from "./schemas";
import {
  ErrorIssueSearchSchema,
  ErrorSortSchema,
  GetErrorIssueInputSchema,
  ListErrorServicesInputSchema,
  SearchErrorIssuesInputSchema,
} from "./schemas";
import { getErrorIssue, listErrorServices, searchErrorIssues } from "./server";
import type {
  ErrorIssueDetail,
  ErrorIssueSummary,
  ErrorOccurrence,
  ErrorSort as ErrorSortDto,
} from "./types";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("error tracking schemas", () => {
  it("defaults list search params for the route", () => {
    expect(ErrorIssueSearchSchema.parse({})).toMatchObject({
      q: "",
      service: [],
      fingerprint: "",
      sort: "lastSeen",
      page: 1,
      limit: 50,
    });
  });

  it("accepts only supported sort values", () => {
    expect(ErrorSortSchema.parse("count")).toBe("count");
    expect(() => ErrorSortSchema.parse("severity")).toThrow();
  });

  it("validates server search input", () => {
    const parsed = SearchErrorIssuesInputSchema.parse({
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      q: "timeout",
      service: ["api"],
      fingerprint: "",
      sort: "lastSeen",
      offset: 50,
      limit: 100,
    });
    expect(parsed.service).toEqual(["api"]);
    expect(parsed.offset).toBe(50);
    expect(parsed.limit).toBe(100);
  });

  it("validates detail input", () => {
    expect(
      GetErrorIssueInputSchema.parse({
        fingerprint: "abc",
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
        service: [],
        occurrenceLimit: 50,
      }),
    ).toMatchObject({ fingerprint: "abc", occurrenceLimit: 50 });
  });

  it("validates service list input", () => {
    expect(
      ListErrorServicesInputSchema.parse({
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
      }),
    ).toMatchObject({ fromTs: "2026-05-26 10:00:00" });
  });
});

describe("searchErrorIssues", () => {
  it("groups only OTel exception logs from app.logs", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          fingerprint: "fp-1",
          exceptionType: "TypeError",
          exceptionMessage: "Cannot read properties of undefined",
          body: "TypeError: Cannot read properties of undefined",
          latestServiceName: "web",
          services: ["web"],
          occurrenceCount: "3",
          traceCount: "2",
          firstSeen: "2026-05-26 10:00:00.000000000",
          lastSeen: "2026-05-26 10:05:00.000000000",
          latestTraceId: "trace-1",
          latestSpanId: "span-1",
          latestTimestamp: "2026-05-26 10:05:00.000000000",
        },
      ])
      .mockResolvedValueOnce([{ totalCount: "12" }]);

    const result = await searchErrorIssues({
      data: {
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
        q: "undefined",
        service: ["web"],
        fingerprint: "",
        sort: "lastSeen",
        limit: 50,
        offset: 50,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    const countSql = mockedQuery.mock.calls[1]?.[0] ?? "";
    expect(sql).toContain("FROM app.logs");
    expect(sql).toContain("TimestampTime >=");
    expect(sql).toContain("Timestamp >=");
    expect(sql).toContain("SeverityNumber >= 17");
    expect(sql).toContain("LogAttributes['exception.type'] != ''");
    expect(sql).toContain("LogAttributes['exception.message'] != ''");
    expect(sql.replace(/\s+/g, " ")).toContain(
      "LogAttributes['exception.type'] != '' OR LogAttributes['exception.message'] != ''",
    );
    expect(sql).toContain("ServiceName IN {service:Array(String)}");
    expect(sql).toContain("positionCaseInsensitive");
    expect(sql).toContain("GROUP BY fingerprint");
    expect(sql).toContain("ORDER BY lastSeen DESC");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(sql).toContain("OFFSET {offset:UInt32}");
    expect(sql).not.toContain("PRE" + "WHERE");
    expect(sql).not.toContain("SQL_" + "everr_tenant_id");
    expect(countSql).toContain("count() AS totalCount");
    expect(countSql).toContain("GROUP BY fingerprint");
    expect(mockedQuery.mock.calls[0]?.[2]).toMatchObject({
      service: ["web"],
      q: "undefined",
      limit: 50,
      offset: 50,
    });
    expect(result.issues[0]).toMatchObject({
      fingerprint: "fp-1",
      occurrenceCount: 3,
      traceCount: 2,
      latestTraceId: "trace-1",
    });
    expect(result.totalCount).toBe(12);
  });

  it("orders by occurrence count when requested", async () => {
    mockedQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        totalCount: "0",
      },
    ]);

    await searchErrorIssues({
      data: {
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
        q: "",
        service: [],
        fingerprint: "fp-1",
        sort: "count",
        limit: 25,
        offset: 0,
      },
    });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("WHERE fingerprint = {fingerprint:String}");
    expect(sql).toContain("ORDER BY occurrenceCount DESC");
  });
});

describe("getErrorIssue", () => {
  it("returns summary, latest occurrence, and recent occurrences", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        fingerprint: "fp-1",
        exceptionType: "TypeError",
        exceptionMessage: "boom",
        body: "TypeError: boom",
        latestServiceName: "web",
        services: ["web"],
        occurrenceCount: "2",
        traceCount: "1",
        firstSeen: "2026-05-26 10:00:00.000000000",
        lastSeen: "2026-05-26 10:05:00.000000000",
        latestTraceId: "trace-2",
        latestSpanId: "span-2",
        latestTimestamp: "2026-05-26 10:05:00.000000000",
      },
    ]);
    mockedQuery.mockResolvedValueOnce([
      {
        fingerprint: "fp-1",
        timestamp: "2026-05-26 10:05:00.000000000",
        serviceName: "web",
        traceId: "trace-2",
        spanId: "span-2",
        body: "TypeError: boom",
        exceptionType: "TypeError",
        exceptionMessage: "boom",
        exceptionStacktrace: "TypeError: boom\n    at app.ts:1:1",
        resourceAttributes: null,
        logAttributes: null,
        scopeAttributes: null,
      },
    ]);

    const result = await getErrorIssue({
      data: {
        fingerprint: "fp-1",
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
        service: [],
        occurrenceLimit: 50,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const summarySql = mockedQuery.mock.calls[0]?.[0] ?? "";
    const occurrencesSql = mockedQuery.mock.calls[1]?.[0] ?? "";
    expect(summarySql).toContain("WHERE fingerprint = {fingerprint:String}");
    expect(occurrencesSql).toContain(
      "WHERE fingerprint = {fingerprint:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[2]).toMatchObject({
      fingerprint: "fp-1",
    });
    expect(mockedQuery.mock.calls[1]?.[2]).toMatchObject({
      fingerprint: "fp-1",
    });
    expect(result.summary).toMatchObject({
      fingerprint: "fp-1",
      occurrenceCount: 2,
      traceCount: 1,
    });
    expect(result.latest.traceId).toBe("trace-2");
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]?.resourceAttributes).toEqual({});
    expect(result.occurrences[0]?.logAttributes).toEqual({});
    expect(result.occurrences[0]?.scopeAttributes).toEqual({});
  });

  it("throws when the issue is absent in the selected window", async () => {
    mockedQuery.mockResolvedValueOnce([]);

    await expect(
      getErrorIssue({
        data: {
          fingerprint: "missing",
          fromTs: "2026-05-26 10:00:00",
          toTs: "2026-05-26 11:00:00",
          service: [],
          occurrenceLimit: 50,
        },
      }),
    ).rejects.toThrow("Error issue not found");
  });
});

describe("listErrorServices", () => {
  it("lists services that emitted exception logs", async () => {
    mockedQuery.mockResolvedValueOnce([{ serviceName: "api" }]);

    const result = await listErrorServices({
      data: {
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
      },
    });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("SELECT DISTINCT ServiceName AS serviceName");
    expect(sql).toContain("SeverityNumber >= 17");
    expect(result).toEqual(["api"]);
  });
});

describe("error fingerprint SQL", () => {
  it("uses exception message normalization in fallback fingerprints", () => {
    expect(ERROR_FINGERPRINT_SQL).toContain(
      "LogAttributes['error.fingerprint']",
    );
    expect(ERROR_FINGERPRINT_SQL).toContain(NORMALIZED_EXCEPTION_MESSAGE_SQL);
    expect(ERROR_FINGERPRINT_SQL).toContain("cityHash64");
  });

  it("filters exception logs without tenant or prewhere predicates", () => {
    expect(EXCEPTION_LOG_FILTER_SQL).toContain("SeverityNumber >= 17");
    expect(EXCEPTION_LOG_FILTER_SQL).toContain(
      "LogAttributes['exception.type']",
    );
    expect(EXCEPTION_LOG_FILTER_SQL.replace(/\s+/g, " ")).toContain(
      "LogAttributes['exception.type'] != '' OR LogAttributes['exception.message'] != ''",
    );
    expect(EXCEPTION_LOG_FILTER_SQL).not.toContain("PRE" + "WHERE");
    expect(EXCEPTION_LOG_FILTER_SQL).not.toContain("SQL_" + "everr_tenant_id");
  });
});

describe("error tracking DTOs", () => {
  it("keeps shared type exports usable by later data modules", () => {
    const search = {
      q: "timeout",
      service: ["api"],
      fingerprint: "",
      occurrence: "",
      sort: "lastSeen",
      page: 1,
      limit: 50,
    } satisfies ErrorIssueSearch;
    const serverSearch = {
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      q: "timeout",
      service: ["api"],
      fingerprint: "",
      sort: "count",
      limit: 100,
      offset: 100,
    } satisfies SearchErrorIssuesInput;
    const detailInput = {
      fingerprint: "abc",
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      service: [],
      occurrenceLimit: 50,
    } satisfies GetErrorIssueInput;
    const serviceInput = {
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
    } satisfies ListErrorServicesInput;
    const sort = "lastSeen" satisfies ErrorSort;
    const dtoSort = "count" satisfies ErrorSortDto;
    const summary = {
      fingerprint: "abc",
      exceptionType: "Error",
      exceptionMessage: "timeout",
      body: "Error: timeout",
      latestServiceName: "api",
      services: ["api"],
      occurrenceCount: 2,
      traceCount: 1,
      firstSeen: "2026-05-26 10:00:00",
      lastSeen: "2026-05-26 11:00:00",
      latestTraceId: "trace-1",
      latestSpanId: "span-1",
      latestTimestamp: "2026-05-26 11:00:00",
    } satisfies ErrorIssueSummary;
    const occurrence = {
      fingerprint: "abc",
      timestamp: "2026-05-26 11:00:00",
      serviceName: "api",
      traceId: "trace-1",
      spanId: "span-1",
      body: "Error: timeout",
      exceptionType: "Error",
      exceptionMessage: "timeout",
      exceptionStacktrace: "Error: timeout\n    at main",
      resourceAttributes: { region: "local" },
      logAttributes: { "exception.type": "Error" },
      scopeAttributes: { package: "app" },
    } satisfies ErrorOccurrence;
    const detail = {
      summary,
      latest: occurrence,
      occurrences: [occurrence],
    } satisfies ErrorIssueDetail;

    expect(search.sort).toBe("lastSeen");
    expect(serverSearch.sort).toBe("count");
    expect(detailInput.fingerprint).toBe("abc");
    expect(serviceInput.fromTs).toBe("2026-05-26 10:00:00");
    expect(sort).toBe("lastSeen");
    expect(dtoSort).toBe("count");
    expect(detail.latest.logAttributes["exception.type"]).toBe("Error");
  });
});
