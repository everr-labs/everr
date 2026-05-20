# Cloud Trace Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/traces` page to the web app at `packages/app` that lets engineers search and inspect OpenTelemetry traces stored in ClickHouse (`app.traces`). MVP scope: search page with URL-state filters; detail page with Timeline (Gantt) and raw JSON tabs.

**Architecture:** Three `createAuthenticatedServerFn` handlers query `app.traces` directly (no MV, no Tauri). Tenant scoping comes from the existing `requireOrgMiddleware` injecting `clickhouse_settings.SQL_everr_tenant_id`. Frontend lives in `packages/app/src/{routes,data,components}/traces/`. Filters are URL-state, validated with zod via `validateSearch`. Virtuoso virtualizes both the results list and the timeline rows. No pagination inside a trace — `getTrace` returns every span.

**Tech Stack:** TypeScript, React 19, TanStack Start (`createServerFn`), TanStack Router (file-based), TanStack Query, zod, `react-virtuoso`, `@everr/ui` (`TimeRangePicker`, `RefreshPicker`), `@everr/datemath`.

**Spec:** `docs/superpowers/specs/2026-05-20-cloud-trace-viewer-design.md`

**Closest reference patterns in `packages/app`:**
- Route + URL-state: `src/routes/_authenticated/_dashboard/logs.tsx`
- Server-fn + repository: `src/data/logs-explorer/server.ts` + `src/data/logs-explorer/remote-repo.ts`
- Auth + ClickHouse context: `src/lib/serverFn.ts`, `src/lib/clickhouse.ts`
- Time range: `src/lib/time-range.ts` (`TimeRangeSearchSchema`, `withTimeRange`)

---

## Phase 1 — Foundation

### Task 1: Verify `react-virtuoso` is available

**Files:**
- Inspect only: `packages/app/package.json`

- [ ] **Step 1: Confirm the dep**

`react-virtuoso` is already a dependency in `packages/app/package.json` (~line 45). Grep to confirm:

```bash
grep '"react-virtuoso"' packages/app/package.json
```

No install step required. Do not pull in `@tanstack/react-virtual` — Virtuoso is the only virtualization library used for this feature.

### Task 2: Create traces DTOs

**Files:**
- Create: `packages/app/src/data/traces/types.ts`

- [ ] **Step 1: Mirror the ClickHouse output shape 1:1**

Create `packages/app/src/data/traces/types.ts`:

```ts
export type SpanStatus = "Ok" | "Error" | "Unset";

export type TraceSummary = {
  traceId: string;
  rootName: string;
  rootService: string;
  rootStatus: SpanStatus;
  startTs: string;        // DateTime64(9) serialized
  durationNs: string;     // UInt64 as string (ClickHouse driver returns ints as strings)
  spanCount: number;
  errorCount: number;
  services: string[];
};

export type SpanEvent = {
  name: string;
  timestamp: string;
  attributes: Record<string, string>;
};

export type SpanLink = {
  traceId: string;
  spanId: string;
  attributes: Record<string, string>;
};

export type Span = {
  traceId: string;
  spanId: string;
  parentSpanId: string;          // "" for root spans
  spanName: string;
  serviceName: string;
  serviceNamespace: string;
  timestamp: string;             // DateTime64(9) ISO-ish (for display)
  timestampNs: string;           // UInt64 unix ns (for math + sort)
  duration: string;              // UInt64 ns
  statusCode: SpanStatus;
  spanKind: string;
  spanAttributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  events: SpanEvent[];
  links: SpanLink[];
};

export type ServiceIdentity = {
  serviceNamespace: string;
  serviceName: string;
};
```

### Task 3: Create URL-state schemas

**Files:**
- Create: `packages/app/src/data/traces/schemas.ts`

- [ ] **Step 1: Define search-page and detail-page schemas**

Create `packages/app/src/data/traces/schemas.ts`:

```ts
import { z } from "zod";
import { TimeRangeSearchSchema } from "@/lib/time-range";

export const SpanStatusFilterSchema = z.enum(["ok", "error", "all"]);
export type SpanStatusFilter = z.infer<typeof SpanStatusFilterSchema>;

export const TraceSearchParamsSchema = TimeRangeSearchSchema.extend({
  namespace: z.array(z.string()).default([]),
  service: z.array(z.string()).default([]),
  name: z.string().default(""),
  minMs: z.number().int().nonnegative().optional(),
  maxMs: z.number().int().nonnegative().optional(),
  status: SpanStatusFilterSchema.default("all"),
  limit: z.number().int().positive().max(500).default(50),
});

export const TraceDetailParamsSchema = TimeRangeSearchSchema.extend({
  tab: z.enum(["timeline", "json"]).default("timeline"),
  span: z.string().optional(),
  // Tight window populated by the search-row link so the get-trace query can prune
  // parts. Falls back to from/to when absent (deep links).
  start: z.string().optional(),
  end: z.string().optional(),
});

export type TraceSearchParams = z.infer<typeof TraceSearchParamsSchema>;
export type TraceDetailParams = z.infer<typeof TraceDetailParamsSchema>;

// Inputs sent to the server functions — datemath resolved to ClickHouse-compatible strings.
export const SearchTracesInputSchema = z.object({
  fromTs: z.string(),
  toTs: z.string(),
  namespace: z.array(z.string()).default([]),
  service: z.array(z.string()).default([]),
  name: z.string().default(""),
  minDurationNs: z.string().optional(),
  maxDurationNs: z.string().optional(),
  status: SpanStatusFilterSchema.default("all"),
  limit: z.number().int().positive().max(500).default(50),
});
export type SearchTracesInput = z.infer<typeof SearchTracesInputSchema>;

export const GetTraceInputSchema = z.object({
  traceId: z.string().min(1),
  fromTs: z.string(),
  toTs: z.string(),
});
export type GetTraceInput = z.infer<typeof GetTraceInputSchema>;

export const ListServiceIdentitiesInputSchema = z.object({
  fromTs: z.string(),
  toTs: z.string(),
});
export type ListServiceIdentitiesInput = z.infer<
  typeof ListServiceIdentitiesInputSchema
>;
```

