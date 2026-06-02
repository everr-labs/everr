## What
The dynamic attribute filters now let users filter logs/errors by `LogAttributes` / `ScopeAttributes` and traces by `SpanAttributes`. On the cloud tables, only `ResourceAttributes` has data-skipping indexes, and none of these map columns are in the `ORDER BY` key. So a log/scope/span attribute filter is a non-order-key, non-indexed predicate that scans every in-window tenant row instead of pruning parts. Common queries over a wide time range can turn into broad scans.

## Where
- `packages/telemetry-explorer/src/traces/sql/attribute-columns.ts` — exposes `SpanAttributes` as a filterable source for `app.traces`.
- `packages/telemetry-explorer/src/logs/sql/attribute-columns.ts` — exposes `LogAttributes` / `ScopeAttributes` as filterable sources for `app.logs`.
- Cloud schema: `app.traces` and `app.logs` (skip indexes currently only on `ResourceAttributes`).

## Steps to reproduce
1. On a tenant with many spans/logs, open trace search (or logs/errors).
2. Add a span attribute filter (e.g. `http.route`) or a log/scope attribute filter over a wide time window.
3. Inspect the ClickHouse query plan / read rows — the map predicate scans the in-window tenant rows rather than pruning via a skip index.

## Expected
Attribute filters on the offered sources prune efficiently, the same way `ResourceAttributes` filters do.

## Actual
`SpanAttributes` (traces) and `LogAttributes` / `ScopeAttributes` (logs) filters scan all in-window tenant rows because no skip index covers them and they are not in the order key.

## Priority
medium

## Notes
- Two options per table: (a) add `bloom_filter` / token skip indexes on the relevant map key+value columns to `app.traces` and `app.logs`, or (b) gate those sources off in the UI until the indexes exist.
- `ResourceAttributes` filters are unaffected — they already have skip indexes.
- Surfaced during review of the traces/errors attribute-filter work (PR #165).
