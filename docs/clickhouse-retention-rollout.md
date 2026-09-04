# ClickHouse retention rollout

Per-tenant retention moved from a `dictGet` expression in each table's TTL to
a `retention_days` column stamped on every row. Tables partition by
`(day, retention_days)`, the TTL is `day + retention_days`, and
`ttl_only_drop_parts = 1` makes ClickHouse drop whole partitions instead of
rewriting parts. A retention change applies to rows ingested after the change;
existing rows keep the retention they were stamped with.

The stamp comes from the collector. The app returns the tenant's retention when
it authenticates an API key (`/api/internal/verify-key`) or forwards a GitHub
webhook, the collector puts it on every resource as `everr.retention.days`,
and the materialized views read it, write `retention_days`, and strip the key
before storage. One key, not one per signal: each pipeline stamps the window
for the signal it carries, so a span never carries the logs window. The `otel.*` tables are
`ENGINE = Null`: an insert stores nothing and only triggers the views, so every
row is written and merged once.

Schema: `clickhouse/init/03-create-otel-tables.sql`,
`clickhouse/init/10-create-mvs.sql`,
`clickhouse/init/12-create-alert-events.sql`.
Cut-over for existing clusters: `clickhouse/migrations/2026-09-03-direct-ingest.sh`.

## Where the numbers live

The SQL holds no retention values and ClickHouse holds no per-tenant state.
`RETENTION_BY_TIER` in `packages/app/src/lib/retention.ts` is the only source:
free 14/14/14, pro 30/30/395. `retentionForOrg`
(`packages/app/src/lib/retention.server.ts`) reads the organization's tier and
resolves it, and three callers hand the result to the pipeline:

- `/api/internal/verify-key` returns `logsDays`, `tracesDays` and
  `metricsDays` with the tenant id. The `everr_apikey` extension refuses to
  authenticate a response without them, so a key can never ingest unstamped.
- The GitHub webhook forwarder sets `x-everr-retention-<signal>-days` next to
  `x-everr-tenant-id` on every replay.
- Alert history inserts stamp `retention_days` on each row from the tenant's
  logs retention.

There is no dictionary, no free-tier row and no reconciliation: nothing can
drift because nothing is stored.

A plan change reaches new rows once the collector's auth cache expires,
`cache_ttl` in the `everr_apikey` extension, 30 s by default. Webhooks read the
plan on every forward.

## Column codecs

The `app.*` tables are created with `CREATE TABLE ... AS SELECT`, which copies
column types but not codecs, so until this branch every `app.*` column was
plain LZ4 while the raw `otel.*` copy had `Delta, ZSTD(1)` on timestamps and
`ZSTD(1)` elsewhere. Measured on the dev data, the `app.*` copies were 1.5 to 2
times the size of the raw ones for the same rows (traces 549 vs 273 MiB, logs
126 vs 65 MiB). `init/10` now mirrors the codecs with one `MODIFY COLUMN`
block per table after the index block; keep those blocks in step with
`init/03` when the exporter schema changes. Production got them from the
rebuild that recreated the tables, one release before this one.

## Parts per insert

A collector block splits into one part per partition it touches, so each
`app.*` table now writes one part per retention value present in the block
instead of one per day. With two tiers that is two parts per insert per table,
and the merge pool has twice as many small parts to fold. What does not
change is the per-partition insert rate: each partition still receives one
part per block, and `parts_to_throw_insert` (`TOO_MANY_PARTS`) is enforced per
partition. Measured with merges stopped and the threshold lowered to 40,
writing logs, traces and gauge concurrently: the error fires after 40 inserts
per table with one tier and after 40 inserts per table with two tiers, with
40 parts in each `(day, retention)` partition both times. With merges running
at default thresholds and collector-sized batches (8192 rows, two inserters
per table, 9.8M rows across logs, traces and gauge): one tier finished in
51 s, two tiers in 64 s, both with zero rejected or delayed inserts and a peak
of 14 active parts in any partition. The second tier doubled the parts
written, raised write amplification from about 2.8x to 3.8x on logs (smaller
parts are merged more times and compress worse), and doubled the bytes and
CPU spent merging. Adding a tier adds merge work in proportion, and total
active parts (`PartsActive` and the merge pool on the dashboard), not insert
rejections. Larger collector batches (`send_batch_size`) are the lever that
reduces it, since parts per partition per insert is what drives the cost.

Over the whole life of a row the new layout does less merge work than the old
one, because the old one paid at expiry. Measured with one day compressed to
six seconds so that rows are inserted fresh, merged, and then expire during
the run (two tenants, 14 and 30 days, mixed in every batch, 960k rows): the
old layout (day partition, row TTL, no `ttl_only_drop_parts`) ran 139 TTL
delete merges that read 613 MiB and wrote 42 MiB to remove the 14-day rows
from parts that also held the 30-day rows, 3.4x write amplification overall.
The new layout ran 70 TTL drops that wrote 29 KiB, 0.6x amplification, and
half the merge CPU, with twice the regular merges from the split partitions.
Expiry by drop is what makes the per-tier partition pay for itself.

