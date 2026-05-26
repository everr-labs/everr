# Error Tracking MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an app-only `/errors` experience that groups OpenTelemetry exception logs from `app.logs`, shows issue details with recent occurrences, and deep-links each occurrence to the existing trace viewer.

**Architecture:** Keep this slice inside `packages/app`: server functions query `app.logs` directly, TanStack Query options wrap those server functions, and route-local React components render list/detail pages. No new ClickHouse tables, no materialized views, no SDK package, and no `@everr/telemetry-explorer/errors` extraction.

**Tech Stack:** TypeScript, React 19, TanStack Start server functions, TanStack Router, TanStack Query, zod, ClickHouse SQL, `@everr/ui` components, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-26-error-tracking-mvp-design.md`

---

## File Structure

Create and modify these files:

- Create `packages/app/src/data/errors/schemas.ts`  
  URL search schemas, server input schemas, and shared `ErrorSort` enum.
- Create `packages/app/src/data/errors/types.ts`  
  DTOs returned by server functions and consumed by components.
- Create `packages/app/src/data/errors/fingerprint.ts`  
  Shared SQL snippets for normalized exception message and fingerprint expression.
- Create `packages/app/src/data/errors/server.ts`  
  `searchErrorIssues`, `getErrorIssue`, and `listErrorServices` authenticated server functions.
- Create `packages/app/src/data/errors/options.ts`  
  TanStack Query option factories that resolve datemath and call the server functions.
- Create `packages/app/src/data/errors/server.test.ts`  
  SQL safety, query parameter, and DTO mapping coverage.
- Create `packages/app/src/data/errors/options.test.ts`  
  Query option key and time-range conversion coverage.
- Create `packages/app/src/components/errors/trace-link.tsx`  
  Shared `Open trace` link with a narrow timestamp window.
- Create `packages/app/src/components/errors/error-issue-row.tsx`  
  Presentational row for grouped issue summaries.
- Create `packages/app/src/components/errors/error-issue-list.tsx`  
  List, loading, empty, and error states.
- Create `packages/app/src/components/errors/error-filters.tsx`  
  Search, service filter, and sort controls.
- Create `packages/app/src/components/errors/error-latest-occurrence.tsx`  
  Latest occurrence metadata and attributes panel.
- Create `packages/app/src/components/errors/error-stacktrace.tsx`  
  Stacktrace display with copy affordance.
- Create `packages/app/src/components/errors/error-occurrences-list.tsx`  
  Recent occurrences list and trace actions.
- Create `packages/app/src/components/errors/error-detail-header.tsx`  
  Detail header and back action.
- Create `packages/app/src/components/errors/error-pages.test.tsx`  
  Component-level list/detail behavior.
- Create `packages/app/src/routes/_authenticated/_dashboard/errors.tsx`  
  `/errors` route and list page wiring.
- Create `packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx`  
  `/errors/$fingerprint` route and detail page wiring.
- Modify `packages/app/src/lib/navigation.ts`  
  Add the Errors sidebar item.
- Regenerate `packages/app/src/routeTree.gen.ts` through the TanStack Start plugin by running app typecheck/build commands after routes are added.

Do not modify ClickHouse schema files and do not generate Postgres/Drizzle migrations.

## Task 1: Schemas, DTOs, and Fingerprint SQL

**Files:**
- Create: `packages/app/src/data/errors/schemas.ts`
- Create: `packages/app/src/data/errors/types.ts`
- Create: `packages/app/src/data/errors/fingerprint.ts`
- Test: `packages/app/src/data/errors/server.test.ts`

- [ ] **Step 1: Write failing schema and SQL helper tests**

Create `packages/app/src/data/errors/server.test.ts` with these initial tests:

```ts
import { describe, expect, it } from "vitest";
import {
  ERROR_FINGERPRINT_SQL,
  NORMALIZED_EXCEPTION_MESSAGE_SQL,
} from "./fingerprint";
import {
  ErrorIssueSearchSchema,
  ErrorSortSchema,
  GetErrorIssueInputSchema,
  SearchErrorIssuesInputSchema,
} from "./schemas";

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
});

describe("error fingerprint SQL", () => {
  it("uses exception message normalization in fallback fingerprints", () => {
    expect(ERROR_FINGERPRINT_SQL).toContain("LogAttributes['error.fingerprint']");
    expect(ERROR_FINGERPRINT_SQL).toContain(NORMALIZED_EXCEPTION_MESSAGE_SQL);
    expect(ERROR_FINGERPRINT_SQL).toContain("cityHash64");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @everr/app test -- src/data/errors/server.test.ts
```

Expected: fail because `schemas.ts`, `types.ts`, and `fingerprint.ts` do not exist.

- [ ] **Step 3: Create DTO types**

Create `packages/app/src/data/errors/types.ts`:

```ts
export type ErrorSort = "lastSeen" | "count";

export type ErrorIssueSummary = {
  fingerprint: string;
  exceptionType: string;
  exceptionMessage: string;
  body: string;
  latestServiceName: string;
  services: string[];
  occurrenceCount: number;
  traceCount: number;
  firstSeen: string;
  lastSeen: string;
  latestTraceId: string;
  latestSpanId: string;
  latestTimestamp: string;
};

export type ErrorOccurrence = {
  fingerprint: string;
  timestamp: string;
  serviceName: string;
  traceId: string;
  spanId: string;
  body: string;
  exceptionType: string;
  exceptionMessage: string;
  exceptionStacktrace: string;
  resourceAttributes: Record<string, string>;
  logAttributes: Record<string, string>;
  scopeAttributes: Record<string, string>;
};

export type ErrorIssueDetail = {
  summary: ErrorIssueSummary;
  latest: ErrorOccurrence;
  occurrences: ErrorOccurrence[];
};
```

- [ ] **Step 4: Create schemas**

Create `packages/app/src/data/errors/schemas.ts`:

```ts
import { z } from "zod";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const ErrorSortSchema = z.enum(["lastSeen", "count"]);
export type ErrorSort = z.infer<typeof ErrorSortSchema>;

export const ErrorIssueSearchSchema = TimeRangeSearchSchema.extend({
  q: z.string().trim().default(""),
  service: z.array(z.string()).default([]),
  fingerprint: z.string().trim().default(""),
  sort: ErrorSortSchema.default("lastSeen"),
  limit: z.number().int().positive().max(500).default(50),
});
export type ErrorIssueSearch = z.infer<typeof ErrorIssueSearchSchema>;

export const SearchErrorIssuesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  q: z.string().trim().default(""),
  service: z.array(z.string()).default([]),
  fingerprint: z.string().trim().default(""),
  sort: ErrorSortSchema.default("lastSeen"),
  limit: z.number().int().positive().max(500).default(50),
});
export type SearchErrorIssuesInput = z.infer<
  typeof SearchErrorIssuesInputSchema
>;

export const GetErrorIssueInputSchema = z.object({
  fingerprint: z.string().min(1),
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  service: z.array(z.string()).default([]),
  occurrenceLimit: z.number().int().positive().max(200).default(50),
});
export type GetErrorIssueInput = z.infer<typeof GetErrorIssueInputSchema>;

export const ListErrorServicesInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
});
export type ListErrorServicesInput = z.infer<
  typeof ListErrorServicesInputSchema
