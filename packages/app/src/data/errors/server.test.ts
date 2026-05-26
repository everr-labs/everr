import { describe, expect, it } from "vitest";
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
import type {
  ErrorIssueDetail,
  ErrorIssueSummary,
  ErrorOccurrence,
  ErrorSort as ErrorSortDto,
} from "./types";

describe("error tracking schemas", () => {
  it("defaults list search params for the route", () => {
    expect(ErrorIssueSearchSchema.parse({})).toMatchObject({
      q: "",
      service: [],
      fingerprint: "",
      sort: "lastSeen",
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
      limit: 100,
    });
    expect(parsed.service).toEqual(["api"]);
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
    expect(EXCEPTION_LOG_FILTER_SQL).not.toContain("PREWHERE");
    expect(EXCEPTION_LOG_FILTER_SQL).not.toContain("SQL_everr_tenant_id");
  });
});

describe("error tracking DTOs", () => {
  it("keeps shared type exports usable by later data modules", () => {
    const search = {
      q: "timeout",
      service: ["api"],
      fingerprint: "",
      sort: "lastSeen",
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
