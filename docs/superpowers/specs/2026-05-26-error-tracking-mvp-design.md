# Error Tracking MVP — Design

Date: 2026-05-26
Status: Draft for review

## Summary

Add an app-only `/errors` surface that groups OpenTelemetry exception logs from `app.logs` into issue-like rows and lets engineers inspect recent occurrences with links into the existing trace viewer. This is the first UI/storage slice for error tracking. It deliberately does not create a new ClickHouse table, materialized view, SDK package, source-map pipeline, or resolution workflow.

The MVP reads exception-shaped logs directly from `app.logs`, groups them at query time, and shows the latest occurrence plus a recent occurrence list. The TypeScript client library remains a producer contract for now: it should emit OTel log records that this UI can consume later, but this slice starts from logs already arriving in Everr.

## Goals

- Show grouped error issues in the existing web app without new storage.
- Use OpenTelemetry exception log conventions as the data contract.
- Preserve trace correlation by linking occurrences to `/traces/$traceId` with the focused span.
- Keep the query shape bounded by time range, exception attributes, service filters, and limits.
- Reuse the app's existing dashboard, auth, ClickHouse, URL-state, and component patterns.

## Non-goals

- Dedicated `errors` table, summary table, projection, or materialized view.
- New `@everr/telemetry-explorer/errors` package surface.
- TypeScript SDK implementation.
- Source map upload, symbolication, suspect commits, or stack rewriting.
- Resolve, ignore, assign, comment, notify, or alert workflows.
- User-impact metrics unless a useful user attribute already exists in log/resource attributes.
- Embedded trace timeline inside the error detail page.
- Generic error-level log grouping. The issue list only includes exception-shaped logs.

## References

- OpenTelemetry exception logs: exception events are log records with `exception.type`, `exception.message`, `exception.stacktrace`, and span context when a corresponding operation/span exists.
- OpenTelemetry logs data model: `TraceId` and `SpanId` are top-level log record fields, not attributes, and should correlate logs with request processing when available.
- Grafana Faro: browser error instrumentation captures `window.onerror` and `unhandledrejection`, extracts stack details, and sends structured errors.
- Sentry: issues group similar events and show a latest event, stack, metadata, breadcrumbs/context, and event history. MVP adopts the grouped-events shape, not the workflow features.

## Architecture

```
┌─ packages/app (React, TanStack Router/Query) ──────┐
│  /errors                  grouped issue list       │
│  /errors/$fingerprint     detail + occurrences     │
│                                                    │
│  URL-state: time range, refresh, filters, sort      │
│                                                    │
│  TanStack Query ─► searchErrorIssues() ─┐          │
│                  ─► getErrorIssue() ────┤ server   │
│                  ─► listErrorServices() ┘ fns      │
└─────────────────────────────────────────┬──────────┘
                                          ▼
┌─ packages/app/src/data/errors/server.ts ───────────┐
│  createAuthenticatedServerFn × 3                   │
│  ClickHouse client from requireOrgMiddleware        │
│  Row-level policy scopes tenant access              │
└────────────────────┬───────────────────────────────┘
                     ▼
                 app.logs
```

All code for this slice lives in `packages/app`. The first implementation should not extract reusable package APIs. If errors later need desktop/local reuse, extract after the app-only surface proves the shape.

Tenant scoping remains the existing row-level policy and ClickHouse settings injected by `requireOrgMiddleware`. Queries must not add `tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))`, and must not use `PREWHERE`.

## Routes and URL State

Routes nest under `_authenticated/_dashboard` so they inherit the dashboard shell, time range controls, and refresh behavior.

```
packages/app/src/routes/_authenticated/_dashboard/errors.tsx
packages/app/src/routes/_authenticated/_dashboard/errors/$fingerprint.tsx
```

List-page search params:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `from` | datemath | `now-1h` | Existing `TimeRangeSearchSchema`. |
| `to` | datemath | `now` | Existing `TimeRangeSearchSchema`. |
| `refresh` | refresh interval | `off` | Existing dashboard refresh. |
| `q` | string | `""` | Searches type/message. |
| `service` | string[] | `[]` | Filters `ServiceName`. |
| `fingerprint` | string | `""` | Exact debug/share filter. |
| `sort` | `lastSeen | count` | `lastSeen` | Controls issue ordering. |
| `limit` | number | `50` | Max 500. |

Detail-page search params:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `from` | datemath | inherited | Keeps detail scoped to the selected window. |
| `to` | datemath | inherited | Keeps detail scoped to the selected window. |
| `refresh` | refresh interval | inherited | Detail can refresh with the list. |
| `service` | string[] | inherited | Preserved for back navigation and detail filtering. |
| `q` | string | inherited | Preserved for back navigation. |
| `sort` | `lastSeen | count` | inherited | Preserved for back navigation. |
| `limit` | number | inherited | Preserved for back navigation. |

## Error Log Contract

The issue list includes only logs that look like OpenTelemetry exception events:

```sql
SeverityNumber >= 17
AND (
  LogAttributes['exception.type'] != ''
  OR LogAttributes['exception.message'] != ''
)
```