### Task 4: Shared utilities

**Files:**
- Create: `packages/app/src/components/traces/shared/service-color.ts`
- Create: `packages/app/src/components/traces/shared/format-duration.ts`
- Create: `packages/app/src/data/traces/window.ts`

- [ ] **Step 1: Stable service color**

Create `packages/app/src/components/traces/shared/service-color.ts`:

```ts
// Stable hash of "namespace/name" → palette index. Returns a CSS-var reference
// so a theme switch is one-file later.
const PALETTE = [
  "--trace-service-1",
  "--trace-service-2",
  "--trace-service-3",
  "--trace-service-4",
  "--trace-service-5",
  "--trace-service-6",
  "--trace-service-7",
  "--trace-service-8",
] as const;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function serviceColor(namespace: string, name: string): string {
  const key = `${namespace}/${name}`;
  const idx = fnv1a(key) % PALETTE.length;
  return `var(${PALETTE[idx]})`;
}
```

- [ ] **Step 2: Add CSS vars for the palette**

Find the global stylesheet for `packages/app` (look for `index.css` or similar imported by `main.tsx`) and add the `--trace-service-N` variables under the existing `:root` block with palette-appropriate colors. Use the existing theme tokens where possible.

- [ ] **Step 3: Human-friendly duration formatter**

Create `packages/app/src/components/traces/shared/format-duration.ts`:

```ts
// ns → "1.23ms", "456μs", "7.8s", "1m 12s"
export function formatDurationNs(ns: bigint | string | number): string {
  const value = typeof ns === "bigint" ? ns : BigInt(ns);
  if (value < 1_000n) return `${value}ns`;
  if (value < 1_000_000n) {
    return `${(Number(value) / 1_000).toFixed(1)}μs`;
  }
  if (value < 1_000_000_000n) {
    return `${(Number(value) / 1_000_000).toFixed(2)}ms`;
  }
  const seconds = Number(value) / 1_000_000_000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.floor(seconds - mins * 60);
  return `${mins}m ${rem}s`;
}
```

- [ ] **Step 4: Detail-window helper**

Create `packages/app/src/data/traces/window.ts`. Used by the route loader, the detail page, and the search-row link to compute a tight `[fromTs, toTs]` window for `getTrace` so the query can prune parts (the order key on `app.traces` is `(tenant_id, ServiceName, SpanName, toDateTime(Timestamp))` — a bare `TraceId =` lookup scans broadly).

```ts
import {
  resolveTimeRange,
  toClickHouseDateTime,
  type TimeRange,
} from "@/lib/time-range";

export type DetailWindow = { fromTs: string; toTs: string };

const HOUR_MS = 3_600_000;

// When the search-row link carries precise [start, end] CH datetimes, pad ±1h to
// absorb clock skew. Otherwise fall back to the dashboard's time range (deep links).
export function computeDetailWindow(input: {
  start: string | undefined;
  end: string | undefined;
  timeRange: TimeRange;
}): DetailWindow {
  if (input.start && input.end) {
    return {
      fromTs: shiftCHDateTime(input.start, -HOUR_MS),
      toTs: shiftCHDateTime(input.end, HOUR_MS),
    };
  }
  const { fromDate, toDate } = resolveTimeRange(input.timeRange);
  return {
    fromTs: toClickHouseDateTime(fromDate),
    toTs: toClickHouseDateTime(toDate),
  };
}

export function addNsToCHDateTime(ts: string, ns: bigint): string {
  const ms = Number(ns / 1_000_000n);
  return shiftCHDateTime(ts, ms);
}

function shiftCHDateTime(ts: string, ms: number): string {
  // toClickHouseDateTime strips T/Z; reverse to parse, then reformat.
  const date = new Date(ts.replace(" ", "T") + "Z");
  return toClickHouseDateTime(new Date(date.getTime() + ms));
}
```

---

## Phase 2 — Data layer

### Task 5: TracesRepository

**Files:**
- Create: `packages/app/src/data/traces/repository.ts`

- [ ] **Step 1: Repository class wrapping the three queries**

The repo takes a `query` function with the same shape as `clickhouse.query` from `lib/clickhouse.ts`. Tenant scoping is the row policy on `app.traces` — **do not** add `tenant_id = …` clauses anywhere. **Do not** use `PREWHERE`.

Notes baked into the SQL:

- The CTE groups by `TraceId` and orders by `max(Timestamp) DESC` before `LIMIT 1000` so the cap selects the freshest matching traces, not an arbitrary subset.
- `HAVING` predicates are appended only when the corresponding filter is set. `toUInt64('')` raises, so the previous `'' OR …` short-circuit was unsafe.
- Root election uses `*If` aggregates with the `OrDefault` story handled explicitly: `countIf(ParentSpanId = '') > 0` gates the rooted path, falling back to the overall-earliest span otherwise.
- `getTrace` adds `Timestamp BETWEEN {fromTs} AND {toTs}` so the part pruner can do its job; the order key on `app.traces` is `(tenant_id, ServiceName, SpanName, toDateTime(Timestamp))`, so a bare `TraceId =` lookup is bloom-filter-only and scans too widely as retention grows.
- `Events` and `Links` are `Nested(...)` columns; with `flatten_nested=1` (the default) they are read as parallel arrays. The repo SELECTs the subcolumns and zips them client-side via `rowToSpan`.
- `toUnixTimestamp64Nano(Timestamp)` is added as `timestampNs` so the timeline can sort and compute layout with `BigInt` math; the original DateTime is kept as `timestamp` for display.