Since the landing tables became `Null`, the stored `otel.*` copy is gone, so
every row is written and merged once instead of twice.

Batching moved from the standalone `batch` processor into the exporter's
`sending_queue.batch`, which is what the exporter documents. Both are set to
8192 rows, but the processor's own timeout fires first at any realistic rate
and it batches per pipeline, so the inserts it produced were much smaller than
the setting. Measured on one logs stream, 20 s at 4000 records per second per
worker with four workers, about 315k rows either way: the processor wrote 101
parts averaging 3133 rows; the exporter queue wrote 38 parts averaging 8200.
Fewer, larger inserts is the same lever as `send_batch_size` and it applies to
every retention value in the batch. The queue also holds the request until the
insert succeeds, so a failed insert or a restart no longer loses it, which the
processor could not offer because it acknowledges data before the write.
`flush_timeout` (5 s) is the ingestion delay when traffic is too low to fill a
batch; lower it to trade parts for freshness.

## Metrics sort key

The five `app.metrics_*` tables order by
`(tenant_id, ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)`,
which is the upstream exporter's key since v0.160.0 with `tenant_id` kept in
front for the row policy. `TimeUnix` and `StartTimeUnix` are `DateTime`, not
`DateTime64(9)`, and a `minmax` index on `TimeUnix` sits with the skip indexes.

Every dashboard panel filters `ServiceName` + `MetricName` + a time range and
aggregates across series. With the attributes ahead of the time column, every
granule of a metric held points from the whole day, so the time filter pruned
nothing and a 15-minute panel read as much as a 24-hour one. Measured on 864k
rows, one metric, 100 series, a day at 10 s, in one merged part, reading a
15-minute window:

| | rows read | bytes read |
|---|---|---|
| old key | 864,000 (the whole day) | 30.67 MiB |
| old key plus the minmax index | 860,160 | 30.48 MiB |
| new key without the index | 342,613 | 2.90 MiB |
| new key with the index | 40,960 | 1.91 MiB |

Both parts are needed. The index alone does nothing, because under the old key
every granule spanned the whole day and its min and max could never exclude
one. The key alone prunes to about an hour; the index prunes inside it.

`cityHash64(Attributes)` groups without ordering. Rows of one series share a
hash, so they stay adjacent inside the hour bucket and the `Attributes` column
still compresses by run, while the primary index (held in memory) stores 8
bytes per granule instead of a whole map: 59 bytes per mark against 178.
Dropping the attributes out of the key instead costs more than it saves, that
column going from 378 KiB to 848 KiB where the hash holds it at 492 KiB.

What it costs: an attribute predicate can no longer prune granules, so reading
one high-cardinality series over a long range reads 820k rows where the old key
read 326k. No built-in dashboard does that; all 232 metric reads aggregate
across series.

The cut-over rebuilds these tables rather than altering them: a sort key
cannot be rewritten, and `TimeUnix` cannot change type while the old key uses
it. See "Production rollout".

`DateTime` instead of `DateTime64(9)` drops sub-second precision that nothing
reads: every query buckets with `toStartOfInterval`. On the same data the
column falls from 4.66 MiB to 1.76 MiB from the type alone, and to 135 KiB once
the new key makes it near-monotonic. `parseDateTimeBestEffort` replaces
`parseDateTime64BestEffort` for the metrics window in
`packages/app/src/data/dashboards/built-in/capabilities.ts`; all three bound
forms the app uses prune identically, this one just matches the column.

## Follow-ups in this repo

1. **Adding a retention value.** `retentionForOrg` resolves a tier, so the only
   values that reach ClickHouse are those in `RETENTION_BY_TIER`
   (`packages/app/src/lib/retention.ts`): free 14/14/14, pro 30/30/395.
   Every value costs that many daily partitions per table, so the sum of the
   distinct values per signal is the partition budget, 44 per logs and
   traces table and 409 per metrics table. A new tier adds its days to it.

## Changes in `everr-deploy`

In `infra-v2/clickhouse_dbops.tf`:

- **Remove** `app_ro_dictget_tenant_retention` and every other `dictGet` grant.
  There is no dictionary any more.
- **Remove** the `app.tenant_retention` dictionary and the
  `app.tenant_retention_source` table with their grants. The cut-over script
  drops both; Terraform only needs to stop declaring them.
- **Remove** `dictionaries_lazy_load` if it was added. Nothing loads a
  dictionary at startup.