Expected fields:

| Source | Field | Use |
| --- | --- | --- |
| log column | `Timestamp` | first/last seen, occurrence time, trace-link window |
| log column | `TraceId` | trace pivot |
| log column | `SpanId` | focused span pivot |
| log column | `ServiceName` | issue grouping fallback and filtering |
| log column | `Body` | fallback display message |
| log attr | `exception.type` | primary type |
| log attr | `exception.message` | primary message |
| log attr | `exception.stacktrace` | detail stack display and optional grouping input |
| log attr | `exception.escaped` | detail context only |
| log attr | `error.fingerprint` | user-supplied grouping override |
| resource attr | `service.namespace` | display context only in MVP |
| resource/log/scope attrs | any | detail metadata display |

The later TypeScript SDK should emit this contract through OTel logs and attach the current active span context. For browser/runtime errors, it should follow the same shape as existing app telemetry: global handlers, unhandled promise rejection capture, stack capture, secret redaction, and explicit flush for fatal paths.

## Fingerprinting

Issue fingerprinting is deterministic and query-time only.

1. If `LogAttributes['error.fingerprint']` is present, use it exactly.
2. Otherwise compute a fallback from:
   - `ServiceName`
   - `LogAttributes['exception.type']`
   - normalized `LogAttributes['exception.message']`
   - optional top application frame from `exception.stacktrace`
3. MVP may set the frame component to `''` and group by service/type/message only. Stack-frame parsing can be added later if real data shows message-only grouping is too broad. The detail view must still show the full stack.

Normalization:

- Lowercase surrounding whitespace only by trimming; do not lowercase messages.
- Replace long decimal/hex tokens, UUIDs, and quoted IDs with placeholders.
- Limit the normalized message used for hashing to a bounded length.
- Keep the original message for display.

The query should return a string fingerprint, for example `toString(cityHash64(...))`, so it is URL-safe and stable across the selected time window.

## Server Functions

All server functions live in `packages/app/src/data/errors/server.ts` and use `createAuthenticatedServerFn`.

### `searchErrorIssues(input) -> ErrorIssueSummary[]`

Returns grouped issue rows for the selected window.

```sql
WITH exception_logs AS (
  SELECT
    Timestamp,
    ServiceName,
    TraceId,
    SpanId,
    Body,
    LogAttributes,
    ResourceAttributes,
    if(
      LogAttributes['error.fingerprint'] != '',
      LogAttributes['error.fingerprint'],
      toString(cityHash64(
        ServiceName,
        LogAttributes['exception.type'],
        <normalized exception.message>,
        ''
      ))
    ) AS fingerprint
  FROM app.logs
  WHERE TimestampTime BETWEEN toDateTime(parseDateTime64BestEffort({fromTs:String}, 9))
                          AND toDateTime(parseDateTime64BestEffort({toTs:String}, 9))
    AND Timestamp BETWEEN parseDateTime64BestEffort({fromTs:String}, 9)
                      AND parseDateTime64BestEffort({toTs:String}, 9)
    AND SeverityNumber >= 17
    AND (
      LogAttributes['exception.type'] != ''
      OR LogAttributes['exception.message'] != ''
    )
    <optional service filter>
    <optional q filter>
    <optional fingerprint filter>
)
SELECT
  fingerprint,
  argMax(LogAttributes['exception.type'], Timestamp) AS exceptionType,
  argMax(LogAttributes['exception.message'], Timestamp) AS exceptionMessage,
  argMax(Body, Timestamp) AS body,
  argMax(ServiceName, Timestamp) AS latestServiceName,
  groupUniqArray(ServiceName) AS services,
  count() AS occurrenceCount,
  uniqExactIf(TraceId, TraceId != '') AS traceCount,
  min(Timestamp) AS firstSeen,
  max(Timestamp) AS lastSeen,
  argMax(TraceId, Timestamp) AS latestTraceId,
  argMax(SpanId, Timestamp) AS latestSpanId,
  argMax(toString(Timestamp), Timestamp) AS latestTimestamp
FROM exception_logs
GROUP BY fingerprint
ORDER BY <lastSeen_or_count> DESC
LIMIT {limit:UInt32}
```

The `TimestampTime` predicate aligns with the current `app.logs` order key so ClickHouse can prune better than a bare `Timestamp` predicate. Keep both predicates because display and equality logic still use the full `DateTime64(9)` timestamp.

### `getErrorIssue(input) -> ErrorIssueDetail`

Receives `fingerprint`, resolved time window, optional service filters, and an occurrence limit. It runs the same exception-log CTE and returns:

- the summary for the selected fingerprint
- the latest occurrence
- recent occurrences ordered by `Timestamp DESC`

Occurrence rows include timestamp, service, trace/span IDs, body, exception type/message/stacktrace, resource attributes, log attributes, and scope attributes.

### `listErrorServices(input) -> string[]`

Returns distinct services with exception-shaped logs in the selected window. This populates the service filter.

## DTOs

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

## UI Structure