Create `packages/app/src/data/traces/repository.ts`:

```ts
import type {
  GetTraceInput,
  ListServiceIdentitiesInput,
  SearchTracesInput,
} from "./schemas";
import type { ServiceIdentity, Span, TraceSummary } from "./types";

type Query = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;

type SpanRow = Omit<Span, "events" | "links"> & {
  eventNames: string[];
  eventTimestamps: string[];
  eventAttributes: Record<string, string>[];
  linkTraceIds: string[];
  linkSpanIds: string[];
  linkAttributes: Record<string, string>[];
};

export class TracesRepository {
  constructor(private readonly query: Query) {}

  async search(input: SearchTracesInput): Promise<TraceSummary[]> {
    const havingParts: string[] = [];
    const params: Record<string, unknown> = {
      fromTs: input.fromTs,
      toTs: input.toTs,
      name: input.name,
      service: input.service,
      namespace: input.namespace,
      limit: input.limit,
    };

    if (input.minDurationNs !== undefined) {
      havingParts.push("toUInt64(durationNs) >= {minDurationNs:UInt64}");
      params.minDurationNs = input.minDurationNs;
    }
    if (input.maxDurationNs !== undefined) {
      havingParts.push("toUInt64(durationNs) <= {maxDurationNs:UInt64}");
      params.maxDurationNs = input.maxDurationNs;
    }
    if (input.status === "ok" || input.status === "error") {
      havingParts.push("rootStatus = {status:String}");
      params.status = input.status === "error" ? "Error" : "Ok";
    }
    const havingClause =
      havingParts.length > 0 ? `HAVING ${havingParts.join(" AND ")}` : "";

    const sql = /* sql */ `
      WITH matching_traces AS (
        SELECT TraceId
        FROM app.traces
        WHERE Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
          AND ({name:String} = '' OR positionCaseInsensitive(SpanName, {name:String}) > 0)
          AND (empty({service:Array(String)}) OR ServiceName IN {service:Array(String)})
          AND (empty({namespace:Array(String)})
               OR ResourceAttributes['service.namespace'] IN {namespace:Array(String)})
        GROUP BY TraceId
        ORDER BY max(Timestamp) DESC
        LIMIT 1000
      )
      SELECT
        TraceId AS traceId,
        if(countIf(ParentSpanId = '') > 0,
           argMinIf(SpanName,    (Timestamp, SpanId), ParentSpanId = ''),
           argMin  (SpanName,    (Timestamp, SpanId))) AS rootName,
        if(countIf(ParentSpanId = '') > 0,
           argMinIf(ServiceName, (Timestamp, SpanId), ParentSpanId = ''),
           argMin  (ServiceName, (Timestamp, SpanId))) AS rootService,
        if(countIf(ParentSpanId = '') > 0,
           argMinIf(StatusCode,  (Timestamp, SpanId), ParentSpanId = ''),
           argMin  (StatusCode,  (Timestamp, SpanId))) AS rootStatus,
        toString(min(Timestamp)) AS startTs,
        toString(
          toUInt64(dateDiff('nanosecond', min(Timestamp),
                            max(addNanoseconds(Timestamp, Duration))))
        ) AS durationNs,
        toUInt32(count())                       AS spanCount,
        toUInt32(countIf(StatusCode = 'Error')) AS errorCount,
        groupUniqArray(ServiceName)             AS services
      FROM app.traces
      WHERE TraceId IN (SELECT TraceId FROM matching_traces)
      GROUP BY TraceId
      ${havingClause}
      ORDER BY startTs DESC
      LIMIT {limit:UInt32}
    `;
    return this.query<TraceSummary>(sql, params);
  }

  async getTrace(input: GetTraceInput): Promise<Span[]> {
    const sql = /* sql */ `
      SELECT
        TraceId      AS traceId,
        SpanId       AS spanId,
        ParentSpanId AS parentSpanId,
        SpanName     AS spanName,
        ServiceName  AS serviceName,
        ResourceAttributes['service.namespace'] AS serviceNamespace,
        toString(Timestamp)                     AS timestamp,
        toString(toUnixTimestamp64Nano(Timestamp)) AS timestampNs,
        toString(Duration)                      AS duration,
        StatusCode AS statusCode,
        SpanKind   AS spanKind,
        SpanAttributes     AS spanAttributes,
        ResourceAttributes AS resourceAttributes,
        Events.Name       AS eventNames,
        arrayMap(t -> toString(t), Events.Timestamp) AS eventTimestamps,
        Events.Attributes AS eventAttributes,
        Links.TraceId     AS linkTraceIds,
        Links.SpanId      AS linkSpanIds,
        Links.Attributes  AS linkAttributes
      FROM app.traces
      WHERE TraceId = {traceId:String}
        AND Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
      ORDER BY Timestamp ASC
    `;
    const rows = await this.query<SpanRow>(sql, {
      traceId: input.traceId,
      fromTs: input.fromTs,
      toTs: input.toTs,
    });
    return rows.map(rowToSpan);
  }

  async listServiceIdentities(
    input: ListServiceIdentitiesInput,
  ): Promise<ServiceIdentity[]> {
    const sql = /* sql */ `
      SELECT DISTINCT
        ResourceAttributes['service.namespace'] AS serviceNamespace,
        ServiceName AS serviceName
      FROM app.traces
      WHERE Timestamp BETWEEN {fromTs:DateTime64(9)} AND {toTs:DateTime64(9)}
      ORDER BY serviceNamespace, serviceName
    `;
    return this.query<ServiceIdentity>(sql, {
      fromTs: input.fromTs,
      toTs: input.toTs,
    });
  }
}

function rowToSpan(row: SpanRow): Span {
  const {
    eventNames,
    eventTimestamps,
    eventAttributes,
    linkTraceIds,
    linkSpanIds,
    linkAttributes,
    ...rest
  } = row;
  return {
    ...rest,
    events: eventNames.map((name, i) => ({
      name,
      timestamp: eventTimestamps[i] ?? "",
      attributes: eventAttributes[i] ?? {},
    })),
    links: linkTraceIds.map((traceId, i) => ({
      traceId,
      spanId: linkSpanIds[i] ?? "",
      attributes: linkAttributes[i] ?? {},
    })),
  };
}
```