>;
```

- [ ] **Step 5: Create fingerprint SQL helpers**

Create `packages/app/src/data/errors/fingerprint.ts`:

```ts
export const NORMALIZED_EXCEPTION_MESSAGE_SQL = `
  substring(
    replaceRegexpAll(
      replaceRegexpAll(
        replaceRegexpAll(
          trim(BOTH ' ' FROM LogAttributes['exception.message']),
          '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
          '<uuid>'
        ),
        '\\\\b[0-9]{6,}\\\\b|0x[0-9a-fA-F]+',
        '<id>'
      ),
      '''[^'']{16,}''|"[^"]{16,}"',
      '<quoted>'
    ),
    1,
    300
  )
`;

export const ERROR_FINGERPRINT_SQL = `
  if(
    LogAttributes['error.fingerprint'] != '',
    LogAttributes['error.fingerprint'],
    toString(cityHash64(
      ServiceName,
      LogAttributes['exception.type'],
      ${NORMALIZED_EXCEPTION_MESSAGE_SQL},
      ''
    ))
  )
`;

export const EXCEPTION_LOG_FILTER_SQL = `
  SeverityNumber >= 17
  AND (
    LogAttributes['exception.type'] != ''
    OR LogAttributes['exception.message'] != ''
  )
`;
```

- [ ] **Step 6: Run the schema tests**

Run:

```bash
pnpm --filter @everr/app test -- src/data/errors/server.test.ts
```

Expected: pass for the schema and fingerprint helper tests.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/data/errors/schemas.ts \
  packages/app/src/data/errors/types.ts \
  packages/app/src/data/errors/fingerprint.ts \
  packages/app/src/data/errors/server.test.ts
git commit -m "Add error tracking data contracts"
```

## Task 2: Server Functions and Raw `app.logs` Queries

**Files:**
- Modify: `packages/app/src/data/errors/server.test.ts`
- Create: `packages/app/src/data/errors/server.ts`

- [ ] **Step 1: Extend tests for list, detail, and service queries**

Append these tests to `packages/app/src/data/errors/server.test.ts`:

```ts
import { beforeEach, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getErrorIssue, listErrorServices, searchErrorIssues } from "./server";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchErrorIssues", () => {
  it("groups only OTel exception logs from app.logs", async () => {
    mockedQuery.mockResolvedValueOnce([
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
    ]);

    const result = await searchErrorIssues({
      data: {
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
        q: "undefined",
        service: ["web"],
        fingerprint: "",
        sort: "lastSeen",
        limit: 50,
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("FROM app.logs");
    expect(sql).toContain("TimestampTime >=");
    expect(sql).toContain("Timestamp >=");
    expect(sql).toContain("SeverityNumber >= 17");
    expect(sql).toContain("LogAttributes['exception.type'] != ''");
    expect(sql).toContain("LogAttributes['exception.message'] != ''");
    expect(sql).toContain("ServiceName IN {service:Array(String)}");
    expect(sql).toContain("positionCaseInsensitive");
    expect(sql).toContain("GROUP BY fingerprint");
    expect(sql).toContain("ORDER BY lastSeen DESC");
    expect(sql).not.toContain("PREWHERE");
    expect(sql).not.toContain("SQL_everr_tenant_id");
    expect(mockedQuery.mock.calls[0]?.[2]).toMatchObject({
      service: ["web"],
      q: "undefined",
      limit: 50,
    });
    expect(result[0]).toMatchObject({
      fingerprint: "fp-1",
      occurrenceCount: 3,
      traceCount: 2,
      latestTraceId: "trace-1",
    });
  });

  it("orders by occurrence count when requested", async () => {
    mockedQuery.mockResolvedValueOnce([]);

    await searchErrorIssues({
      data: {
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
        q: "",
        service: [],
        fingerprint: "fp-1",
        sort: "count",
        limit: 25,
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
        exceptionStacktrace: "TypeError: boom\\n    at app.ts:1:1",
        resourceAttributes: { "service.namespace": "frontend" },
        logAttributes: { "exception.type": "TypeError" },
        scopeAttributes: { "scope.kind": "browser" },
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
    expect(result.latest.traceId).toBe("trace-2");
    expect(result.occurrences).toHaveLength(1);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @everr/app test -- src/data/errors/server.test.ts
```

Expected: fail because `server.ts` does not exist and the new functions are undefined.

- [ ] **Step 3: Implement server functions**

Create `packages/app/src/data/errors/server.ts` with these exported functions and helpers:

```ts
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  ERROR_FINGERPRINT_SQL,
  EXCEPTION_LOG_FILTER_SQL,
} from "./fingerprint";
import {
  GetErrorIssueInputSchema,
  ListErrorServicesInputSchema,
  SearchErrorIssuesInputSchema,
  type GetErrorIssueInput,
  type SearchErrorIssuesInput,
} from "./schemas";
import type {
  ErrorIssueDetail,
  ErrorIssueSummary,
  ErrorOccurrence,
} from "./types";

type ClickhouseContext = {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
};

type ErrorIssueSummaryRow = Omit<
  ErrorIssueSummary,
  "occurrenceCount" | "traceCount"
> & {
  occurrenceCount: string | number;
  traceCount: string | number;
};

type ErrorOccurrenceRow = ErrorOccurrence & {
  resourceAttributes: Record<string, string> | null;
  logAttributes: Record<string, string> | null;
  scopeAttributes: Record<string, string> | null;
};

type ServiceRow = { serviceName: string };

function mapSummary(row: ErrorIssueSummaryRow): ErrorIssueSummary {
  return {
    ...row,
    occurrenceCount: Number(row.occurrenceCount),
    traceCount: Number(row.traceCount),
  };
}

function mapOccurrence(row: ErrorOccurrenceRow): ErrorOccurrence {
  return {
    ...row,
    resourceAttributes: row.resourceAttributes ?? {},
    logAttributes: row.logAttributes ?? {},
    scopeAttributes: row.scopeAttributes ?? {},
  };
}

function timePredicateSql(): string {
  return `
    TimestampTime >= toDateTime(parseDateTime64BestEffort({fromTs:String}, 9))
    AND TimestampTime <= toDateTime(parseDateTime64BestEffort({toTs:String}, 9))
    AND Timestamp >= parseDateTime64BestEffort({fromTs:String}, 9)
    AND Timestamp <= parseDateTime64BestEffort({toTs:String}, 9)
  `;
}

function buildBaseParams(
  input: Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "service">,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    fromTs: input.fromTs,
    toTs: input.toTs,
  };
  if (input.service.length > 0) params.service = input.service;
  return params;
}

function buildExceptionLogsCte(
  input: Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "q" | "service">,
): { sql: string; params: Record<string, unknown> } {
  const params = buildBaseParams(input);
  const filters = [timePredicateSql(), EXCEPTION_LOG_FILTER_SQL];

  if (input.service.length > 0) {
    filters.push("ServiceName IN {service:Array(String)}");
  }
  if (input.q) {
    filters.push(`(
      positionCaseInsensitive(LogAttributes['exception.type'], {q:String}) > 0
      OR positionCaseInsensitive(LogAttributes['exception.message'], {q:String}) > 0
      OR positionCaseInsensitive(Body, {q:String}) > 0
    )`);
    params.q = input.q;
  }

  return {
    params,
    sql: `
      exception_logs AS (
        SELECT
          Timestamp,
          ServiceName,
          TraceId,
          SpanId,
          Body,
          ResourceAttributes,
          ScopeAttributes,
          LogAttributes,
          ${ERROR_FINGERPRINT_SQL} AS fingerprint
        FROM app.logs
        WHERE ${filters.join("\n          AND ")}
      )
    `,
  };
}

function buildSummaryQuery(input: SearchErrorIssuesInput): {
  sql: string;
  params: Record<string, unknown>;
} {
  const cte = buildExceptionLogsCte(input);
  const params = { ...cte.params, limit: input.limit };
  const fingerprintFilter = input.fingerprint
    ? "WHERE fingerprint = {fingerprint:String}"
    : "";
  if (input.fingerprint) params.fingerprint = input.fingerprint;
  const orderBy =
    input.sort === "count"
      ? "occurrenceCount DESC, lastSeen DESC"
      : "lastSeen DESC, occurrenceCount DESC";

  return {
    params,
    sql: `
      WITH ${cte.sql}
      SELECT
        fingerprint,
        argMax(LogAttributes['exception.type'], Timestamp) AS exceptionType,
        argMax(LogAttributes['exception.message'], Timestamp) AS exceptionMessage,
        argMax(Body, Timestamp) AS body,
        argMax(ServiceName, Timestamp) AS latestServiceName,
        groupUniqArray(ServiceName) AS services,
        count() AS occurrenceCount,
        uniqExactIf(TraceId, TraceId != '') AS traceCount,
        toString(min(Timestamp)) AS firstSeen,
        toString(max(Timestamp)) AS lastSeen,
        argMax(TraceId, Timestamp) AS latestTraceId,
        argMax(SpanId, Timestamp) AS latestSpanId,
        argMax(toString(Timestamp), Timestamp) AS latestTimestamp
      FROM exception_logs
      ${fingerprintFilter}
      GROUP BY fingerprint
      ORDER BY ${orderBy}
      LIMIT {limit:UInt32}
    `,
  };
}

function buildOccurrencesQuery(input: GetErrorIssueInput): {
  sql: string;
  params: Record<string, unknown>;
} {
  const cte = buildExceptionLogsCte({ ...input, q: "" });
  return {
    params: {
      ...cte.params,
      fingerprint: input.fingerprint,
      occurrenceLimit: input.occurrenceLimit,
    },
    sql: `
      WITH ${cte.sql}
      SELECT
        fingerprint,
        toString(Timestamp) AS timestamp,
        ServiceName AS serviceName,
        TraceId AS traceId,
        SpanId AS spanId,
        Body AS body,
        LogAttributes['exception.type'] AS exceptionType,
        LogAttributes['exception.message'] AS exceptionMessage,
        LogAttributes['exception.stacktrace'] AS exceptionStacktrace,
        ResourceAttributes AS resourceAttributes,
        LogAttributes AS logAttributes,
        ScopeAttributes AS scopeAttributes
      FROM exception_logs
      WHERE fingerprint = {fingerprint:String}
      ORDER BY Timestamp DESC
      LIMIT {occurrenceLimit:UInt32}
    `,
  };
}

export const searchErrorIssues = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchErrorIssuesInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { sql, params } = buildSummaryQuery(data);
    const rows = await (clickhouse as ClickhouseContext).query<ErrorIssueSummaryRow>(
      sql,
      params,
    );
    return rows.map(mapSummary);
  });

export const getErrorIssue = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetErrorIssueInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const summaryInput: SearchErrorIssuesInput = {
      fromTs: data.fromTs,
      toTs: data.toTs,
      q: "",
      service: data.service,
      fingerprint: data.fingerprint,
      sort: "lastSeen",
      limit: 1,
    };
    const summaryQuery = buildSummaryQuery(summaryInput);
    const summaryRows = await (clickhouse as ClickhouseContext).query<ErrorIssueSummaryRow>(
      summaryQuery.sql,
      summaryQuery.params,
    );
    const summary = summaryRows[0] ? mapSummary(summaryRows[0]) : undefined;
    if (!summary) throw new Error("Error issue not found");

    const occurrencesQuery = buildOccurrencesQuery(data);
    const occurrenceRows = await (clickhouse as ClickhouseContext).query<ErrorOccurrenceRow>(
      occurrencesQuery.sql,
      occurrencesQuery.params,
    );
    const occurrences = occurrenceRows.map(mapOccurrence);
    const latest = occurrences[0];
    if (!latest) throw new Error("Error issue not found");

    return { summary, latest, occurrences } satisfies ErrorIssueDetail;
  });

export const listErrorServices = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(ListErrorServicesInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const rows = await (clickhouse as ClickhouseContext).query<ServiceRow>(
      `
        SELECT DISTINCT ServiceName AS serviceName
        FROM app.logs
        WHERE ${timePredicateSql()}
          AND ${EXCEPTION_LOG_FILTER_SQL}
        ORDER BY serviceName
      `,
      { fromTs: data.fromTs, toTs: data.toTs },
    );
    return rows.map((row) => row.serviceName).filter(Boolean);
  });
```

