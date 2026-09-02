# ClickHouse retention rollout

Per-tenant retention moved from a `dictGet` expression in each table's TTL to
a `retention_days` column stamped on every row. Tables partition by
`(day, retention_days)`, the TTL is `day + retention_days`, and
`ttl_only_drop_parts = 1` makes ClickHouse drop whole partitions instead of
rewriting parts. A retention change applies to rows ingested after the change;
existing rows keep the retention they were stamped with.

Schema: `clickhouse/init/10-create-mvs.sql`,
`clickhouse/init/12-create-alert-events.sql`.
Rebuild for existing clusters: `clickhouse/migrations/2026-09-01-retention-days-partitions.sh`.
The rebuild drops the existing `app.*` rows; there is no backfill. The raw
`otel.*` tables are untouched and keep their own 7-day TTL.

## Where the numbers live

The SQL holds no retention values. Each tenant's retention is a row in
`app.tenant_retention_source`, written by the app on every plan change. The
free tier is the row with the empty tenant id: the views and the
`app.alert_events` default fall back to it with
`dictGet('app.tenant_retention', '<signal>_days', '')` for tenants without
a row. The app rewrites that row from `RETENTION_BY_TIER.free` in
`packages/app/src/lib/retention.ts` at every start, so a free-tier change is
one edit there. `init/10` seeds the same row so a fresh cluster ingests before
the app starts; those literals only bootstrap.

The fallback lookup has a constant key, so ClickHouse evaluates it once per
insert block. Measured on the real logs schema with 600k rows, the per-row
dictionary lookup is not distinguishable from a constant stamp; the view's
cost is the second table write and its skip indexes.

## Column codecs

The `app.*` tables are created with `CREATE TABLE ... AS SELECT`, which copies
column types but not codecs, so until this branch every `app.*` column was
plain LZ4 while the raw `otel.*` copy had `Delta, ZSTD(1)` on timestamps and
`ZSTD(1)` elsewhere. Measured on the dev data, the `app.*` copies were 1.5 to 2
times the size of the raw ones for the same rows (traces 549 vs 273 MiB, logs
126 vs 65 MiB). `init/10` now mirrors the codecs with one `MODIFY COLUMN`
block per table after the index block; keep those blocks in step with
`init/03` when the exporter schema changes. The rebuild applies them to
production because it recreates the tables.

## Follow-ups in this repo

1. **Adding a retention value.** `upsertTenantRetention` takes a tier, so the
   only values that reach ClickHouse are those in `RETENTION_BY_TIER`
   (`packages/app/src/lib/retention.ts`): free 14/14/14, pro 30/30/395.
   Every value costs that many daily partitions per table, so the sum of the
   distinct values per signal is the partition budget, 44 per logs and
   traces table and 409 per metrics table. A new tier adds its days to it.
2. **Optional: shorten `otel.*` retention.** The raw tables keep 7 days with
   their own TTL, and nothing reads them except the views at insert time.
   A shorter window halves the storage of every row. Separate decision.

## Changes in `everr-deploy`

In `infra-v2/clickhouse_dbops.tf`, at any time:

- **Remove** `app_ro_dictget_tenant_retention`. `app_ro` never reads the
  dictionary. `collector_rw` keeps `dictGet` (the views run under its inserts)
  and `web_app_admin` needs it for the `app.alert_events` `DEFAULT`; check
  that the `web_app_admin` grant exists in Terraform, the dev init script
  grants it in `12-create-alert-events.sql`.

- **Recreate the dictionary from `init/10`.** Two changes: `traces_days`,
  `logs_days` and `metrics_days` are `UInt16`, and the source query carries
  the `throwIf` guard that refuses to load without the free-tier row. A
  cluster created before this change has neither. `dictGetOrDefault` accepts
  a `UInt16` default against a `UInt32` attribute, so nothing breaks in the
  meantime, but without the guard a deleted free-tier row stamps 0 and
  deletes data silently, so do this before relying on the rebuild.
- **Add a dictionary check to the deploy.** Run
  `SYSTEM RELOAD DICTIONARY app.tenant_retention` after every change to the
  `web_app_admin` credentials or the dictionary definition, and fail the
  deploy if it errors. The views call the dictionary on every insert, so a
  dictionary that cannot load fails the collector's writes into `otel.*`
  (see "Failure modes" below). The dev image loads dictionaries at startup
  (`clickhouse/config.d/dictionaries.xml`) so a broken source shows in the
  server log; ClickHouse Cloud does not expose that setting, which is why
  the deploy check exists.

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

## Plan changes and existing rows