- [ ] **Step 2: Confirm columns and Nested unpacking against the schema**

Open `clickhouse/init/03-create-otel-tables.sql` and `clickhouse/init/10-create-mvs.sql`. Confirm:

- Column names exist as referenced: `TraceId`, `SpanId`, `ParentSpanId`, `SpanName`, `ServiceName`, `Timestamp`, `Duration`, `StatusCode`, `SpanKind`, `SpanAttributes`, `ResourceAttributes`.
- `Events` and `Links` are `Nested(...)`; the SELECT must read the subcolumns (`Events.Name`, `Events.Timestamp`, `Events.Attributes`, `Links.TraceId`, `Links.SpanId`, `Links.Attributes`) and the repo's `rowToSpan` zips them into objects. Do **not** `SELECT Events AS events` — with `flatten_nested=1` (default) that returns parallel-array columns, not an array of structs.
- Order key on the table is `(tenant_id, ServiceName, SpanName, toDateTime(Timestamp))` — confirms why `getTrace` needs a `Timestamp BETWEEN` predicate, not just `TraceId =`.

If any of the subcolumn names differ (e.g. `Events.Time` instead of `Events.Timestamp`), update both the SELECT and `rowToSpan` accordingly.

### Task 6: Server functions

**Files:**
- Create: `packages/app/src/data/traces/server.ts`

- [ ] **Step 1: Wire the three handlers**

Mirror the `logs-explorer/server.ts` shape: `createAuthenticatedServerFn({ method }).inputValidator(schema).handler(({data, context: {clickhouse}}) => repo.method(data))`.

Create `packages/app/src/data/traces/server.ts`:

```ts
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { TracesRepository } from "./repository";
import {
  GetTraceInputSchema,
  ListServiceIdentitiesInputSchema,
  SearchTracesInputSchema,
} from "./schemas";

function repoFromContext(clickhouse: {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}) {
  return new TracesRepository(clickhouse.query);
}

export const searchTraces = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchTracesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).search(data),
  );

export const getTrace = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetTraceInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).getTrace(data),
  );

export const listServiceIdentities = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(ListServiceIdentitiesInputSchema)
  .handler(({ data, context: { clickhouse } }) =>
    repoFromContext(clickhouse).listServiceIdentities(data),
  );
```

### Task 7: Query options

**Files:**
- Create: `packages/app/src/data/traces/options.ts`

- [ ] **Step 1: Define queryOptions factories**

Key on **raw datemath strings** (`from`, `to`), not resolved ns. Resolve inside the fetcher (see the design doc, section "Data flow"). Use the existing `resolveTimeRange` (returns `{ fromDate, toDate, fromISO, toISO }`) and `toClickHouseDateTime` from `@/lib/time-range`. Wire `refetchInterval` from the `refresh` URL param via the re-exported `getRefreshIntervalMs`.

Create `packages/app/src/data/traces/options.ts`:

```ts
import { queryOptions } from "@tanstack/react-query";
import {
  getRefreshIntervalMs,
  resolveTimeRange,
  toClickHouseDateTime,
  type TimeRange,
} from "@/lib/time-range";
import type { SpanStatusFilter } from "./schemas";
import {
  getTrace,
  listServiceIdentities,
  searchTraces,
} from "./server";
import type { DetailWindow } from "./window";

export type TraceSearchOptionsInput = {
  timeRange: TimeRange;             // raw datemath, e.g. { from: "now-1h", to: "now" }
  refresh: string;
  namespace: string[];
  service: string[];
  name: string;
  minMs: number | undefined;
  maxMs: number | undefined;
  status: SpanStatusFilter;
  limit: number;
};

const MS_TO_NS = 1_000_000n;

export function tracesSearchOptions(input: TraceSearchOptionsInput) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: ["traces", "search", input] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      return searchTraces({
        data: {
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
          namespace: input.namespace,
          service: input.service,
          name: input.name,
          minDurationNs:
            input.minMs === undefined
              ? undefined
              : (BigInt(input.minMs) * MS_TO_NS).toString(),
          maxDurationNs:
            input.maxMs === undefined
              ? undefined
              : (BigInt(input.maxMs) * MS_TO_NS).toString(),
          status: input.status,
          limit: input.limit,
        },
      });
    },
    refetchInterval: refreshMs > 0 ? refreshMs : false,
  });
}

export type GetTraceOptionsInput = {
  traceId: string;
  window: DetailWindow;
  refresh: string;
};

export function getTraceOptions(input: GetTraceOptionsInput) {
  const refreshMs = getRefreshIntervalMs(input.refresh);
  return queryOptions({
    queryKey: [
      "traces",
      "get",
      input.traceId,
      input.window.fromTs,
      input.window.toTs,
    ] as const,
    queryFn: () =>
      getTrace({
        data: {
          traceId: input.traceId,
          fromTs: input.window.fromTs,
          toTs: input.window.toTs,
        },
      }),
    enabled: input.traceId.length > 0,
    refetchInterval: refreshMs > 0 ? refreshMs : false,
  });
}

export function listServiceIdentitiesOptions(timeRange: TimeRange) {
  return queryOptions({
    queryKey: ["traces", "service-identities", timeRange] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(timeRange);
      return listServiceIdentities({
        data: {
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
        },
      });
    },
  });
}
```

