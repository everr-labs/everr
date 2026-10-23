# Recording Ingestion: Collector and Storage

**Date:** 2026-10-23
**Status:** implemented in PR #527, not released
**PR:** [#527](https://github.com/everr-labs/everr/pull/527)
**Scope:** `collector/`, `clickhouse/`, and the local chdb store
**Companions:** [WebSDK Recording](./2026-10-22-otel-web-recording.md) (capture, API, transport), [Session Replay](./2026-10-17-session-replay.md) (overall design)

## Problem Statement

The WebSDK keeps the last minutes of the page in memory and sends a Clip only when something worth keeping happens. That request is where the platform takes over. Four things have to be right or the feature is not usable:

1. A large Clip must not go through the shared Log insert. One 950 KB Segment in the normal Logs batch can fail an ordinary Log write.
2. The raw rrweb must be stored with the Session, Stream, and Clip, so the player can find and order it.
3. Tenants must stay isolated, and raw rrweb must stay out of the SQL API and the Agent surface.
4. Data must expire with the Plan retention on Cloud and with the local TTL on a local Collector.

The collector is the boundary for all four. If routing depended on a URL, a client flag, or a tenant id chosen by the browser, the WebSDK would become a security dependency. If Segments landed in the Logs table, replay volume would compete with the app's own telemetry. If storage had no TTL, a Plan downgrade would leave old rrweb behind.

## Solution

`everr.browser.recording.segment` is the whole routing contract. A Segment is one OTLP Log. Its body is the rrweb events as a JSON array, and its log attributes carry the Session, Stream, Clip, and Segment index. The Cloud collector splits Logs after usage metering with a routing connector. Segments go to a dedicated ClickHouse exporter and its own landing table, `otel.otel_recordings`. A materialized view stamps tenant and retention and writes `app.recordings`. Every other Log, including the recording mark, stays in `app.logs`.

The local Collector has no routing connector. Its chdb exporter splits on the same event name and writes a local `recordings` table beside `logs`.

The `recording` Span is not part of this split. It is a normal Span in `traces`, and it is the small, queryable index that the app and Agents use to find a Clip. The collector never parses rrweb.

## Data Contract

A Segment carries:

| Field                             | Kind               | Meaning                                               |
| --------------------------------- | ------------------ | ----------------------------------------------------- |
| `everr.browser.recording.segment` | event name         | the routing key; exact match                          |
| JSON array                        | body               | rrweb events, in playback order                       |
| `session.id`                      | log attr           | the Session                                           |
| `everr.recording.stream.id`       | log attr           | the Stream (one document in one Session)              |
| `everr.recording.clip.id`         | log attr           | the Clip                                              |
| `everr.recording.segment.index`   | log attr           | integer from 0 per Clip                               |
| `everr.recording.clip.truncated`  | log attr, optional | `true` when the Clip started after the requested time |
| record timestamp                  | OTLP timestamp     | timestamp of the last event in the Segment            |

The timestamp can be older than the request that delivered the Segment, because a tail Segment is sent after the events it holds.

A Segment has no `TraceId` or `SpanId`. The WebSDK sends it on the immediate path and does not attach the active Span. A Clip joins the other signals through `session.id`, `everr.recording.stream.id`, and time.

The `recording` Span is the index entry. It lives in `traces` with `SpanName = 'recording'` and carries `session.id`, `everr.recording.stream.id`, `everr.recording.clip.id`, `everr.recording.trigger`, and `everr.recording.clip.truncated` when the Clip is truncated. It is not routed by the collector.

A recording mark is an ordinary Log named `everr.browser.recording.mark` with `everr.recording.mark.name`. It is not a Segment. The routing condition matches only the `.segment` event name, so a mark stays in `logs` in every Session, including an unsampled one.

## Cloud Collector

### Build and configuration

`collector/config/manifest.yaml` adds the upstream `routingconnector` at the same version as the rest of the collector (`v0.160.0`). The collector is built with the OpenTelemetry Collector Builder from that manifest.

`collector/config.example.yml` adds the connector and two receiving pipelines:

```yaml
connectors:
  routing:
    default_pipelines: [logs/telemetry]
    table:
      - condition: log.event_name == "everr.browser.recording.segment"
        pipelines: [logs/recordings]

service:
  pipelines:
    logs:
      receivers: [githubactions]
      processors: [resource, resource/retention_logs, everr_usage]
      exporters: [routing, everr_usage_connector]
    logs/public:
      receivers: [otlp/public]
      processors:
        [
          attributes/strip_user_tenant,
          resource/public_tenant,
          resource/public_retention_logs,
          everr_usage,
        ]
      exporters: [routing, everr_usage_connector]

    logs/telemetry:
      receivers: [routing]
      exporters: [clickhouse]
    logs/recordings:
      receivers: [routing]
      exporters: [clickhouse/recordings]
```

- Both Log ingress paths, the internal `logs` pipeline and the public browser `logs/public` pipeline, route. A Segment from either path is treated the same.
- The routing connector defaults to move, so a record is delivered to exactly one receiving pipeline.
- `logs/telemetry` and `logs/recordings` have no processors. They receive from the connector and store through one exporter each.
- `traces`, `metrics`, and their public variants keep their direct `clickhouse` exporter.

### Metering and topology validation

The usage processor stays last on the ingress pipeline, ahead of the routing connector. A Segment is counted once by the usage processor and is not metered again after the split. That keeps Clip volume on the same quota as the rest of the browser telemetry and avoids a second usage path.

`everrusageextension` validates the graph at startup. Its rules for a routed admission are:

- A pipeline that receives a `routing` connector must not also run the usage processor.
- The usage processor must still be the last processor on the ingress pipeline.
- The ingress pipeline may feed an exporter directly or a `routing` connector. A connector that is not `routing` is rejected.
- A routing connector must have at least one downstream pipeline.
- Each downstream pipeline must not run the usage processor, must not export `everr_usage_connector`, must not export another connector, and must have exactly one exporter.
- That exporter must pass the same persistent-queue check as a direct admission exporter: persistent storage, fsync, admission acknowledgment (`wait_for_result: false`), and unlimited retries.

A misconfigured split fails collector startup instead of silently metering a Segment twice or losing it. The validation tests cover metering again downstream, a queue without the required settings, no downstream pipeline, a non-routing connector, and two exporters in a downstream pipeline.

### The recordings exporter

`clickhouse/recordings` is a second instance of the existing ClickHouse exporter. It uses the same connection as `clickhouse` and writes Logs only.

```yaml
clickhouse/recordings:
  endpoint: http://clickhouse:8123
  username: collector_rw
  password: collector-dev
  database: otel
  logs_table_name: otel_recordings
  create_schema: false
  connection_params:
    wait_for_async_insert: "1"
    materialized_views_ignore_errors: "0"
  json: true
  sending_queue:
    enabled: true
    storage: file_storage/ingestion
    wait_for_result: false
    queue_size: 10000
    num_consumers: 10
    sizer: requests
    batch:
      sizer: items
      min_size: 16
      max_size: 16
      flush_timeout: 1s
  retry_on_failure:
    enabled: true
    max_elapsed_time: 0s
```

- The landing table is `otel.otel_recordings`, not `otel.otel_logs`. The collector does not create it (`create_schema: false`). The ClickHouse init scripts or the manual DDL own the schema.
- The batch is 16 Log records, not the 8192 rows the ordinary Logs exporter uses. A Segment body is about 950 KB, so 16 records put at most about 15 MB in one insert. This avoids a huge 8192-row batch of nearly-megabyte bodies and avoids writing many tiny parts.
- The queue is persistent and admission is acknowledged before the OTLP request succeeds. Delivery, batching, and retries stay inside the exporter.
- `wait_for_async_insert: "1"` makes the insert wait for the materialized view to run, so a view error is returned to the exporter instead of being hidden by an asynchronous insert.
- `materialized_views_ignore_errors: "0"` makes a missing tenant or retention attribute fail the insert. That is deliberate: a row with no retention must never be stored silently.
- The recordings queue is separate from the `clickhouse` queue. A poison Segment or a backlog affects recordings only, not ordinary Logs or Traces.

### Browser ingest and gzip

The WebSDK gzips its exports with `Content-Encoding: gzip` when the browser supports `CompressionStream`. `Content-Encoding` is not a CORS-safelisted request header, so the public OTLP receiver must allow it in the preflight answer:

```yaml
receivers:
  otlp/public:
    protocols:
      http:
        cors:
          allowed_origins: ["*"]
          allowed_headers: ["Authorization", "Content-Type", "Content-Encoding"]
```

The local gateway config adds `Content-Type` and `Content-Encoding` to its own CORS block. This is the collector half of the gzip rollout. Without it, the preflight fails and all browser exports stop, not only Segments. The deployed Cloud config must include the header before the WebSDK release that sends gzip.

### Failure behavior

- The routing connector moves each record to exactly one receiving pipeline. A Segment never enters the telemetry exporter, and an ordinary Log never enters the recordings exporter. One cannot fail the other.
- The two exporters have separate persistent queues and retry loops. A recordings insert failure or a recordings backlog does not block ordinary Logs or Traces.
- A recordings insert that fails the materialized view is retried indefinitely, because the exporter has unlimited retries. It holds one consumer; a persistent failure can back up the recordings queue.
- The recordings queue does not block on overflow. When it is full, admission fails, the OTLP request fails, and the client does not retry, so that Segment is lost. The gap shows in the Clip's Segment index.
- The client does not retry any failed Segment. The collector's exporter retries the Segments it accepted.
- A Segment that the public receiver rejects, for example because the request is over the 20 MiB body limit, is lost at ingest and the gap shows in the Clip's Segment index.

## Cloud ClickHouse

### Landing table

`clickhouse/init/03-create-otel-tables.sql` creates `otel.otel_recordings` with `ENGINE = Null` and the same columns as `otel.otel_logs`:

- `Timestamp DateTime64(9)`
- `TraceId`, `SpanId`, `TraceFlags`
- `SeverityText`, `SeverityNumber`
- `ServiceName`, `Body`
- `ResourceSchemaUrl`, `ResourceAttributes` JSON, `ResourceAttributesKeys`
- `ScopeSchemaUrl`, `ScopeName`, `ScopeVersion`, `ScopeAttributes` JSON, `ScopeAttributesKeys`
- `LogAttributes` JSON, `LogAttributesKeys`
- `EventName`

The column list follows the upstream ClickHouse exporter schema for the version pinned in `collector/config/manifest.yaml` (`v0.160.0`). The exporter's DDL is the reference, so the landing table moves with that pin. The table stores nothing. An insert only triggers the materialized view. It has no TTL because it holds no data.

### Materialized view

`app.recordings_mv` reads `otel.otel_recordings` and writes `app.recordings`. It mirrors the shape of `app.logs_mv` and adds the three recording columns:

- `tenant_id` is `toLowCardinality(toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')))`.
- `retention_days` is `everrRetentionDaysJson(ResourceAttributes)`. It throws when `everr.retention.days` is missing, zero, or not a positive number of days.
- `ResourceAttributesKeys` is passed through `everrStripRetentionKeys`, so the retention key is not stored in the keys array. The `ResourceAttributes` column type has `SKIP everr.retention.days`, so the path is not stored in the JSON either.
- `session_id` is `toString(getSubcolumn(LogAttributes, 'session.id'))`.
- `stream_id` is `toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id'))`.
- `clip_id` is `toString(getSubcolumn(LogAttributes, 'everr.recording.clip.id'))`.

The ids come from the Log record attributes, not the resource attributes, because the WebSDK envelope is merged into each Log record. Tenant and retention are resource attributes, stamped by the collector from the authenticated key and the Plan.

The view is attached to `otel.otel_recordings` only. It is not attached to `otel.otel_logs`, so a Segment cannot reach `app.logs` through a view.

### `app.recordings`

The table is created and altered in `clickhouse/init/10-create-mvs.sql`. It is built with `CREATE TABLE ... AS SELECT ... WHERE 1 = 0`, so its payload types follow `otel_recordings`; the codecs are applied afterwards with `ALTER TABLE`.

- Columns: every `app.logs` column, plus `session_id String`, `stream_id String`, and `clip_id String`. `tenant_id` and `retention_days` keep the same types and meaning as in `app.logs`.
- Engine: `MergeTree`.
- Partition: `(toDate(Timestamp), retention_days)`.
- Order: `(tenant_id, ServiceName, Timestamp)`.
- TTL: `toDate(Timestamp) + toIntervalDay(retention_days)`.
- Settings: `index_granularity = 8192`, `ttl_only_drop_parts = 1`.
- Codecs: `Delta(8), ZSTD(1)` for `Timestamp`, and `ZSTD(1)` for the string, JSON, and keys columns that the `ALTER` lists. `TraceFlags` and `SeverityNumber` keep the default. `ResourceAttributes` is JSON with `max_dynamic_paths = 256` and `SKIP everr.retention.days`.
- Skip indexes: `idx_session_id`, `idx_stream_id`, and `idx_clip_id`, each `bloom_filter(0.001)` with granularity 1.

The `Body` is opaque rrweb JSON and uses ZSTD. There is no lower-body index and no snapshot, URL, or error-count column. The rrweb payload is the source of truth, and the player reads by ids and time, not by body text.

Partitioning by day and retention lets a Plan change drop whole parts. Changing retention affects new rows, since each row carries the retention that was in force when it was written. `ttl_only_drop_parts` avoids rewriting parts for an expiry that only affects some rows.

### Tenant isolation and the SQL API

`app_ro` gets `SELECT` on `app.*` from `clickhouse/init/00-setup.sh`. That blanket grant makes the row policy the only tenant boundary, so `app.recordings` gets the same shape as `app.logs`:

```sql
DROP ROW POLICY IF EXISTS tenant_filter_recordings ON app.recordings;
CREATE ROW POLICY tenant_filter_recordings
ON app.recordings
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
```

The SQL API is denied in two ways:

- `sql_api_default_deny_recordings` on `app.recordings` for `sql_api_role`, with `USING 0`.
- No `GRANT SELECT` on `app.recordings` to `sql_api_role`.

ClickHouse returns every row when no row policy applies, so the default-deny policy is what keeps a later accidental grant from exposing every tenant. `SQL_API_TENANT_TABLES` does not list `recordings`, so the SQL API does not provision a per-org policy for it and the MCP query tool description does not advertise it. A negative test asserts that `recordings` stays out of both.

The app reads through `app_ro`. The player must not add a `tenant_id` predicate of its own. Tenant isolation is the row policy, the same as the Logs and Traces queries.

### Read contract

The player reads two tables.

**Find the Clip.** It queries `traces` for `SpanName = 'recording'`, the Session id, and the Stream id, looking for a Span whose range covers the entry time:

```sql
SELECT TraceId, SpanId, toString(Timestamp) AS startTs,
       toString(toUnixTimestamp64Nano(Timestamp)) AS startNs,
       toString(Duration) AS durationNs,
       <SpanAttributes:everr.recording.clip.id> AS clipId,
       <SpanAttributes:everr.recording.trigger> AS trigger,
       <SpanAttributes:everr.recording.clip.truncated> AS truncated
FROM traces
WHERE SpanName = 'recording'
  AND <SpanAttributes:session.id> = {sessionId:String}
  AND <SpanAttributes:everr.recording.stream.id> = {streamId:String}
  AND Timestamp BETWEEN entryTs - INTERVAL 1 HOUR AND entryTs
  AND addNanoseconds(Timestamp, Duration) >= entryTs
ORDER BY Timestamp ASC, SpanId ASC
```

If several Clips cover the moment, the earliest one wins. If none does, the same query without the Stream and time filters lists the Session's Clips.

A Clip is its own Trace, with one root Span named `recording`. The trace list excludes those Traces with `TraceId NOT IN (SELECT TraceId FROM traces WHERE ParentSpanId = '' AND SpanName = 'recording')`, so a Clip does not take a page slot. A direct span query still finds it.

**Load the Segments.** It queries `recordings` for the Clip's range, moved 60 seconds earlier for the snapshot lead-in:

```sql
SELECT Body AS body,
       <LogAttributes:everr.recording.segment.index> AS segmentIndex
FROM recordings
WHERE ServiceName = {service:String}
  AND Timestamp BETWEEN fromTs AND toTs
  AND session_id = {sessionId:String}
  AND clip_id = {clipId:String}
ORDER BY toInt64OrZero(segmentIndex)
```

- The predicate does not mention `tenant_id`. The `app_ro` row policy applies it.
- `ServiceName` is the browser service from the record that supplied the Stream id.
- `clip_id` separates overlapping Clips and other tabs.
- The window is the `recording` Span range plus a 60 second lead-in, not a clock-relative range.
- The bloom filters on `session_id` and `clip_id`, together with the primary key prefix `(tenant_id, ServiceName, Timestamp)`, support this read. The Segment index is read from the attribute and sorted in the query because it is not a column.

A missing Segment index is a lost or dropped request. The player turns index holes into a gap, and a run of silence longer than the 5 second tail cadence into a tail gap. Pause and resume are rrweb custom events inside the Segment body, so a silent page is not mistaken for a paused recorder.

### Migration

Fresh servers get the objects from `clickhouse/init/`:

- `03-create-otel-tables.sql` creates `otel.otel_recordings`.
- `10-create-mvs.sql` creates `app.recordings`, its indexes and codecs, and `app.recordings_mv`.
- `15-create-sql-api-role.sql` creates the SQL API default-deny policy.
- `20-apply-rls.sql` creates the `app_ro` tenant filter.

Existing clusters do not run `init/`. The ClickHouse image only runs `clickhouse/init` from `docker-entrypoint-initdb.d`, so an existing cluster applies `clickhouse/manual/recordings.sql` once:

```sh
clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
  < clickhouse/manual/recordings.sql
```

The manual file contains the landing table, `app.recordings`, its indexes and codecs, the materialized view, and both row policies. It assumes that `everrRetentionDaysJson` and `everrStripRetentionKeys` exist from `clickhouse/init/05-create-retention-functions.sql`, and that `sql_api_role` and `app_ro` exist. It does not create roles or users, and it does not grant `app.recordings` to the SQL API role.

Apply the DDL before deploying the collector config that routes. `otel.otel_recordings` is a `Null` table: if it exists but `app.recordings_mv` does not, inserts succeed and the Segments are discarded. Verify the landing table, the app table, the view, and both policies before enabling the routing connector.

## Local Collector

The local gateway uses the same event name but a different seam. It has no routing connector. `logsJSONExporter.pushLogsData` splits the batch:

1. `splitRecordingSegments` copies records into a non-Segment result and a Segment result.
2. If there are no Segments, the existing Logs insert runs unchanged, including an empty batch.
3. If there are Segments, the non-Segment result is inserted into `logs` first, then the Segment result into `recordings`.
4. A batch with only Segments does not open a Logs insert.

If the Logs insert fails, no Segment insert is attempted and the exporter retries the original batch. If the Segment insert fails after the Logs insert succeeded, the exporter retries the whole batch, so ordinary Logs from that batch can be inserted twice. This is the same at-least-once behavior as the rest of the local exporter.

Each result keeps the resource and scope wrappers it needs. The source batch is not changed. Resource and scope wrappers are created only when at least one record of that wrapper belongs in the result, so an empty scope is not copied. The local path has no tenant or retention columns and no materialized view.

The local `recordings` table is created from `recordings_json_table.sql` when `create_schema` is true, which is the local gateway default. It has the same payload columns as the local `logs` table, plus `session_id`, `stream_id`, and `clip_id`:

- Engine: the configured local engine, `MergeTree` by default.
- Partition: `toDate(Timestamp)`.
- Order: `(ServiceName, Timestamp)`.
- TTL: the local `--ttl`, 7 days by default, on `toDateTime(Timestamp)`.
- Settings: `index_granularity = 8192`, `ttl_only_drop_parts = 1`.
- Skip indexes: the Logs indexes (`ResourceAttributesKeys`, `ScopeAttributesKeys`, `LogAttributesKeys`, `TraceId`, `lower(Body)`) plus `idx_session_id`, `idx_stream_id`, and `idx_clip_id` with `bloom_filter(0.001)`.
- Columns: the local `logs` payload plus the three ids. There is no `tenant_id` and no `retention_days`.

The table name is fixed to `recordings`, not derived from `logs_table_name`. Local table names match the Cloud query-facing names (`logs`, `traces`, `recordings`), so the shared player query runs unchanged.

The local schema version stays at 2. `recordings` is a new table, and `CREATE TABLE IF NOT EXISTS` adds it to a store that is already on version 2 without discarding cached telemetry. `staleTableNames` includes `recordings`, so a future version bump drops it with the rest of the store. `recordings_json_table.sql` is not part of the shaped-template digest. A later change to that DDL must join the digest and bump `localSchemaVersion`; otherwise an existing local store keeps the old shape.

The local SQL gateway has no row policies. `everr local query` can read `recordings`, which is what makes local debugging possible.

## Storage Map

| Signal or attribute               | Cloud column                         | Local column          |
| --------------------------------- | ------------------------------------ | --------------------- |
| `everr.browser.recording.segment` | `EventName`                          | `EventName`           |
| `session.id`                      | `session_id`                         | `session_id`          |
| `everr.recording.stream.id`       | `stream_id`                          | `stream_id`           |
| `everr.recording.clip.id`         | `clip_id`                            | `clip_id`             |
| `everr.recording.segment.index`   | `LogAttributes` only                 | `LogAttributes` only  |
| `everr.recording.clip.truncated`  | `LogAttributes` only                 | `LogAttributes` only  |
| `everr.tenant.id`                 | `tenant_id`                          | not stored            |
| `everr.retention.days`            | `retention_days`, partition, and TTL | not stored; local TTL |
| `service.name`                    | `ServiceName`                        | `ServiceName`         |
| Segment timestamp                 | `Timestamp`                          | `Timestamp`           |
| `recording` Span                  | `traces`                             | `traces`              |
| recording mark                    | `logs`                               | `logs`                |

The recordings table holds raw rrweb. It is not in `SQL_API_TENANT_TABLES`, not in the MCP query tool description, and the telemetry skill tells Agents not to read it. Agents find Clips through the `recording` Span in `traces` and marks through `logs`.

## Design Decisions

- **Route after metering, not before.** The usage processor stays on the ingress pipeline, where it sees every Log exactly once before the split. If metering ran downstream, each receiving pipeline would need it, and the same Segment could be counted twice.
- **Move, not copy.** A Segment is stored once. Copying it to both `logs` and `recordings` would duplicate volume, break the negative assertion that `logs` has no Segments, and give the player two sources.
- **The event name is the key.** No custom header, marker attribute, or second endpoint. The WebSDK already sends one OTLP Log per Segment, and the collector can route on `log.event_name` without parsing the body. A mark is a different event name and stays in `logs`.
- **A separate landing table and exporter.** The existing `clickhouse` exporter keeps its 8192-row Log batch and its queue. Segments get their own table, queue, batch, and retry loop, so replay volume cannot fail an ordinary Log insert and a poison Segment cannot block Logs.
- **A small item-count batch.** The ClickHouse exporter has no byte-size batch. Sixteen records is the practical limit for 950 KB bodies. A 8192-row batch of Segments would be an avoidable failure mode.
- **Wait for the view.** `wait_for_async_insert: "1"` and `materialized_views_ignore_errors: "0"` make a view error visible to the exporter. A silent drop is worse than a retry.
- **A `Null` landing table plus a view.** This matches `otel_logs` and `logs`. The view is the only place that knows how tenant, retention, and the three ids are derived, and the landing table stays a pure OTLP shape.
- **MergeTree, not ReplacingMergeTree.** The exporter delivers at least once, so a retry can store a Segment twice. The duplication is accepted: a deduplication key would add a background merge cost and a second definition of identity for a best-effort signal. The Segment index remains the loss signal.
- **Partition by day and retention.** A Plan change drops whole parts, the same as Logs. The row carries the retention that was in force at write time.
- **Order by tenant, service, time.** The player always filters on service and a time window, and the row policy always constrains tenant. The three bloom filters cover Session, Stream, and Clip. A body index would not help the player and would cost space on data nobody searches.
- **Keep raw rrweb off the SQL API.** The table is reachable by `app_ro` through `GRANT SELECT ON app.*`, so the row policy is mandatory. The SQL API role gets no grant and a default-deny policy. The table is not in `SQL_API_TENANT_TABLES`, so no per-org policy is provisioned and the MCP tool does not advertise it.
- **Split in the local exporter.** The local collector does not ship the routing connector. The chdb exporter already owns the local schema and the local table names, so the split belongs there. The event name is the same, so the wire contract does not fork.
- **No tenant column locally.** A local store serves one developer and has no per-org access path. Adding a tenant column would make the local schema and the shared queries diverge for no security gain.
- **No server-side scrub.** Privacy runs in the browser before events enter the buffer. The collector and the database store what the browser sent, and the player masks nothing further.

## Testing

The tests drive public boundaries: OTLP in, rows out, SQL results out. They do not assert on YAML text.

- `TestRenderCreateRecordingsTableSQL` checks the local table template: database and table name, the three id columns, the three bloom filters, the local order key, and no `SQL_everr_tenant_id`.
- `TestChDBRoundTripSplitsRecordingSegments` sends a Segment, a mark, and an ordinary Log through the chdb exporter. It asserts the Segment lands in `recordings` with `session_id`, `stream_id`, and `clip_id`, and the other two land in `logs`.
- `TestRecordingSegmentsLandInRecordings` starts the built local collector, posts OTLP JSON with a Segment, a mark, and an ordinary Log, and queries the local SQL endpoint. It asserts the Segment is in `recordings`, not in `logs`, the mark and ordinary Log are in `logs`, and neither is in `recordings`.
- `TestRoutedAdmission` checks the usage topology rules: a valid routed admission passes; metering again, a queue without the required settings, no downstream pipeline, a non-routing connector, and two downstream exporters each fail with the expected message.
- The Cloud integration test in `collector/internal/cloudrecordings` starts ClickHouse on testcontainers, applies the schema init scripts (`03`, `05`, and `10`), starts a collector with the OTLP receiver, the routing connector, and two ClickHouse exporters, and posts a protobuf OTLP batch. It asserts the Segment lands in `app.recordings` with stamped `tenant_id` and `retention_days` and the three ids, while the mark and ordinary Log stay in `app.logs`. The test is behind the `integration` build tag in its own Go module, so `make test-all` does not start containers.
- `TestLocalGatewayAllowsContentEncodingPreflight` sends a CORS preflight with `Content-Encoding` to the built local gateway and asserts the header is allowed. This tests the behavior, not the YAML.
- The SQL API and MCP tests assert that `recordings` is not in `SQL_API_TENANT_TABLES` and not in the MCP query tool description.
- The trace list test asserts that a root Span named `recording` is excluded from the page query.
- Collector gates: `(cd collector && make test-all)`, plus `go test -tags=integration ./...` in `collector/internal/cloudrecordings` for the Cloud test.
- Per the project rule, ingestion is verified end to end with Everr: from a real page, confirm Segments land in `app.recordings` under the key's organization, ordinary Logs stay in `app.logs`, the `recording` Span is in `traces`, the player loads the Clip, and a failed fetch produces a network Clip. On the local stack, confirm `everr local query` returns the Segment and the Clip Span.

## Rollout

1. Apply `clickhouse/manual/recordings.sql` to every existing Cloud cluster. Verify `otel.otel_recordings`, `app.recordings`, `app.recordings_mv`, `sql_api_default_deny_recordings`, and `tenant_filter_recordings`.
2. Deploy the collector build and config with the routing connector, the `clickhouse/recordings` exporter, and the two receiving pipelines. Include `Content-Encoding` in the public CORS allow-list.
3. Confirm ordinary Logs and Traces still arrive and the collector reports no exporter errors.
4. Release the WebSDK with recording. Segments are now routed to `app.recordings`; marks and all other Logs still go to `app.logs`.
5. Release the app read path. The player opens a Clip from a `recording` Span and loads its Segments from `recordings`.

The collector must be ahead of the WebSDK release. If the SDK ships first, Segments go to `app.logs`, and later Clips are not playable. Segments already queued in the old `clickhouse` exporter can also drain to `app.logs` after the config change. That is a small, one-time gap; no migration copies them.

## Known Limits

- Delivery is at least once. A retried insert can store a Segment twice, and the player may replay the duplicate events. There is no deduplication key and no ReplacingMergeTree merge.
- A full recordings queue rejects admission. The WebSDK does not retry, so that Segment is lost and the gap shows in the Segment index. The queue does not wait for capacity.
- A batch that fails the materialized view, for example because `everr.retention.days` is missing, is retried indefinitely and holds a consumer. A persistent failure can back up the recordings queue. Ordinary Logs and Traces are unaffected because they use a different exporter and queue.
- A partially applied manual DDL can silently drop Segments. The landing table is `Null`; without the materialized view, an insert succeeds and stores nothing.
- A Segment larger than the public receiver's 20 MiB body limit is rejected at ingest. The client does not retry it. The gap shows in the Segment index.
- There is no body search index on `app.recordings`, and the SQL API cannot read it. Raw rrweb is for the player, not for exploration.
- `app.recordings` has no lower-body, snapshot, URL, or error-count columns. The rrweb payload is the source of truth.
- The local recordings table name is fixed to `recordings`. A custom local `logs_table_name` does not rename it.
- The local schema version remains 2 while the new table is added with `CREATE TABLE IF NOT EXISTS`. A later change to the recordings DDL must join the template digest and bump the version, or an existing store keeps the old shape.
- A Plan change affects new rows. Rows already stored keep the `retention_days` they were written with, and their parts expire under that value.
- Cloud retention is the Logs retention. There is no separate recording retention or recording quota.
- A `recording` Span can share a Session with another tab or a reload. The Stream id and `clip_id` keep the player on the right document and Clip; the table has no cross-Clip deduplication.
- Local storage has no tenant isolation. It is a developer store and exposes `recordings` through the local SQL gateway.

## Out of Scope

- The WebSDK capture code, Clip API, buffer, privacy, and transport. Covered by `docs/specs/2026-10-22-otel-web-recording.md`.
- The player UI, Trace and error views, and span seeking. Covered by the overall Session Replay spec and its tickets.
- A SQL API or MCP surface for `recordings`.
- Server-side scrubbing or redaction.
- Deleting Recordings on request, per Visitor or Session.
- Recording a whole Session from start to end. Clips only.
- Deduplicating overlapping Clips or repeated Segments.
- Compressing Segment bodies at the application layer. ClickHouse compresses the column with ZSTD.
- Video, screenshots, canvas, or cross-origin iframe capture beyond what rrweb records.
- Alerts or reports that list the Sessions they hit.
- Propagating `session.id` to backend services.

## References

- PR: https://github.com/everr-labs/everr/pull/527
- WebSDK spec: `docs/specs/2026-10-22-otel-web-recording.md`
- Overall design: `docs/specs/2026-10-17-session-replay.md`
- Cloud schema: `clickhouse/init/03-create-otel-tables.sql`, `clickhouse/init/10-create-mvs.sql`, `clickhouse/init/15-create-sql-api-role.sql`, `clickhouse/init/20-apply-rls.sql`
- Existing-cluster DDL: `clickhouse/manual/recordings.sql`
- Cloud collector config: `collector/config.example.yml`, `collector/config/manifest.yaml`
- Usage topology validation: `collector/extension/everrusageextension/topology.go`
- Local exporter split: `collector/exporter/chdbexporter/exporter_logs_json.go`
- Local table template: `collector/exporter/chdbexporter/internal/sqltemplates/recordings_json_table.sql`
- Local schema version: `collector/exporter/chdbexporter/schema_version.go`
- Cloud integration test: `collector/internal/cloudrecordings/recordings_test.go`
- Player read path: `packages/app/src/data/replay/server.ts`
- Glossary: `CONTEXT.md` (Recording, Stream, Clip, Segment, Replay)
- Telemetry skill: `skills/everr-use-telemetry/rules/browser-events.md`