Retention is stamped on a row when it is inserted and `retention_days` is a
partition key column, so it cannot be changed afterwards:
`ALTER TABLE ... UPDATE retention_days` fails with `Cannot UPDATE key column`.
The consequences:

- **Upgrade (free to pro).** Rows ingested before the upgrade keep the
  free-tier retention and expire on that schedule. At most the last 14 days
  are affected. Rows ingested
  after the dictionary refresh get the pro retention.
- **Downgrade (pro to free).** Rows ingested before the downgrade keep the
  pro retention and stay up to 30 days (395 for metrics). Storage for that
  tenant shrinks over the following 30 days, not at once.

This is the accepted behaviour. If a customer needs the pre-upgrade rows
kept, the rescue is one insert-select per signal table that copies the
tenant's rows with the new stamp, followed by a lightweight `DELETE` of the
rows with the old stamp:

```sql
INSERT INTO app.logs SELECT * REPLACE (toUInt16(30) AS retention_days)
FROM app.logs WHERE tenant_id = '<org>' AND retention_days = 14;
DELETE FROM app.logs WHERE tenant_id = '<org>' AND retention_days = 14;
```

It touches at most 14 days of one tenant, so it is cheap, but it is a manual
step and not part of the upgrade flow.

## Failure modes

- **Free-tier row missing.** `dictGet` on a missing key returns 0, not an
  error, and a 0 stamp expires the row at insert with no error anywhere. To
  make that impossible the dictionary's source query refuses to load when the
  empty-tenant row is absent (`throwIf` in `init/10`). A dictionary that never
  loaded makes every view throw, so the collector's insert fails loudly. On a
  cluster where it had loaded before, a failed refresh keeps the last good
  copy, which still holds the row, and `system.dictionaries.last_exception`
  names the problem. `init/10` seeds the row and the app rewrites it at start.
- **Dictionary cannot load.** ClickHouse keeps the last good copy when a
  refresh fails, so a broken source only matters when the dictionary has
  never loaded on this server: after a restart with a rotated
  `web_app_admin` password, or on a fresh cluster. Then `dictGetOrDefault`
  throws inside the views, and the collector's insert into `otel.*` fails
  with it. Ingestion stops until the dictionary loads. Do not set
  `materialized_views_ignore_errors`: it keeps the collector insert alive
  but drops the `app.*` rows silently. The deploy check above is the guard.
- **Dictionary stale.** A plan change written to the source table reaches
  the views within 120 s. Rows in that window carry the previous plan.

## Production rollout

The app needs no change for the rebuild, so the order is: schema, then app
(the app change is the removal of the signup seed only).

1. Run the rebuild from a checkout of the merged commit, with an admin user:

   ```sh
   clickhouse/migrations/2026-09-01-retention-days-partitions.sh \
     --host <cloud-host> --secure --user default --password '<ADMIN_PASSWORD>'
   ```

   What it does: drops the materialized views, drops every `app.*` data
   table, re-runs `init/10`, `init/12` and `init/20` (new partition key,
   codecs, views), reloads the dictionary, and prints the partition key of
   every table.

   Effects to expect:
   - **All `app.*` rows are gone.** Traces, logs, metrics and alert history
     start empty and fill from the collector. The raw `otel.*` tables keep
     their last 7 days but nothing re-projects them into `app.*`. Tell the
     tenants, or run it before the first paying customer.
   - Rows the collector writes into `otel.*` between the view drop and the
     view recreate (well under a second) are not projected into `app.*`.
     Inserts into `app.alert_events` fail in the same window.
   - `init/10` contains `CREATE DICTIONARY IF NOT EXISTS app.tenant_retention`
     with the dev password. It is a no-op on a cluster where the dictionary
     exists. Do not drop the dictionary before running the script.
   - Row policies and grants are bound to table names and are recreated by
     `init/20`; the `app_ro` and `web_app_admin` grants on `app.alert_events`
     come back with `init/12`.
2. Verify with the queries below.
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
       dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt16(0)) AS logs_days,
       count()
FROM app.logs
WHERE TimestampTime > now() - INTERVAL 1 HOUR
GROUP BY ALL;
```

Unknown tenants show `logs_days = 0` and `retention_days` equal to the
free-tier row (`SELECT * FROM app.tenant_retention WHERE tenant_id = ''`).
Any other mismatch means the dictionary was stale when the rows arrived.

Part pressure, on the ClickHouse Cloud dashboard: `MaxPartCountForPartition`
under 50 on the hottest day, merge pool not saturated all day, no
`TOO_MANY_PARTS`. Expected steady state with the current tiers: about 44 live
partitions per logs and traces table, about 409 per metrics table, one to
three parts per settled partition.