---

## Phase 3 — Search page

### Task 8: Route shell

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/traces.tsx`

- [ ] **Step 1: Create the route file with `validateSearch` and `staticData`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { TraceSearchParamsSchema } from "@/data/traces/schemas";
import { TracesSearchPage } from "@/components/traces/traces-search-page";

export const Route = createFileRoute("/_authenticated/_dashboard/traces")({
  staticData: { breadcrumb: "Traces", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Traces" }] }),
  validateSearch: TraceSearchParamsSchema,
  component: TracesSearchPage,
});
```

The `_dashboard.tsx` parent layout renders `TimeRangePicker` + `RefreshPicker` unless `staticData.hideTimeRangePicker` is set. Leave it unset so both pickers appear on `/traces`.

### Task 9: Search page component

**Files:**
- Create: `packages/app/src/components/traces/traces-search-page.tsx`
- Create: `packages/app/src/components/traces/trace-filters.tsx`

- [ ] **Step 1: Top-level search page**

```tsx
// traces-search-page.tsx
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { withTimeRange } from "@/lib/time-range";
import {
  listServiceIdentitiesOptions,
  tracesSearchOptions,
} from "@/data/traces/options";
import { TraceFilters } from "./trace-filters";
import { TraceResultsList } from "./trace-results-list";

const route = getRouteApi("/_authenticated/_dashboard/traces");

export function TracesSearchPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: route.id });
  const { timeRange } = withTimeRange(search);

  const identitiesQuery = useQuery(listServiceIdentitiesOptions(timeRange));
  const tracesQuery = useQuery(
    tracesSearchOptions({
      timeRange,
      refresh: search.refresh ?? "",
      namespace: search.namespace,
      service: search.service,
      name: search.name,
      minMs: search.minMs,
      maxMs: search.maxMs,
      status: search.status,
      limit: search.limit,
    }),
  );

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <TraceFilters
        value={search}
        identities={identitiesQuery.data ?? []}
        onChange={(patch) =>
          navigate({
            search: (prev) => ({ ...prev, ...patch }),
            replace: true,
          })
        }
      />
      <TraceResultsList
        query={tracesQuery}
        onLoadMore={() =>
          navigate({
            search: (prev) => ({ ...prev, limit: (prev.limit ?? 50) + 50 }),
            replace: true,
          })
        }
        onClearFilters={() =>
          navigate({
            search: () => ({}) as never,
            replace: true,
          })
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Filter bar**

`trace-filters.tsx` renders:
- Multi-select for `namespace` populated from `identities` (deduped `serviceNamespace`).
- Multi-select for `service` populated from `identities`, narrowed to currently-selected namespaces (cascading filter on the dropdown only — the URL state stores both lists independently).
- Debounced text input for `name`.
- Two number inputs (min / max ms) for duration.
- Three-option toggle for `status` (`all` | `ok` | `error`).
- "Clear filters" link if any are non-default.

Props:

```ts
type TraceFiltersProps = {
  value: {
    namespace: string[];
    service: string[];
    name: string;
    minMs?: number;
    maxMs?: number;
    status: "ok" | "error" | "all";
  };
  identities: { serviceNamespace: string; serviceName: string }[];
  onChange: (patch: Partial<TraceFiltersProps["value"]>) => void;
};
```

Use existing `@everr/ui` multi-select / combobox components. Match the visual density and label placement of `LogsExplorer`'s filter row (open `@everr/logs-explorer` for reference).

### Task 10: Results list with Virtuoso

**Files:**
- Create: `packages/app/src/components/traces/trace-results-list.tsx`
- Create: `packages/app/src/components/traces/duration-bar.tsx`

- [ ] **Step 1: Duration bar**

```tsx
// duration-bar.tsx
type DurationBarProps = {
  durationNs: bigint;
  maxDurationNs: bigint;
};