- [ ] **Step 4: Run server tests**

Run:

```bash
pnpm --filter @everr/app test -- src/data/errors/server.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/errors/server.ts packages/app/src/data/errors/server.test.ts
git commit -m "Add error issue ClickHouse queries"
```

## Task 3: Query Options

**Files:**
- Create: `packages/app/src/data/errors/options.ts`
- Create: `packages/app/src/data/errors/options.test.ts`

- [ ] **Step 1: Write failing query option tests**

Create `packages/app/src/data/errors/options.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  errorIssueOptions,
  errorIssuesOptions,
  errorServicesOptions,
} from "./options";

describe("error query options", () => {
  it("resolves datemath before searching issues", async () => {
    const searchErrorIssues = vi.fn().mockResolvedValue([]);
    const options = errorIssuesOptions({
      searchErrorIssues,
      timeRange: {
        from: "2026-05-26T10:00:00.000Z",
        to: "2026-05-26T11:00:00.000Z",
      },
      refresh: "",
      q: "boom",
      service: ["web"],
      fingerprint: "",
      sort: "lastSeen",
      limit: 50,
    });

    await (options.queryFn as () => Promise<unknown>)();

    expect(searchErrorIssues).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromTs: "2026-05-26 10:00:00.000",
        toTs: "2026-05-26 11:00:00.000",
        q: "boom",
        service: ["web"],
      }),
    });
  });

  it("includes fingerprint in detail query keys", () => {
    const getErrorIssue = vi.fn();
    const options = errorIssueOptions({
      getErrorIssue,
      fingerprint: "fp-1",
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
      service: [],
      occurrenceLimit: 50,
    });

    expect(options.queryKey).toContain("fp-1");
  });

  it("creates service option queries", () => {
    const listErrorServices = vi.fn();
    const options = errorServicesOptions({
      listErrorServices,
      timeRange: { from: "now-1h", to: "now" },
      refresh: "",
    });

    expect(options.queryKey[0]).toBe("errors");
    expect(options.queryKey[1]).toBe("services");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @everr/app test -- src/data/errors/options.test.ts
```

Expected: fail because `options.ts` does not exist.

- [ ] **Step 3: Implement query option factories**

Create `packages/app/src/data/errors/options.ts`:

```ts
import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import {
  resolveTimeRange,
  type TimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
import type {
  GetErrorIssueInput,
  ListErrorServicesInput,
  SearchErrorIssuesInput,
} from "./schemas";
import type { ErrorSort } from "./types";

type ServerFn<TInput, TResult> = (args: { data: TInput }) => Promise<TResult>;

export type ErrorIssuesOptionsInput<TResult> = {
  searchErrorIssues: ServerFn<SearchErrorIssuesInput, TResult>;
  timeRange: TimeRange;
  refresh: string;
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  limit: number;
};

export function errorIssuesOptions<TResult>(
  input: ErrorIssuesOptionsInput<TResult>,
) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  const queryKey = [
    "errors",
    "issues",
    {
      timeRange: input.timeRange,
      q: input.q,
      service: input.service,
      fingerprint: input.fingerprint,
      sort: input.sort,
      limit: input.limit,
    },
  ] as const;

  return queryOptions({
    queryKey,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return input.searchErrorIssues({
        data: {
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
          q: input.q,
          service: input.service,
          fingerprint: input.fingerprint,
          sort: input.sort,
          limit: input.limit,
        },
      });
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export type ErrorIssueOptionsInput<TResult> = {
  getErrorIssue: ServerFn<GetErrorIssueInput, TResult>;
  fingerprint: string;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  occurrenceLimit: number;
};

export function errorIssueOptions<TResult>(
  input: ErrorIssueOptionsInput<TResult>,
) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: [
      "errors",
      "issue",
      input.fingerprint,
      input.timeRange,
      input.service,
      input.occurrenceLimit,
    ] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return input.getErrorIssue({
        data: {
          fingerprint: input.fingerprint,
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
          service: input.service,
          occurrenceLimit: input.occurrenceLimit,
        },
      });
    },
    enabled: input.fingerprint.length > 0,
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}

export function errorServicesOptions<TResult>(input: {
  listErrorServices: ServerFn<ListErrorServicesInput, TResult>;
  timeRange: TimeRange;
  refresh: string;
}) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: ["errors", "services", input.timeRange] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return input.listErrorServices({
        data: {
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
        },
      });
    },
    refetchInterval: refreshMs && refreshMs > 0 ? refreshMs : false,
  });
}
```

- [ ] **Step 4: Run query option tests**

Run:

```bash
pnpm --filter @everr/app test -- src/data/errors/options.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/errors/options.ts packages/app/src/data/errors/options.test.ts
git commit -m "Add error tracking query options"
```

## Task 4: Error List Page and Sidebar Navigation

**Files:**
- Create: `packages/app/src/components/errors/error-filters.tsx`
- Create: `packages/app/src/components/errors/error-issue-row.tsx`
- Create: `packages/app/src/components/errors/error-issue-list.tsx`
- Create: `packages/app/src/components/errors/error-pages.test.tsx`
- Create: `packages/app/src/routes/_authenticated/_dashboard/errors.tsx`
- Modify: `packages/app/src/lib/navigation.ts`

