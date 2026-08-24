# Usage Metering Tasks

1. [x] Persist exact subscription period bounds. Add nullable
   `currentPeriodStart` to the Drizzle subscription schema, carry it through
   the Polar webhook payload and staleness-guarded upsert, expose it through the
   shared `OrgEntitlement` type, and remove the route-local duplicate type.
   (Design: Subscription period, Data Models)

2. [x] Implement pure usage policy helpers. Add the signal union, decimal
   `BYTES_PER_GB`, Free and Pro per-signal allowances, Pro overage calculation,
   billing-consistent formatting, and exact subscription or UTC calendar-month
   period resolution. Add unit tests for status handling, missing bounds,
   month boundaries, allowances, and overage thresholds.
   (Design: Subscription period, App read path)

3. [x] Add the canonical ClickHouse row-size definitions. Update the landing
   schema coupling comment and add all seven idempotent `RowBytes UInt64
   MATERIALIZED byteSize(...)` alterations with every physical column and
   expanded nested subcolumn.
   (Design: ClickHouse landing tables)

4. [x] Add the ClickHouse usage ledger and producers. Create
   `app.tenant_usage` with monthly partitions and
   `ORDER BY (tenant_id, bucket, meter)`, add grants and the `app_ro` row
   policy, and create seven UTC arrival-time incremental materialized views
   mapping traces, logs, and all metric tables to the three meters.
   (Design: Usage ledger and materialized views, Data Models)

5. [x] Add the repeatable cloud schema apply SQL containing the same column,
   table, grant, policy, and materialized-view definitions as fresh init while
   keeping additive backfill statements out of the file.
   (Design: ClickHouse landing tables, Documentation and rollout)

6. [x] Add executable ClickHouse integration coverage using a disposable 26.2
   instance. Insert all seven source shapes and assert each stored `RowBytes`
   value against the inline expression, ledger byte and item totals, UTC
   bucketing, existing fan-out behavior, unattributed traffic isolation,
   admin visibility, DDL rerun safety, and a golden `byteSize` contract value.
   (Design: Testing Strategy, ClickHouse integration)

7. [x] Implement authenticated usage server functions. Validate half-open
   period inputs, query the tenant-scoped `app.tenant_usage` table without a
   manual tenant predicate, re-sum ledger rows, group series dates in UTC,
   normalize ClickHouse numeric strings, order results deterministically, and
   ignore unknown meters in the initial presentation. Add server-function
   tests for SQL shape, parameters, normalization, and isolation behavior.
   (Design: App read path)

8. [x] Implement the billing usage presentation outside the route directory.
   Add the three signal cards, Pro overage display, fixed-color daily bar chart,
   period label, decimal usage formatting, daily pivot and zero filling, and
   loading, error, empty, and partial-data states. Add pure chart-model and
   focused component tests.
   (Design: Billing UI)

9. [x] Wire usage into the existing billing route. Resolve stable period bounds
   from the shared entitlement, key total and series queries by organization
   plus bounds, render the usage section for both plan branches, and preserve
   the existing admin and owner authorization boundary.
   (Design: Subscription period, Billing UI)

10. [x] Harden reviewed time and rendering boundaries. Bind usage ranges as ISO
    strings parsed by ClickHouse, resolve calendar fallback from trusted server
    time, reject stale subscription periods, format fractional chart ticks, and
    keep totals and chart failure states independent. Add regression tests for
    every corrected boundary.
    (Design: Subscription period, App read path, Billing UI)

11. [x] Harden repeat rollout behavior. Atomically replace the tenant row
    policy, converge stale `RowBytes` expressions for subsequent inserts, add
    executable target preflight and validation, and exercise a genuine
    existing-cluster upgrade plus populated repeat apply in Docker.
    (Design: ClickHouse landing tables, Documentation and rollout, Testing
    Strategy)

12. [x] Add a focused ClickHouse CI workflow that runs the behavioral usage
    metering harness whenever the ClickHouse implementation or workflow
    changes.
    (Design: Testing Strategy)
