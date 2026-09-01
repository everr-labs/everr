# ClickHouse retention rollout

Per-tenant retention moved from a `dictGet` expression in each table's TTL to
a `retention_days` column stamped on every row. Tables partition by
`(day, retention_days)`, the TTL is `day + retention_days`, and
`ttl_only_drop_parts = 1` makes ClickHouse drop whole partitions instead of
rewriting parts. A retention change applies to rows ingested after the change;
existing rows keep the retention they were stamped with.

Schema: `clickhouse/init/05-create-retention-function.sql`,
`clickhouse/init/10-create-mvs.sql`, `clickhouse/init/12-create-alert-events.sql`.
Rebuild for existing clusters: `clickhouse/migrations/2026-09-01-retention-days-partitions.sh`.

## Follow-ups in this repo

1. **Settle the retention values.** `everrRetentionDays` accepts
   `7, 14, 30, 90, 365, 395`: the union of the current tiers in
   `packages/app/src/lib/retention.ts` (7/7/14 free, 90/90/395 pro) and the
   proposed 14/30/90 (logs, traces) and 14/30/90/365 (metrics). Once the tiers
   are final, trim the set in `05-create-retention-function.sql` and keep
   `retention.ts` a subset of it. Every value costs that many daily partitions
   per table, so the sum of the set is the partition budget: about 134 per
   logs and traces table and 499 per metrics table with the proposed tiers.
2. **Optional: fold the stamp expression into the UDF.** The eight call sites
   repeat `everrRetentionDays(dictGetOrDefault('app.tenant_retention', '<attr>', <tenant>, toUInt32(<fallback>)))`.
   A two-argument `everrRetentionDays(attribute, tenant_id)` that owns the
   dictionary name and the free-tier fallback removes the repetition. Verify on
   a container that the constant attribute name reaches `dictGetOrDefault` as
   a literal through the lambda substitution before switching.
3. **Optional: shorten `otel.*` retention.** The raw tables keep 7 days with
   their own TTL, and nothing reads them except the views at insert time.
   A shorter window halves the storage of every row. Separate decision.

## Changes in `everr-deploy`

In `infra-v2/clickhouse_dbops.tf`, at any time:

- **Remove** `app_ro_dictget_tenant_retention`. `app_ro` never reads the
  dictionary. `collector_rw` keeps `dictGet` (the views run under its inserts)
  and `web_app_admin` needs it for the `app.alert_events` `DEFAULT`; check
  that the `web_app_admin` grant exists in Terraform, the dev init script
  grants it in `12-create-alert-events.sql`.

A plan change reaches new rows once the dictionary refreshes, within 120 s
(`LIFETIME(MIN 60 MAX 120)`). Rows ingested in that window keep the previous
plan's retention.

Optional, `everr/clickhouse-cloud.yaml`: a retention row. The existing panels
(`MaxPartCountForPartition`, `PartsActive`, `Merge`, `DelayedInserts`,
`TOO_MANY_PARTS` in the error codes) cover part pressure. Nothing shows that
partitions expire on time or how many exist. A `sqlquery` receiver in the
internal collector running the verification query below every few minutes
and emitting `everr.clickhouse.partitions` and
`everr.clickhouse.oldest_partition_age_days` per table and `retention_days`
closes that gap.

## Production rollout

The app needs no change for the rebuild, so the order is: schema, then app
(the app change is the removal of the signup seed only).

1. Run the rebuild from a checkout of the merged commit, with an admin user:

   ```sh
   KEEP_OLD=1 clickhouse/migrations/2026-09-01-retention-days-partitions.sh \
     --host <cloud-host> --secure --user default --password '<ADMIN_PASSWORD>'
   ```

   What it does: drops the materialized views, renames every `app.*` data
   table to `app.<name>_old` in one statement, re-runs `init/05`, `init/10`,
   `init/12` and `init/20`, backfills each table from its `_old` copy with the
   tenant's current retention, and prints the partition and part counts.
   `KEEP_OLD=1` skips the final drop so the copies can be checked first.

   Effects to expect:
   - Rows the collector writes into `otel.*` between the view drop and the
     view recreate (well under a second) are not projected into `app.*`.
     Inserts into `app.alert_events` fail during the rename for the same
     window. Run it while ingestion is low.
   - The backfill stamps rows with the plan the tenant has now. Rows already
     past that retention (a free tenant's rows older than 7 days) are dropped
     by the TTL at insert. That is the one-time rescue of the current plans.
   - `init/10` contains `CREATE DICTIONARY IF NOT EXISTS app.tenant_retention`
     with the dev password. It is a no-op on a cluster where the dictionary
     exists. Do not drop the dictionary before running the script.
   - Row policies and grants are bound to table names, so they stay on
     `app.<name>` and never apply to the `_old` copies. The `_old` copies are
     readable by `app_ro` until dropped.
2. Verify (queries below), then drop the copies:

   ```sql
   DROP TABLE app.traces_old, app.logs_old, app.metrics_gauge_old, app.metrics_sum_old,
     app.metrics_histogram_old, app.metrics_exponential_histogram_old,
     app.metrics_summary_old, app.alert_events_old;
   ```

3. Deploy the app.

## Verification

Partition key and TTL on every table:

```sql
SELECT name, partition_key, engine_full LIKE '%ttl_only_drop_parts = 1%' AS drop_parts
FROM system.tables
WHERE database = 'app' AND engine LIKE '%MergeTree%';
```

Live partitions, parts and rows per table, and the oldest partition per
retention value (the age must never exceed `retention_days` by more than a
day, or a month for `alert_events`):

```sql
SELECT table,
       toUInt16(extract(partition, ',(\\d+)\\)$')) AS retention_days,
       uniq(partition) AS partitions, count() AS parts, sum(rows) AS rows,
       dateDiff('day', min(toDate(extract(partition, '\\d{4}-\\d{2}-\\d{2}'))), today()) AS oldest_days
FROM system.parts
WHERE active AND database = 'app' AND table != 'tenant_retention_source'
GROUP BY table, retention_days
ORDER BY table, retention_days;
```

Rows are stamped with the value the dictionary holds for the tenant:

```sql
SELECT tenant_id, retention_days,
       dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(0)) AS logs_days,
       count()
FROM app.logs
WHERE TimestampTime > now() - INTERVAL 1 HOUR
GROUP BY ALL;
```

Unknown tenants show `logs_days = 0` and `retention_days = 7` (14 for
metrics). Any other mismatch means the dictionary was stale when the rows
arrived.

Part pressure, on the ClickHouse Cloud dashboard: `MaxPartCountForPartition`
under 50 on the hottest day, merge pool not saturated all day, no
`TOO_MANY_PARTS`. Expected steady state with the current tiers: about 97 live
partitions per logs and traces table, about 409 per metrics table, one to
three parts per settled partition.