- [ ] **Step 1: Write failing list component tests**

Create `packages/app/src/components/errors/error-pages.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorFilters } from "./error-filters";
import { ErrorIssueList } from "./error-issue-list";
import type { ErrorIssueSummary } from "@/data/errors/types";

const issue: ErrorIssueSummary = {
  fingerprint: "fp-1",
  exceptionType: "TypeError",
  exceptionMessage: "Cannot read properties of undefined",
  body: "TypeError: Cannot read properties of undefined",
  latestServiceName: "web",
  services: ["web"],
  occurrenceCount: 3,
  traceCount: 2,
  firstSeen: "2026-05-26 10:00:00.000000000",
  lastSeen: "2026-05-26 10:05:00.000000000",
  latestTraceId: "trace-1",
  latestSpanId: "span-1",
  latestTimestamp: "2026-05-26 10:05:00.000000000",
};

describe("ErrorIssueList", () => {
  it("renders grouped issue rows", () => {
    render(
      <ErrorIssueList
        issues={[issue]}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        renderIssueLink={({ fingerprint, children }) => (
          <a href={`/errors/${fingerprint}`}>{children}</a>
        )}
      />,
    );

    expect(screen.getByText("TypeError")).toBeInTheDocument();
    expect(screen.getByText("Cannot read properties of undefined")).toBeInTheDocument();
    expect(screen.getByText("3 occurrences")).toBeInTheDocument();
    expect(screen.getByText("2 traces")).toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(
      <ErrorIssueList
        issues={[]}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        renderIssueLink={({ children }) => <span>{children}</span>}
      />,
    );

    expect(screen.getByText("No exception logs found")).toBeInTheDocument();
  });
});

describe("ErrorFilters", () => {
  it("submits search text and sort changes", async () => {
    const onChange = vi.fn();
    render(
      <ErrorFilters
        value={{ q: "", service: [], fingerprint: "", sort: "lastSeen", limit: 50 }}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("Search errors"), "boom");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: "boom" }));

    await userEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort: "count" }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @everr/app test -- src/components/errors/error-pages.test.tsx
```

Expected: fail because components do not exist.

- [ ] **Step 3: Implement filters**

Create `packages/app/src/components/errors/error-filters.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { Search, X } from "lucide-react";
import type { ErrorSort } from "@/data/errors/types";

export type ErrorFiltersValue = {
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  limit: number;
};

export function ErrorFilters({
  value,
  services,
  onChange,
}: {
  value: ErrorFiltersValue;
  services: string[];
  onChange: (patch: Partial<ErrorFiltersValue>) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b bg-muted/10 px-3 py-2">
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onChange({ q: String(form.get("q") ?? "").trim() });
        }}
      >
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            name="q"
            defaultValue={value.q}
            placeholder="Search errors"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" size="sm">
              Search
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {value.q ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear search"
            onClick={() => onChange({ q: "" })}
          >
            <X />
          </Button>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={value.sort}
          size="sm"
          variant="outline"
          onValueChange={(next) => {
            if (next === "lastSeen" || next === "count") {
              onChange({ sort: next });
            }
          }}
        >
          <ToggleGroupItem value="lastSeen" aria-label="Last seen">
            Last seen
          </ToggleGroupItem>
          <ToggleGroupItem value="count" aria-label="Count">
            Count
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="flex flex-wrap gap-1">
          {services.map((service) => {
            const active = value.service.includes(service);
            return (
              <Button
                key={service}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  onChange({
                    service: active
                      ? value.service.filter((item) => item !== service)
                      : [...value.service, service],
                  })
                }
              >
                {service}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement issue row and list**

Create `packages/app/src/components/errors/error-issue-row.tsx`:

```tsx
import { Badge } from "@everr/ui/components/badge";
import { cn } from "@everr/ui/lib/utils";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { ErrorIssueSummary } from "@/data/errors/types";

export type ErrorIssueLinkRenderProps = {
  fingerprint: string;
  children: ReactNode;
  className?: string;
};

export function ErrorIssueRow({
  issue,
  renderIssueLink,
}: {
  issue: ErrorIssueSummary;
  renderIssueLink: (props: ErrorIssueLinkRenderProps) => ReactNode;
}) {
  return renderIssueLink({
    fingerprint: issue.fingerprint,
    className: cn(
      "grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-3 py-3 text-left",
      "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
    ),
    children: (
      <>
        <div className="min-w-0">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <AlertCircle className="text-destructive" />
            <Badge variant="outline">ERROR</Badge>
            <span className="truncate font-medium">
              {issue.exceptionType || "Exception"}
            </span>
          </div>
          <div className="truncate text-sm">
            {issue.exceptionMessage || issue.body || "No exception message"}
          </div>
          <div className="text-muted-foreground mt-1 truncate text-xs">
            {issue.services.join(", ") || issue.latestServiceName}
          </div>
        </div>
        <div className="text-muted-foreground flex shrink-0 flex-col items-end gap-1 text-xs">
          <span>{issue.occurrenceCount.toLocaleString()} occurrences</span>
          <span>{issue.traceCount.toLocaleString()} traces</span>
          <span>Last {issue.lastSeen}</span>
        </div>
      </>
    ),
  });
}
```

Create `packages/app/src/components/errors/error-issue-list.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import type { ReactNode } from "react";
import type { ErrorIssueSummary } from "@/data/errors/types";
import { ErrorIssueRow, type ErrorIssueLinkRenderProps } from "./error-issue-row";