export function DurationBar({ durationNs, maxDurationNs }: DurationBarProps) {
  const ratio =
    maxDurationNs === 0n
      ? 0
      : Number((durationNs * 1000n) / maxDurationNs) / 1000;
  return (
    <div className="bg-muted h-1.5 w-32 overflow-hidden rounded">
      <div
        className="bg-primary h-full"
        style={{ width: `${Math.max(2, ratio * 100)}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Virtuoso results list**

```tsx
// trace-results-list.tsx
import { Virtuoso } from "react-virtuoso";
import { Link } from "@tanstack/react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TraceSummary } from "@/data/traces/types";
import { addNsToCHDateTime } from "@/data/traces/window";
import { formatDurationNs } from "./shared/format-duration";
import { serviceColor } from "./shared/service-color";
import { DurationBar } from "./duration-bar";

type Props = {
  query: UseQueryResult<TraceSummary[]>;
  onLoadMore: () => void;
  onClearFilters: () => void;
};

export function TraceResultsList({ query, onLoadMore, onClearFilters }: Props) {
  if (query.isPending) return <ResultsSkeleton />;
  if (query.isError) {
    return (
      <ErrorCard message={(query.error as Error).message} onRetry={query.refetch} />
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <EmptyState onClearFilters={onClearFilters} />;
  }

  const maxDuration = rows.reduce(
    (acc, r) => (BigInt(r.durationNs) > acc ? BigInt(r.durationNs) : acc),
    0n,
  );

  return (
    <>
      <Virtuoso
        className="flex-1"
        data={rows}
        itemContent={(_, row) => (
          <TraceRow row={row} maxDuration={maxDuration} />
        )}
      />
      <button className="text-sm text-muted-foreground" onClick={onLoadMore}>
        Load more
      </button>
    </>
  );
}

function TraceRow({
  row,
  maxDuration,
}: {
  row: TraceSummary;
  maxDuration: bigint;
}) {
  return (
    <Link
      to="/traces/$traceId"
      params={{ traceId: row.traceId }}
      search={(prev) => ({
        ...prev,
        tab: "timeline" as const,
        start: row.startTs,
        end: addNsToCHDateTime(row.startTs, BigInt(row.durationNs)),
      })}
      className="hover:bg-muted/50 flex items-center gap-3 border-b px-3 py-2"
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{
          backgroundColor: serviceColor(
            /* namespace unavailable at row scope; pass "" */ "",
            row.rootService,
          ),
        }}
      />
      <div className="flex-1 truncate">
        <div className="font-medium truncate">{row.rootName}</div>
        <div className="text-muted-foreground text-xs">{row.rootService}</div>
      </div>
      <DurationBar
        durationNs={BigInt(row.durationNs)}
        maxDurationNs={maxDuration}
      />
      <div className="w-20 text-right text-sm tabular-nums">
        {formatDurationNs(row.durationNs)}
      </div>
      <div className="text-muted-foreground w-16 text-right text-xs">
        {row.spanCount} spans
      </div>
      {row.errorCount > 0 && (
        <span className="text-destructive text-xs">
          {row.errorCount} err
        </span>
      )}
    </Link>
  );
}
```

`ResultsSkeleton`, `ErrorCard`, and `EmptyState` are small local components — implement inline, no new files. `EmptyState` includes a button that calls `onClearFilters`.

---

## Phase 4 — Detail page

### Task 11: Route shell + loader

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/traces/$traceId.tsx`

- [ ] **Step 1: File-route at the nested path**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getTraceOptions } from "@/data/traces/options";
import { TraceDetailParamsSchema } from "@/data/traces/schemas";
import { computeDetailWindow } from "@/data/traces/window";
import { TraceDetailPage } from "@/components/traces/trace-detail-page";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/traces/$traceId",
)({
  staticData: { breadcrumb: "Trace", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Trace" }] }),
  validateSearch: TraceDetailParamsSchema,
  loaderDeps: ({ search }) => ({
    start: search.start,
    end: search.end,
    from: search.from,
    to: search.to,
    refresh: search.refresh,
  }),
  loader: ({ context: { queryClient }, params, deps }) =>
    queryClient.ensureQueryData(
      getTraceOptions({
        traceId: params.traceId,
        window: computeDetailWindow({
          start: deps.start,
          end: deps.end,
          timeRange: { from: deps.from ?? "", to: deps.to ?? "" },
        }),
        refresh: deps.refresh ?? "",
      }),
    ),
  component: TraceDetailPage,
});
```

### Task 12: Detail page tabs

**Files:**
- Create: `packages/app/src/components/traces/trace-detail-page.tsx`

- [ ] **Step 1: Top-level page with tab switching driven by `?tab=`**

```tsx
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { getTraceOptions } from "@/data/traces/options";
import { computeDetailWindow } from "@/data/traces/window";
import { TimelineView } from "./timeline/timeline-view";
import { JsonView } from "./json/json-view";

const route = getRouteApi("/_authenticated/_dashboard/traces/$traceId");

export function TraceDetailPage() {
  const { traceId } = route.useParams();
  const search = route.useSearch();
  const { tab, span } = search;
  const navigate = useNavigate({ from: route.id });
  const window = useMemo(
    () =>
      computeDetailWindow({
        start: search.start,
        end: search.end,
        timeRange: { from: search.from ?? "", to: search.to ?? "" },
      }),
    [search.start, search.end, search.from, search.to],
  );
  const { data: spans, isPending, error, refetch } = useQuery(
    getTraceOptions({
      traceId,
      window,
      refresh: search.refresh ?? "",
    }),
  );

  if (isPending) return <DetailSkeleton />;
  if (error) {
    return <ErrorCard message={(error as Error).message} onRetry={refetch} />;
  }
  if (!spans || spans.length === 0) {
    return <NotFoundState traceId={traceId} />;
  }

  return (
    <div className="flex h-full flex-col">
      <TraceHeader
        spans={spans}
        traceId={traceId}
        onRefresh={refetch}
      />
      <Tabs
        active={tab}
        onSelect={(next) =>
          navigate({
            search: (prev) => ({ ...prev, tab: next }),
            replace: true,
          })
        }
      />
      {tab === "timeline" ? (
        <TimelineView
          spans={spans}
          focusedSpan={span}
          onSelectSpan={(spanId) =>
            navigate({
              search: (prev) => ({ ...prev, span: spanId }),
              replace: true,
            })
          }
        />
      ) : (
        <JsonView spans={spans} />
      )}
    </div>
  );
}
```

`TraceHeader`, `Tabs`, `DetailSkeleton`, `ErrorCard`, `NotFoundState` are small local components in this file. `TraceHeader` shows root name + service + total duration + span count + a manual refresh button.

### Task 13: Timeline layout hook

**Files:**
- Create: `packages/app/src/components/traces/timeline/use-timeline-layout.ts`

- [ ] **Step 1: Flat `Span[]` → ordered rows with collapse state**

Pure function + hook wrapper. Behavior:

1. Build `parent → children[]` map from `parentSpanId` and the set of all span IDs.
2. **Collect every root**: spans whose `parentSpanId === ""` plus spans whose `parentSpanId` references an ID not present in the trace (orphan roots — happens when a trace crosses a retention boundary, or when the search-row window clipped a parent). Multi-root traces (microservices that emit overlapping non-root span trees) and orphan-only traces are both real.
3. Sort siblings (and the root list itself) by `(timestampNs, spanId)`.
4. DFS from each root in order, emitting one `TimelineRow` per visited span with `depth`, parent reference, and a `hidden` flag derived from `collapsed[ancestor]`.
5. Compute `traceStartNs` / `traceEndNs` using `BigInt(span.timestampNs)` + `BigInt(span.duration)`. `timestampNs` is a unix-ns string (added explicitly by the SQL); never `BigInt(span.timestamp)` — that's a DateTime string.
6. Return `{ rows, traceStartNs, traceEndNs, toggleCollapse }`.

```ts
import { useMemo, useState } from "react";
import type { Span } from "@/data/traces/types";

export type TimelineRow = {
  span: Span;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
};

function compareSpans(a: Span, b: Span): number {
  const at = BigInt(a.timestampNs);
  const bt = BigInt(b.timestampNs);
  if (at !== bt) return at < bt ? -1 : 1;
  return a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0;
}

export function useTimelineLayout(spans: Span[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const layout = useMemo(() => {
    const byParent = new Map<string, Span[]>();
    const knownIds = new Set<string>();
    for (const s of spans) {
      knownIds.add(s.spanId);
    }
    for (const s of spans) {
      const arr = byParent.get(s.parentSpanId) ?? [];
      arr.push(s);
      byParent.set(s.parentSpanId, arr);
    }
    for (const arr of byParent.values()) {
      arr.sort(compareSpans);
    }

    // Roots = explicit roots (parentSpanId === "") + orphan roots (parent not in set).
    const roots: Span[] = [];
    for (const s of spans) {
      if (s.parentSpanId === "" || !knownIds.has(s.parentSpanId)) {
        roots.push(s);
      }
    }
    roots.sort(compareSpans);

    const rows: TimelineRow[] = [];
    for (const root of roots) {
      const stack: { span: Span; depth: number; hidden: boolean }[] = [
        { span: root, depth: 0, hidden: false },
      ];
      while (stack.length > 0) {
        const { span, depth, hidden } = stack.pop()!;
        const children = byParent.get(span.spanId) ?? [];
        if (!hidden) {
          rows.push({
            span,
            depth,
            hasChildren: children.length > 0,
            collapsed: collapsed.has(span.spanId),
          });
        }
        const childHidden = hidden || collapsed.has(span.spanId);
        // Push children in reverse so the leftmost child pops first.
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({
            span: children[i],
            depth: depth + 1,
            hidden: childHidden,
          });
        }
      }
    }

    let startBig: bigint | undefined;
    let endBig = 0n;
    for (const s of spans) {
      const t = BigInt(s.timestampNs);
      const end = t + BigInt(s.duration);
      if (startBig === undefined || t < startBig) startBig = t;
      if (end > endBig) endBig = end;
    }

    return {
      rows,
      traceStartNs: startBig ?? 0n,
      traceEndNs: endBig,
    };
  }, [spans, collapsed]);

  function toggleCollapse(spanId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }

  return { ...layout, toggleCollapse };
}
```

### Task 14: Timeline view + span row + span bar

**Files:**
- Create: `packages/app/src/components/traces/timeline/timeline-view.tsx`
- Create: `packages/app/src/components/traces/timeline/span-row.tsx`
- Create: `packages/app/src/components/traces/timeline/span-bar.tsx`

- [ ] **Step 1: Timeline view orchestrates the row list + side panel**

```tsx
// timeline-view.tsx
import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { Span } from "@/data/traces/types";
import { SpanDetailPanel } from "./span-detail-panel";
import { SpanRow } from "./span-row";
import { useTimelineLayout } from "./use-timeline-layout";

type Props = {
  spans: Span[];
  focusedSpan: string | undefined;
  onSelectSpan: (spanId: string) => void;
};

export function TimelineView({ spans, focusedSpan, onSelectSpan }: Props) {
  const { rows, traceStartNs, traceEndNs, toggleCollapse } =
    useTimelineLayout(spans);
  const selected = useMemo(
    () => spans.find((s) => s.spanId === focusedSpan),
    [spans, focusedSpan],
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      <Virtuoso
        className="flex-1"
        data={rows}
        itemContent={(_, row) => (
          <SpanRow
            row={row}
            traceStartNs={traceStartNs}
            traceEndNs={traceEndNs}
            selected={row.span.spanId === focusedSpan}
            onToggle={() => toggleCollapse(row.span.spanId)}
            onSelect={() => onSelectSpan(row.span.spanId)}
          />
        )}
      />
      {selected && (
        <SpanDetailPanel
          span={selected}
          onClose={() => onSelectSpan("")}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Span row + span bar**

`span-row.tsx`: renders the indented label area (collapse caret, service color dot, span name, service name, duration text) and the bar area (absolutely-positioned `<SpanBar>`).

`span-bar.tsx`: computes `left%` and `width%` from `(traceStartNs, traceEndNs, span.timestamp, span.duration)`. Renders a `<div>` with `position: absolute`, `backgroundColor: serviceColor(...)`. Zero-duration spans render at `min-width: 1px`. Error spans get a red overlay.

Both stay presentational; no `useQuery`, no `useState`.

### Task 15: Span detail panel

**Files:**
- Create: `packages/app/src/components/traces/timeline/span-detail-panel.tsx`

- [ ] **Step 1: Side panel showing the selected span**

Sections: span name, service, status, kind, start (absolute + relative to trace start), duration, span attributes (key/value list), resource attributes, events, links. Close button calls `onClose()`. No interactivity beyond closing.

### Task 16: JSON view

**Files:**
- Create: `packages/app/src/components/traces/json/json-view.tsx`

- [ ] **Step 1: Raw JSON of the full spans payload**

```tsx
type Props = { spans: Span[] };

export function JsonView({ spans }: Props) {
  return (
    <pre className="bg-muted/30 flex-1 overflow-auto p-4 text-xs">
      {JSON.stringify(spans, null, 2)}
    </pre>
  );
}
```

If `packages/app` already imports a syntax-highlighted JSON component (e.g. Shiki via an existing component), use that instead.

---

## Phase 5 — Polish & tests

### Task 17: Sidebar nav link

**Files:**
- Modify: the dashboard navigation component that renders sidebar links (find it under `packages/app/src/components/` or wherever the existing `Logs` / `Runs` links live)

- [ ] **Step 1: Locate the sidebar component**

```bash
rg -l 'to="/logs"' packages/app/src
```

Open the file that has the `/logs` `<Link>` and add an entry with the same shape pointing to `/traces`. Icon suggestion: a generic timeline / waterfall lucide icon (e.g. `AlignLeft`, `BarChart3`, or whichever the existing sidebar already uses for telemetry-shaped routes). Order: just below `Logs` if that exists.

### Task 18: Tests — pure functions

**Files:**
- Create: `packages/app/src/components/traces/timeline/use-timeline-layout.test.ts`
- Create: `packages/app/src/components/traces/shared/service-color.test.ts`
- Create: `packages/app/src/components/traces/shared/format-duration.test.ts`

- [ ] **Step 1: `use-timeline-layout` cases**

- Single-root trace, three spans, depth-ordered emit.
- Multi-root trace (two `parentSpanId === ""` spans) → both subtrees appear in `rows`, ordered by `(timestampNs, spanId)`.
- Orphan-root trace (no `parentSpanId === ""`, all `parentSpanId` reference IDs not in the set) → every orphan span is treated as a root and emitted.
- Collapse: toggling a span hides its descendants from `rows` but not the ancestor row itself.
- Zero-duration span included in `traceEndNs` calculation.
- Sort uses `BigInt(timestampNs)`, not `timestamp` — verify two spans with same string-prefix timestamps but different ns suffixes order correctly.

- [ ] **Step 2: `service-color` stability**

Same `(namespace, name)` returns the same color across many calls. Different services return different palette slots (statistically; verify on a small set of known inputs).

- [ ] **Step 3: `format-duration` boundaries**

`999n` → `999ns`. `1_000n` → `1.0μs`. `999_999n` → `1000.0μs` (or `999.9μs` depending on rounding choice — match the implementation). `1_000_000n` → `1.00ms`. `1_000_000_000n` → `1.00s`. `60_000_000_000n` → `1m 0s`.

### Task 19: Tests — server & component

**Files:**
- Create: `packages/app/src/data/traces/repository.test.ts`
- Create: `packages/app/src/components/traces/trace-results-list.test.tsx`
- Create: `packages/app/src/components/traces/timeline/timeline-view.test.tsx`

- [ ] **Step 1: Repository tests against a seeded ClickHouse**

Match the pattern used by existing data-layer tests (point at the test database, seed with fixtures, assert on returned shapes). One happy path per method; one error path for `getTrace` returning `[]` (caller-side "not found").

- [ ] **Step 2: Component tests with React Testing Library**

- `trace-results-list`: renders N rows from a fixture, duration bars sized correctly, clicking a row navigates (router mock from existing test utilities).
- `timeline-view`: load a fixture of ~10 spans, expand/collapse a subtree, select a span → `SpanDetailPanel` shows the span's attributes.

### Task 20: Smoke check

- [ ] **Step 1: Type + lint**

```bash
pnpm --filter @everr/app typecheck
pnpm --filter @everr/app lint
```

- [ ] **Step 2: Manual smoke test**

Start the web app, sign in, navigate to `/traces`. With recent telemetry in ClickHouse:
- Search defaults (last 1h, no filters) returns rows.
- Click a row → detail page loads, Timeline tab renders span bars, JSON tab shows the raw payload.
- Apply a namespace + service filter → results narrow.
- Apply a `name=...` substring → results match.
- `status=error` filter narrows to traces whose root status is `Error`.
- `minMs` / `maxMs` filters take effect.
- Refresh dropdown set to 15s → list re-runs on interval.
- Deep-link via `/traces?from=now-24h&to=now&service=foo` → URL state restored on reload.