```
packages/app/src/
├── routes/_authenticated/_dashboard/
│   ├── errors.tsx
│   └── errors/
│       └── $fingerprint.tsx
├── data/errors/
│   ├── options.ts
│   ├── schemas.ts
│   └── server.ts
└── components/errors/
    ├── error-filters.tsx
    ├── error-issue-list.tsx
    ├── error-issue-row.tsx
    ├── error-detail-header.tsx
    ├── error-latest-occurrence.tsx
    ├── error-stacktrace.tsx
    ├── error-occurrences-list.tsx
    └── trace-link.tsx
```

### `/errors`

- Full-bleed dashboard page matching Logs and Traces.
- Search input for message/type.
- Service filter.
- Sort segmented control: Last seen, Count.
- Issue list ordered by last seen by default.
- Rows show severity, type, message, services, occurrence count, trace count, first seen, and last seen.
- Empty state: no exception logs in the current window, with actions to clear filters or widen the window.
- Query error state: inline retry.

### `/errors/$fingerprint`

- Header: back button, type/message, occurrence count, last seen.
- Latest occurrence panel: service, timestamp, trace/span IDs, message, and metadata.
- Stack section: `exception.stacktrace` in monospace with copy button.
- Occurrences list: recent events with service, timestamp, message, and trace action.
- Missing stack: show type/message/attributes without placeholder stack text.
- Missing issue in current window: not-found empty state with link back to `/errors`.

### Trace links

Each occurrence with a non-empty `TraceId` renders an `Open trace` action:

```
/traces/$traceId?span=<spanId>&start=<timestamp-minus-buffer>&end=<timestamp-plus-buffer>
```

Use a small buffer around the occurrence timestamp, such as five minutes on either side, unless the existing trace detail route requires a different window shape. Preserve current list filters when navigating back to errors.

## Data Flow

1. User opens `/errors`.
2. URL state validates with zod; datemath resolves before calling server functions.
3. `searchErrorIssues` groups matching exception logs from `app.logs`.
4. Clicking a row navigates to `/errors/$fingerprint` with current search params preserved.
5. `getErrorIssue` reruns the same fingerprint expression and fetches latest + recent occurrences.
6. Clicking `Open trace` navigates to the existing trace detail page with `traceId`, `span`, and a narrow time window.

## ClickHouse Design Notes

Rules applied:

- Per `schema-pk-plan-before-creation`, this MVP avoids creating a new table while query patterns are still uncertain.
- Per `schema-pk-filter-on-orderby`, queries should include `TimestampTime` and service filters where possible because `app.logs` is ordered by `(tenant_id, ServiceName, TimestampTime, Timestamp)`.
- Per `query-index-skipping-indices`, exact `TraceId` and map-attribute filters rely on skipping indices only when the data layout helps; the MVP should not assume these are free.
- Per `query-mv-incremental`, if grouped issue queries become hot, an incremental MV or summary table is the likely next step. It is intentionally out of MVP.

Known tradeoffs:

- Query-time grouping scans matching exception logs in the selected window.
- `LogAttributes[...]` map lookups are flexible but not as cheap as typed columns.
- SQL stack parsing may be brittle. Message/type grouping is acceptable for the first ship if stack-frame extraction slows implementation or query performance.
- Without persistent issue state, fingerprints have no lifecycle, resolution state, or lifetime counters outside the selected time range.

## Error Handling

| Case | Behavior |
| --- | --- |
| ClickHouse failure | Inline error state with retry. |
| No matching issues | Empty state with clear/widen actions. |
| Detail fingerprint absent | Not-found state scoped to current window. |
| Missing trace ID | Hide trace action, keep occurrence visible. |
| Missing stacktrace | Show metadata and message; omit stack frame UI. |
| Malformed attributes | Treat missing map keys as empty strings. |

## Testing

### Server tests

- Validate generated SQL contains no `PREWHERE`.
- Validate generated SQL contains no explicit tenant predicate.
- Validate exception filter uses `exception.type` or `exception.message`.
- Validate service, query, fingerprint, sort, and limit inputs change SQL/params as expected.
- Validate detail query reuses the same fingerprint expression as list query.
- Map representative ClickHouse rows into DTOs.

### UI tests

- `/errors` renders rows, empty state, and query failure state.
- Filters update URL state.
- Sort control updates URL state and query input.
- Row click preserves filters and navigates to detail.
- Detail page renders latest occurrence, stack, attributes, occurrences, and trace link.
- Missing stack and missing trace ID states do not produce broken controls.

### Out of scope

- E2E tests across `/errors` and `/traces`.
- Load testing large exception windows.
- Source map or stack-frame normalization tests beyond the small SQL/utility cases needed for grouping.

## Later Work

- TypeScript SDK that emits the documented OTel exception log contract.
- Browser breadcrumbs using logs or structured attributes.
- Derived ClickHouse issue summary table/MV.
- Persistent issue state: resolved, ignored, assigned, linked ticket, comments.
- Source map ingestion and stack symbolication.
- User/session impact metrics.
- Embedded trace panel.
- Alerting and regression detection.