export function ErrorIssueList({
  issues,
  isPending,
  isError,
  onRetry,
  renderIssueLink,
}: {
  issues: ErrorIssueSummary[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  renderIssueLink: (props: ErrorIssueLinkRenderProps) => ReactNode;
}) {
  if (isPending) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="border-b px-3 py-3">
            <Skeleton className="mb-2 h-4 w-48" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Failed to load errors</EmptyTitle>
          <EmptyDescription>
            The grouped error query failed. Try again or narrow the time range.
          </EmptyDescription>
        </EmptyHeader>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </Empty>
    );
  }

  if (issues.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No exception logs found</EmptyTitle>
          <EmptyDescription>
            Widen the time range or clear filters to look for more exceptions.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      {issues.map((issue) => (
        <ErrorIssueRow
          key={issue.fingerprint}
          issue={issue}
          renderIssueLink={renderIssueLink}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire `/errors` route**

Create `packages/app/src/routes/_authenticated/_dashboard/errors.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorFilters } from "@/components/errors/error-filters";
import { ErrorIssueList } from "@/components/errors/error-issue-list";
import {
  errorIssuesOptions,
  errorServicesOptions,
} from "@/data/errors/options";
import { ErrorIssueSearchSchema } from "@/data/errors/schemas";
import { listErrorServices, searchErrorIssues } from "@/data/errors/server";
import { withTimeRange } from "@/lib/time-range";

export const Route = createFileRoute("/_authenticated/_dashboard/errors")({
  staticData: { breadcrumb: "Errors", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Errors" }] }),
  validateSearch: ErrorIssueSearchSchema,
  component: ErrorsRoute,
});

function ErrorsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange } = withTimeRange(search);

  const issuesQuery = useQuery(
    errorIssuesOptions({
      searchErrorIssues,
      timeRange,
      refresh: search.refresh ?? "",
      q: search.q,
      service: search.service,
      fingerprint: search.fingerprint,
      sort: search.sort,
      limit: search.limit,
    }),
  );

  const servicesQuery = useQuery(
    errorServicesOptions({
      listErrorServices,
      timeRange,
      refresh: search.refresh ?? "",
    }),
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <ErrorFilters
        value={{
          q: search.q,
          service: search.service,
          fingerprint: search.fingerprint,
          sort: search.sort,
          limit: search.limit,
        }}
        services={servicesQuery.data ?? []}
        onChange={(patch) =>
          navigate({
            search: (prev) => ({ ...prev, ...patch }),
            replace: true,
          })
        }
      />
      <ErrorIssueList
        issues={issuesQuery.data ?? []}
        isPending={issuesQuery.isPending}
        isError={issuesQuery.isError}
        onRetry={() => {
          void issuesQuery.refetch();
        }}
        renderIssueLink={({ fingerprint, className, children }) => (
          <Link
            to="/errors/$fingerprint"
            params={{ fingerprint }}
            search={search}
            className={className}
          >
            {children}
          </Link>
        )}
      />
    </section>
  );
}
```

- [ ] **Step 6: Add sidebar navigation**

Modify `packages/app/src/lib/navigation.ts`:

```ts
import {
  AlertTriangle,
  FlaskConical,
  GitBranch,
  type LucideIcon,
  ScrollText,
  Workflow,
} from "lucide-react";
```

Insert this item between Logs and Traces:

```ts
{
  title: "Errors",
  url: "/errors",
  icon: AlertTriangle,
},
```

- [ ] **Step 7: Run list tests**

Run:

```bash
pnpm --filter @everr/app test -- src/components/errors/error-pages.test.tsx
```

Expected: pass for the list/filter tests.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/components/errors/error-filters.tsx \
  packages/app/src/components/errors/error-issue-row.tsx \
  packages/app/src/components/errors/error-issue-list.tsx \
  packages/app/src/components/errors/error-pages.test.tsx \
  packages/app/src/routes/_authenticated/_dashboard/errors.tsx \
  packages/app/src/lib/navigation.ts
git commit -m "Add error issue list page"
```

## Task 5: Error Detail Page and Trace Links

**Files:**
- Create: `packages/app/src/components/errors/trace-link.tsx`
- Create: `packages/app/src/components/errors/error-detail-header.tsx`
- Create: `packages/app/src/components/errors/error-latest-occurrence.tsx`
- Create: `packages/app/src/components/errors/error-stacktrace.tsx`
- Create: `packages/app/src/components/errors/error-occurrences-list.tsx`
- Modify: `packages/app/src/components/errors/error-pages.test.tsx`
- Create: `packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx`

- [ ] **Step 1: Extend component tests for detail state**

Append to `packages/app/src/components/errors/error-pages.test.tsx`:

```tsx
import { ErrorLatestOccurrence } from "./error-latest-occurrence";
import { ErrorOccurrencesList } from "./error-occurrences-list";
import { ErrorStacktrace } from "./error-stacktrace";
import { TraceLink } from "./trace-link";
import type { ErrorOccurrence } from "@/data/errors/types";

const occurrence: ErrorOccurrence = {
  fingerprint: "fp-1",
  timestamp: "2026-05-26 10:05:00.000000000",
  serviceName: "web",
  traceId: "trace-1",
  spanId: "span-1",
  body: "TypeError: boom",
  exceptionType: "TypeError",
  exceptionMessage: "boom",
  exceptionStacktrace: "TypeError: boom\\n    at app.ts:1:1",
  resourceAttributes: { "service.namespace": "frontend" },
  logAttributes: { "exception.type": "TypeError" },
  scopeAttributes: { "otel.scope.name": "browser-errors" },
};

describe("error detail components", () => {
  it("renders latest occurrence metadata and attributes", () => {
    render(<ErrorLatestOccurrence occurrence={occurrence} />);
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("trace-1")).toBeInTheDocument();
    expect(screen.getByText("Resource attributes")).toBeInTheDocument();
  });

  it("renders stacktrace when present", () => {
    render(<ErrorStacktrace stacktrace={occurrence.exceptionStacktrace} />);
    expect(screen.getByText("TypeError: boom")).toBeInTheDocument();
    expect(screen.getByText("at app.ts:1:1")).toBeInTheDocument();
  });

  it("omits trace action when trace id is absent", () => {
    render(
      <ErrorOccurrencesList
        occurrences={[{ ...occurrence, traceId: "" }]}
        renderTraceLink={({ children }) => <a href="/trace">{children}</a>}
      />,
    );
    expect(screen.queryByText("Open trace")).not.toBeInTheDocument();
  });

  it("builds trace links with focused span and narrow window", () => {
    render(<TraceLink occurrence={occurrence} />);
    const link = screen.getByRole("link", { name: "Open trace" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/traces/trace-1"));
    expect(link).toHaveAttribute("href", expect.stringContaining("span=span-1"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @everr/app test -- src/components/errors/error-pages.test.tsx
```

Expected: fail because detail components do not exist.

- [ ] **Step 3: Implement trace link**

Create `packages/app/src/components/errors/trace-link.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";
import { FileSearch } from "lucide-react";
import type { ErrorOccurrence } from "@/data/errors/types";

const TRACE_WINDOW_BUFFER_MS = 5 * 60 * 1000;

function toIsoWithOffset(timestamp: string, offsetMs: number): string {
  const normalized = timestamp.includes("T")
    ? timestamp
    : `${timestamp.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Date(date.getTime() + offsetMs).toISOString();
}

export function getTraceWindow(occurrence: ErrorOccurrence) {
  return {
    start: toIsoWithOffset(occurrence.timestamp, -TRACE_WINDOW_BUFFER_MS),
    end: toIsoWithOffset(occurrence.timestamp, TRACE_WINDOW_BUFFER_MS),
  };
}

export function TraceLink({ occurrence }: { occurrence: ErrorOccurrence }) {
  if (!occurrence.traceId) return null;
  const window = getTraceWindow(occurrence);
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={
        <Link
          to="/traces/$traceId"
          params={{ traceId: occurrence.traceId }}
          search={(prev) => ({
            ...prev,
            span: occurrence.spanId || undefined,
            start: window.start,
            end: window.end,
          })}
        />
      }
    >
      <FileSearch data-icon="inline-start" />
      Open trace
    </Button>
  );
}
```

- [ ] **Step 4: Implement detail components**

Create `packages/app/src/components/errors/error-detail-header.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import type { ErrorIssueSummary } from "@/data/errors/types";

export function ErrorDetailHeader({
  summary,
  onBack,
}: {
  summary: ErrorIssueSummary;
  onBack: () => void;
}) {
  return (
    <div className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Back to errors"
        onClick={onBack}
      >
        <ArrowLeft />
      </Button>
      <AlertTriangle className="mt-1 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {summary.exceptionType || "Exception"}
        </div>
        <div className="text-muted-foreground truncate text-sm">
          {summary.exceptionMessage || summary.body || "No exception message"}
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {summary.occurrenceCount.toLocaleString()} occurrences · last seen{" "}
          {summary.lastSeen}
        </div>
      </div>
    </div>
  );
}
```

Create `packages/app/src/components/errors/error-latest-occurrence.tsx`:

```tsx
import {
  AttributeMap,
  DetailItem,
  DetailSection,
} from "@everr/ui/components/detail-panel";
import { Clock3, Fingerprint, Server } from "lucide-react";
import type { ErrorOccurrence } from "@/data/errors/types";
import { TraceLink } from "./trace-link";

export function ErrorLatestOccurrence({
  occurrence,
}: {
  occurrence: ErrorOccurrence;
}) {
  return (
    <div className="flex flex-col gap-4">
      <DetailSection title="Latest occurrence">
        <DetailItem icon={<Clock3 />} label="Timestamp" value={occurrence.timestamp} />
        <DetailItem icon={<Server />} label="Service" value={occurrence.serviceName} />
        <DetailItem icon={<Fingerprint />} label="Trace ID" value={occurrence.traceId} mono />
        <DetailItem label="Span ID" value={occurrence.spanId} mono />
        <div className="pt-1">
          <TraceLink occurrence={occurrence} />
        </div>
      </DetailSection>
      <AttributeMap title="Resource attributes" map={occurrence.resourceAttributes} />
      <AttributeMap title="Log attributes" map={occurrence.logAttributes} />
      <AttributeMap title="Scope attributes" map={occurrence.scopeAttributes} />
    </div>
  );
}
```

Create `packages/app/src/components/errors/error-stacktrace.tsx`:

```tsx
import { CopyValueButton } from "@everr/ui/components/detail-panel";

export function ErrorStacktrace({ stacktrace }: { stacktrace: string }) {
  if (!stacktrace) return null;
  return (
    <section className="relative rounded-md border bg-background p-3">
      <div className="text-muted-foreground mb-2 text-xs font-medium">
        Stacktrace
      </div>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">
        {stacktrace}
      </pre>
      <CopyValueButton
        value={stacktrace}
        className="absolute right-2 top-2 bg-background shadow-sm"
      />
    </section>
  );
}
```

Create `packages/app/src/components/errors/error-occurrences-list.tsx`:

```tsx
import { Badge } from "@everr/ui/components/badge";
import type { ReactNode } from "react";
import type { ErrorOccurrence } from "@/data/errors/types";

export function ErrorOccurrencesList({
  occurrences,
  renderTraceLink,
}: {
  occurrences: ErrorOccurrence[];
  renderTraceLink: (props: {
    occurrence: ErrorOccurrence;
    children: ReactNode;
  }) => ReactNode;
}) {
  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-3 py-2 text-sm font-medium">
        Recent occurrences
      </div>
      <div className="divide-y">
        {occurrences.map((occurrence) => (
          <div
            key={`${occurrence.timestamp}:${occurrence.traceId}:${occurrence.spanId}`}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline">ERROR</Badge>
                <span className="truncate text-sm">{occurrence.serviceName}</span>
              </div>
              <div className="text-muted-foreground mt-1 truncate text-xs">
                {occurrence.timestamp}
              </div>
              <div className="mt-1 truncate text-xs">
                {occurrence.exceptionMessage || occurrence.body}
              </div>
            </div>
            {occurrence.traceId ? (
              <div className="shrink-0">
                {renderTraceLink({ occurrence, children: "Open trace" })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Wire `/errors/$fingerprint` route**

Create `packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorDetailHeader } from "@/components/errors/error-detail-header";
import { ErrorLatestOccurrence } from "@/components/errors/error-latest-occurrence";
import { ErrorOccurrencesList } from "@/components/errors/error-occurrences-list";
import { ErrorStacktrace } from "@/components/errors/error-stacktrace";
import { TraceLink } from "@/components/errors/trace-link";
import { errorIssueOptions } from "@/data/errors/options";
import { ErrorIssueSearchSchema } from "@/data/errors/schemas";
import { getErrorIssue } from "@/data/errors/server";
import { withTimeRange } from "@/lib/time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/errors/$fingerprint",
)({
  staticData: { breadcrumb: "Error", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Error" }] }),
  validateSearch: ErrorIssueSearchSchema,
  component: ErrorDetailRoute,
});

function ErrorDetailRoute() {
  const { fingerprint } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { timeRange } = withTimeRange(search);
  const query = useQuery(
    errorIssueOptions({
      getErrorIssue,
      fingerprint,
      timeRange,
      refresh: search.refresh ?? "",
      service: search.service,
      occurrenceLimit: 50,
    }),
  );

  if (query.isPending) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Error issue not found</EmptyTitle>
          <EmptyDescription>
            No occurrences matched this fingerprint in the selected time range.
          </EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/errors" search={search} />}
        >
          Back to errors
        </Button>
      </Empty>
    );
  }

  const detail = query.data;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <ErrorDetailHeader
        summary={detail.summary}
        onBack={() => navigate({ to: "/errors", search })}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <ErrorLatestOccurrence occurrence={detail.latest} />
          <ErrorStacktrace stacktrace={detail.latest.exceptionStacktrace} />
          <ErrorOccurrencesList
            occurrences={detail.occurrences}
            renderTraceLink={({ occurrence }) => (
              <TraceLink occurrence={occurrence} />
            )}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run detail tests**

Run:

```bash
pnpm --filter @everr/app test -- src/components/errors/error-pages.test.tsx
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/components/errors/trace-link.tsx \
  packages/app/src/components/errors/error-detail-header.tsx \
  packages/app/src/components/errors/error-latest-occurrence.tsx \
  packages/app/src/components/errors/error-stacktrace.tsx \
  packages/app/src/components/errors/error-occurrences-list.tsx \
  packages/app/src/components/errors/error-pages.test.tsx \
  'packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx'
git commit -m "Add error issue detail page"
```

## Task 6: Route Generation, Typecheck, and Focused Polish

**Files:**
- Modify: `packages/app/src/routeTree.gen.ts` through generated output
- Inspect: changed files from Tasks 1-5

- [ ] **Step 1: Run route generation via typecheck**

Run:

```bash
pnpm --filter @everr/app typecheck
```

Expected: pass, or fail only with route tree output needing regeneration. If route tree changes are produced, keep the generated `packages/app/src/routeTree.gen.ts` diff.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @everr/app test -- src/data/errors/server.test.ts src/data/errors/options.test.ts src/components/errors/error-pages.test.tsx
```

Expected: pass.

- [ ] **Step 3: Run app lint/check on changed files**

Run:

```bash
pnpm biome check packages/app/src/data/errors packages/app/src/components/errors packages/app/src/routes/_authenticated/_dashboard/errors.tsx 'packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx' packages/app/src/lib/navigation.ts
```

Expected: pass. If formatting changes are suggested, run:

```bash
pnpm biome check --fix packages/app/src/data/errors packages/app/src/components/errors packages/app/src/routes/_authenticated/_dashboard/errors.tsx 'packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx' packages/app/src/lib/navigation.ts
```

Then rerun the non-fix command.

- [ ] **Step 4: Check SQL guardrails**

Run:

```bash
rg -n "PREWHERE|SQL_everr_tenant_id|tenant_id = toUInt64" packages/app/src/data/errors
```

Expected: no output.

- [ ] **Step 5: Commit verification fixes and generated route tree**

```bash
git add packages/app/src/routeTree.gen.ts packages/app/src/data/errors packages/app/src/components/errors packages/app/src/routes/_authenticated/_dashboard/errors.tsx 'packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx' packages/app/src/lib/navigation.ts
git commit -m "Wire error tracking routes"
```

## Task 7: Manual Local Verification

**Files:**
- Inspect only unless a bug is found during verification.

- [ ] **Step 1: Start the web app**

Run:

```bash
pnpm --filter @everr/app dev
```

Expected: Vite starts, usually on `http://localhost:5173`.

- [ ] **Step 2: Open `/errors` in the browser**

Navigate to:

```text
http://localhost:5173/errors
```

Expected:

- The dashboard shell renders.
- Sidebar includes Errors.
- The time range and refresh controls remain visible.
- The page shows either grouped issues or the empty state.

- [ ] **Step 3: Exercise URL state**

In the UI:

- Type `boom` in the error search input and submit.
- Toggle sort to Count.
- Select and deselect a service if services are present.

Expected:

- URL search params update without a full page reload.
- The issue query refetches.
- Clearing the search returns `q` to an empty value.

- [ ] **Step 4: Exercise detail navigation**

If the list has an issue row, click it.

Expected:

- URL becomes `/errors/$fingerprint` with prior search params preserved.
- Header, latest occurrence, stack section, and occurrence list render.
- Occurrences with trace IDs show `Open trace`.

- [ ] **Step 5: Exercise trace pivot**

Click `Open trace` on an occurrence with trace context.

Expected:

- Navigation goes to `/traces/$traceId`.
- Search params include `span`, `start`, and `end`.
- The trace detail page renders or shows its existing not-found state for missing spans.

- [ ] **Step 6: Stop the dev server**

Stop the process from Step 1 with `Ctrl+C`.

- [ ] **Step 7: Commit manual verification fixes**

If manual verification required code changes, inspect `git status --short`, stage the error tracking MVP files, and commit them with:

```bash
git add packages/app/src/data/errors packages/app/src/components/errors packages/app/src/routes/_authenticated/_dashboard/errors.tsx 'packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx' packages/app/src/lib/navigation.ts packages/app/src/routeTree.gen.ts
git commit -m "Polish error tracking MVP"
```

If no code changes were needed, do not create an empty commit.

## Final Verification

Run these commands before marking the implementation complete:

```bash
pnpm --filter @everr/app test -- src/data/errors/server.test.ts src/data/errors/options.test.ts src/components/errors/error-pages.test.tsx
pnpm --filter @everr/app typecheck
pnpm biome check packages/app/src/data/errors packages/app/src/components/errors packages/app/src/routes/_authenticated/_dashboard/errors.tsx 'packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx' packages/app/src/lib/navigation.ts
rg -n "PREWHERE|SQL_everr_tenant_id|tenant_id = toUInt64" packages/app/src/data/errors
```

Expected:

- Tests pass.
- Typecheck passes.
- Biome passes.
- The `rg` SQL guardrail command prints no matches.