- `collector_rw` keeps its `otel.*` grant. It still inserts there; the tables
  only stopped storing.
- The exporter config keeps its table names and database. Only the processors
  change (`collector/config.example.yml`).

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
  are affected. Rows ingested after the collector's auth cache expires get the
  pro retention.
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

Every path that produces the stamp fails closed:

- **verify-key without retention.** The `everr_apikey` extension rejects a
  response that carries no `logsDays`, `tracesDays` and `metricsDays`, so an
  app older than this change cannot make the collector ingest unstamped rows.
  Clients get 401 until the app is deployed.
- **Resource without the attribute.** The view refuses the row with
  `everr.retention.days resource attribute missing` instead of
  stamping 0, which would expire it at insert with no error anywhere. The
  exporter's insert fails and it retries. Do not set
  `materialized_views_ignore_errors`: it keeps the collector insert alive but
  drops the `app.*` rows silently.
- **Plan lookup unavailable.** `retentionForOrg` reads Postgres, so an
  unreachable database fails verify-key. The extension serves its last good
  answer for a grace window (`cache_ttl`) and rejects after that. Ingestion
  stops rather than storing a wrong window.
- **Stale auth cache.** A plan change reaches new rows once the entry expires,
  30 s by default. Rows in that window carry the previous plan.

## Production rollout

Three ordered steps. The app first, because the collector refuses to
authenticate against an app that does not return retention; the script last,
because a new view needs the attributes to already be on the wire.

1. **Deploy the app.** verify-key returns retention, the webhook forwarder
   sends the headers, alert inserts stamp `retention_days`, and the
   dictionary write path is gone. The old dictionary still stamps rows in the
   meantime, so nothing changes for ingestion yet.
2. **Deploy the collector.** It stamps `everr.retention.days` on every resource.
   The old views ignore the attributes and keep reading the dictionary, and
   the attributes are stored in `ResourceAttributes` until step 3 strips them.
3. **Run the cut-over**, from a checkout of the merged commit, as an admin
   user:

   ```sh
   clickhouse/migrations/2026-09-03-direct-ingest.sh \
     --host <cloud-host> --secure --user default --password '<ADMIN_PASSWORD>'
   ```

   What it does: refuses to start if rows without the attribute arrived in the
   last 10 minutes, then drops every view, every stored landing table and
   every `app.*` table including `app.alert_events`, and re-runs `init/03`
   (Null engines), `init/10` (`app.*` and their views) and `init/12`
   (`app.alert_events` and its projection into `app.logs`). It then drops the
   dictionary and its source table, and checks that all eight views are back.

   Effects to expect:
   - **Every `app.*` table is rebuilt empty. There is no backfill.** The
     tables that are live carry a TTL built from `dictGetOrDefault`, and any
     `ALTER` re-validates that expression and fails with `TTL expression
     cannot contain non-deterministic functions`, so they cannot be altered
     into the new shape at all. `CREATE TABLE IF NOT EXISTS` is a no-op on a
     table that is already there, so without the drop the old shape would
     stay in place silently.
   - Row policies and grants survive the drop, because ClickHouse keys access
     control by database and table name and not by the table UUID, so tenant
     isolation and the per-org `/sql` users need no repair.
   - The stored `otel.*` copies are dropped, up to seven days of raw rows
     that nothing reads.
   - Per table there is a sub-second window between the view drop and the
     view create in which the exporter's insert fails; it retries.
   - Rows ingested between step 2 and step 3 keep `everr.retention.days` in
     their `ResourceAttributes`. They expire on their own schedule; nothing
     rewrites them.
   - If the swap stops part way, the script drops the landing tables it had
     already replaced. Those tables are `Null`: with no view behind them they
     accept an insert and discard it, so leaving them in place would lose data
     silently. Without them the exporter gets an error and retries.

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
WHERE active AND database = 'app'
GROUP BY table, retention_days
ORDER BY table, retention_days;
```

The landing tables store nothing and the views strip the retention keys:

```sql
SELECT name, engine FROM system.tables WHERE database = 'otel';

SELECT tenant_id, retention_days,
       countIf(mapContains(ResourceAttributes, 'everr.retention.days')) AS leaked,
       count()
FROM app.logs
WHERE TimestampTime > now() - INTERVAL 1 HOUR
GROUP BY ALL;
```

Every engine must be `Null` and `leaked` must be 0. Each tenant's
`retention_days` is the value its plan resolves to; a tenant with two values
in the same hour changed plan in it.

Part pressure, on the ClickHouse Cloud dashboard: `MaxPartCountForPartition`
under 50 on the hottest day, merge pool not saturated all day, no
`TOO_MANY_PARTS`. Expected steady state with the current tiers: about 44 live
partitions per logs and traces table, about 409 per metrics table, one to
three parts per settled partition.
