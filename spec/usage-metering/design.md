# Usage Metering Design

Status: approved on 2026-08-21

This document records the approved version of the design originally drafted in
`docs/superpowers/specs/2026-08-20-usage-metering-design.md`, including the
decisions made during repository review.

## Overview

Everr will meter telemetry ingestion per organization and signal. ClickHouse
will calculate a deterministic byte count for every raw telemetry row, then
incrementally aggregate byte and item counts into hourly usage buckets. The app
will show the current billing period on the existing admin-only billing page.

The first meters are `traces`, `logs`, and `metrics`. All five OpenTelemetry
metric landing tables contribute to the single `metrics` meter. Platform rows
created directly in `app.*` are not billable.

The billable unit is the result of ClickHouse `byteSize(...)` over every
physical source column, excluding the metering column itself. Pricing uses
decimal gigabytes, where one GB is exactly `1_000_000_000` bytes.

Usage buckets use UTC arrival time. Existing telemetry is not automatically
backfilled. Any historical backfill is an explicit, opt-in operation outside
the canonical migration.

## Architecture / Components

### ClickHouse landing tables

`clickhouse/init/03-create-otel-tables.sql` remains the source schema. A
coupling comment points schema editors to the usage definition so newly added
physical columns are deliberately added to billing.

`clickhouse/init/13-create-usage-metering.sql` adds a stored materialized
`RowBytes UInt64` column to each of the seven `otel.*` landing tables. Each
expression lists all physical source columns explicitly, with `Nested` columns
expanded to their physical subcolumns.

Example:

```sql
ALTER TABLE otel.otel_logs
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    Timestamp, TimestampTime, TraceId, SpanId, TraceFlags,
    SeverityText, SeverityNumber, ServiceName, Body,
    ResourceSchemaUrl, ResourceAttributes,
    ScopeSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes,
    LogAttributes, EventName
  );
```

The same file is the single production migration source. Operators execute it
through ClickHouse Console or Terraform. Each `ADD COLUMN IF NOT EXISTS` is
followed by a `MODIFY COLUMN` with the canonical expression so existing
clusters converge when a landing-table schema changes. The modify affects
subsequent inserts and does not rewrite historical parts. The migration does
not contain additive backfill inserts.

### Usage ledger and materialized views

The aggregate ledger is an argument-less `SummingMergeTree`:

```sql
CREATE TABLE IF NOT EXISTS app.tenant_usage
(
  tenant_id String,
  meter LowCardinality(String),
  bucket DateTime('UTC'),
  bytes UInt64,
  items UInt64
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (tenant_id, bucket, meter);
```

The key follows the dominant read pattern: tenant equality supplied by row
policy, then a billing-period range. It is intentionally tenant-first even
though tenant ids have higher cardinality than meters.

Seven incremental materialized views aggregate each inserted source block. A
representative view is:

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_logs_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'logs' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_logs
GROUP BY tenant_id, meter, bucket;
```

Rows without `everr.tenant.id` aggregate under `tenant_id = ''`. The
`app_ro` row policy makes those rows invisible to organizations, while
`web_app_admin` can inspect them. The ledger has no TTL and is not granted to
the SQL API role. Repeat applies replace the row policy atomically with
`CREATE ROW POLICY OR REPLACE`, so tenant isolation is never removed between
DDL statements.

All ledger readers aggregate again with `sum(...) GROUP BY ...` because
`SummingMergeTree` background merges are asynchronous.

### Subscription period

`org_subscription` gains nullable `currentPeriodStart`. The Polar webhook
already supplies this value, so it is persisted together with
`currentPeriodEnd` and exposed in `OrgEntitlement`. No migration is generated
while the schema is being iterated.

An active or trialing Pro subscription uses its exact half-open interval
`[currentPeriodStart, currentPeriodEnd)` when trusted server time is inside
that interval. If the subscription is inactive, either timestamp is missing,
or the stored period does not contain server time, usage uses the current UTC
calendar month. Free organizations always use the UTC calendar month.

### App read path

`packages/app/src/data/usage.ts` exposes authenticated server functions with a
validated half-open time range:

```sql
SELECT meter, sum(bytes) AS bytes, sum(items) AS items
FROM app.tenant_usage
WHERE bucket >= toStartOfHour(
  parseDateTimeBestEffort({from:String}),
  'UTC'
)
  AND bucket < toStartOfHour(
    parseDateTimeBestEffort({to:String}),
    'UTC'
  )
GROUP BY meter
ORDER BY meter
```

The app passes validated ISO strings and ClickHouse parses them before
flooring. This preserves fractional Polar timestamps without binding a
JavaScript `Date` to a `DateTime` parameter. Both bounds are floored to UTC
hours because the ledger's finest resolution is one hour. Exact Polar bounds
remain persisted and displayed. Monthly billing anchors normally share the
same minute and second, so flooring both preserves the period duration without
dropping the first bucket.

The daily series groups with `toDate(bucket, 'UTC')` and orders by date and
meter. Both functions use the tenant-scoped ClickHouse client from server
function context. They do not add a manual `tenant_id` predicate. ClickHouse
`UInt64` strings are normalized before returning data to the UI, and unknown
future meter values are ignored by the initial three-signal presentation.

`packages/app/src/lib/usage-limits.ts` owns the meter types, decimal GB
conversion, per-signal limits, and Pro overage math. Free includes 5 GB per
signal. Pro includes 100 GB per signal and charges $0.40 per additional GB.

### Billing UI

The existing billing page remains limited to organization admins and owners.
It resolves the period from the entitlement, fetches totals and daily data,
and renders usage for both Free and Pro plans outside the existing plan branch.

The section contains three signal cards and a fixed-color daily bar chart.
Cards show bytes used, allowance, item count, and utilization. Pro cards also
show per-signal overage bytes and estimated overage cost. The chart model fills
missing UTC dates with zeroes and handles unknown future meters without
failing.

Supporting components live outside the route directory so TanStack Router does
not treat them as routes.

### Deployment

Pricing documentation defines the byte-based billable unit and uses the same
signal-specific retention values as `packages/app/src/lib/retention.ts`.

Production deployment applies `clickhouse/init/13-create-usage-metering.sql`
through ClickHouse Console or Terraform. Developer machines do not connect
directly to the production database. Infrastructure configuration owns the
collector settings required for billing correctness: `async_insert=1`,
`wait_for_async_insert=1`, `materialized_views_ignore_errors=0`,
`deduplicate_blocks_in_dependent_materialized_views=1`, and
`asterisk_include_materialized_columns=0`.

Historical backfill is optional and uses a separately controlled procedure so
retries cannot double-count live usage in the cutover partition.

Before the app is deployed, the normal release process must generate and apply
the PostgreSQL migration for `current_period_start`. Existing active or
trialing rows with a null start then require an operator-controlled,
idempotent Polar reconciliation keyed by `polar_subscription_id`. The operator
must verify the fetched customer's external id matches `org_id`, reject data
older than `polar_modified_at`, update only rows whose start is still null, and
confirm no qualifying null rows remain. Replaying an equal-timestamp webhook
is not sufficient because the webhook upsert deliberately accepts only a
strictly newer `polar_modified_at`.

## Data Models

```ts
export type UsageMeter = "traces" | "logs" | "metrics";

export type UsageTotal = {
  meter: UsageMeter;
  bytes: number;
  items: number;
};

export type UsageSeriesPoint = UsageTotal & {
  date: string;
};

export type UsagePeriod = {
  from: Date;
  to: Date;
};
```

```ts
export type OrgEntitlement = {
  tier: "free" | "pro";
  status: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};
```

The usage ledger is append-only and additive. Its logical row identity is
`(tenant_id, bucket, meter)`. Application queries must not depend on physical
row collapse.

## Testing Strategy

### ClickHouse integration

Run the schema against a disposable ClickHouse 26.2 instance, insert uniquely
tagged rows into all seven landing tables, and compare before-and-after deltas
inside one UTC arrival hour.

Representative assertions:

```sql
SELECT
  sum(RowBytes) = sum(byteSize(
    Timestamp, TimestampTime, TraceId, SpanId, TraceFlags,
    SeverityText, SeverityNumber, ServiceName, Body,
    ResourceSchemaUrl, ResourceAttributes,
    ScopeSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes,
    LogAttributes, EventName
  )) AS row_bytes_match
FROM otel.otel_logs
WHERE ResourceAttributes['test.run_id'] = {run_id:String};
```

```sql
SELECT sum(bytes), sum(items)
FROM app.tenant_usage
WHERE tenant_id = {tenant_id:String}
  AND meter = 'logs'
  AND bucket >= {from:DateTime}
  AND bucket < {to:DateTime};
```

The integration check also proves that existing fan-out views still work,
materialized columns are visible to metering views, unattributed rows are
hidden by RLS, admin reads are cross-tenant, and rerunning the DDL is safe.
Record a golden `byteSize` result so ClickHouse upgrades cannot silently change
the pricing contract. Verify cloud ClickHouse is at least 26.1 because the
collector uses asynchronous inserts and dependent-view deduplication is part
of billing correctness. The harness starts from the pre-feature schema, proves
that a stale materialized expression converges for future inserts, and repeats
the canonical migration after attributed and unattributed rows exist. A focused
CI workflow runs this behavioral harness for every `clickhouse/**` change.

### App tests

Vitest tests cover exact subscription bounds, UTC calendar fallback, decimal
limits, overage thresholds, ClickHouse query contracts, string-to-number
normalization, daily pivoting and zero filling, unknown meters, and Free and Pro
rendering states.

### Manual validation

After automated checks, exercise traces, logs, and metrics through a valid
local collector configuration and query fresh metering rows through Everr.
Authenticated billing-page validation uses `.auth` credentials when available;
it is skipped when `.auth` is absent.
