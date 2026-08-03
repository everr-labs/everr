# 005: rrweb recording model and a ClickHouse schema for replay sessions

**Answer first:** rrweb records one full DOM snapshot per checkout window plus a stream of small incremental events (`{type, data, timestamp}` JSON, EventType 0 to 6). A homepage-scale session is roughly 0.5 to 1.5 MB of raw JSON (a 30-minute heavy session is 1 to 5 MB gzipped). Both reference vendors moved raw event payloads OUT of ClickHouse at scale: PostHog stores compressed blocks in S3 and only aggregated session summaries in a ClickHouse `session_replay_events` table (about 100x less data per row than their original all-in-ClickHouse design), and Highlight.io stores brotli-compressed chunked JSON files in S3 with only session search metadata in ClickHouse. At our homepage-replacement volume, storing raw events directly in ClickHouse is fine and much simpler: a `MergeTree` events table ordered by `(tenant_id, session_id, event_time, sequence)` with `payload String CODEC(ZSTD(3))`, monthly partitions, and a 30-day `TTL` with `ttl_only_drop_parts = 1`, plus an `AggregatingMergeTree` summary table fed by a materialized view for the session list UI. Expect roughly 50 to 150 KB on disk per session and 50 to 150 MB per 1000 sessions after ZSTD. Revisit blob offload only if volume grows by orders of magnitude.

## Part 1: rrweb recording model

Sources: https://github.com/rrweb-io/rrweb, https://github.com/rrweb-io/rrweb/blob/master/guide.md, https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/dive-into-event.md, https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/optimize-storage.md

### Full snapshots vs incremental events

rrweb serializes the entire DOM once into a JSON tree (the full snapshot, including inlined CSS and form values), then uses `MutationObserver` and event listeners to emit only deltas: node additions and removals, attribute mutations, text changes, scrolls, mouse moves, inputs, and so on. rrweb calls this the "incremental-snapshot-chain mechanism": a replay is only meaningful starting from a full snapshot, with every incremental event after it applied in order. This is the core storage constraint: incremental events are useless without the full snapshot that anchors their chain.

### Event shape and the EventType enum

Every event is `{ type: EventType, data: {...}, timestamp: number }` with a millisecond epoch timestamp. The `EventType` enum (a TypeScript numeric enum, so stable integers on the wire; see https://app.unpkg.com/rrweb@1.0.8/files/typings/types.d.ts):

| Value | Name | Meaning |
|---|---|---|
| 0 | DomContentLoaded | page lifecycle marker |
| 1 | Load | page lifecycle marker |
| 2 | FullSnapshot | serialized DOM tree, the replay anchor |
| 3 | IncrementalSnapshot | a delta; `data.source` says which kind |
| 4 | Meta | page metadata: `href`, viewport `width`/`height` |
| 5 | Custom | user-emitted custom event (`record.addCustomEvent`) |
| 6 | Plugin | plugin-emitted event (console, network plugins) |

For `IncrementalSnapshot` events, `data.source` is the `IncrementalSource` enum: 0 Mutation, 1 MouseMove, 2 MouseInteraction (clicks and similar), 3 Scroll, 4 ViewportResize, 5 Input, 6 TouchMove, 7 MediaInteraction, 8 StyleSheetRule, 9 CanvasMutation, 10 Font, plus later additions (Drag, StyleDeclaration, Selection, AdoptedStyleSheet, CustomElement) in rrweb 2.x.

### Typical payload sizes

Sizes are DOM-dependent, so these are ballparks:

- Full snapshot: the whole serialized DOM with inlined stylesheets. Typically ~100 KB to ~1 MB raw JSON for a normal page; heavy apps can hit several MB. For a marketing homepage expect ~150 to 500 KB.
- Incremental events: mostly tiny, tens of bytes (a batched mousemove, a scroll) up to a few KB (a large mutation burst). Mousemove and mutation events dominate event counts.
- Whole session: a 30-minute session is typically 1 to 5 MB gzipped (https://www.blog.brightcoding.dev/2025/09/01/record-and-replay-user-sessions-on-the-web-a-deep-dive-with-rrweb); raw JSON is roughly an order of magnitude larger. A short homepage session (1 to 3 minutes, a few hundred to ~2000 events) lands around 0.5 to 1.5 MB raw JSON.

### Chunking: checkouts

`record()` accepts `checkoutEveryNth` (take a full snapshot after every N events) and `checkoutEveryNms` (after every N ms). Each checkout starts a new snapshot chain, which is what makes storage trimming and mid-session seeking possible: you can drop or skip everything before the latest checkout. The guide warns the chain mechanism makes "last N" capture approximate: `checkoutEveryNms: 5 * 60 * 1000` retains between 5 and 10 minutes, `checkoutEveryNth: 200` retains between 200 and 400 events. A checkout FullSnapshot arrives with `isCheckout: true` in the emit callback. Recommended for us: `checkoutEveryNms` of 5 to 10 minutes, which bounds replay seek cost and lets retention trim whole chains; for short homepage sessions most recordings will contain exactly one full snapshot.

### Compression options

- `packFn` / `unpackFn`: rrweb ships an fflate-based (deflate) per-event compressor in `@rrweb/packer`. It shrinks each event independently on the client.
- Backend compression: the storage recipe explicitly recommends against per-event packing when you control the backend: "it's recommended to compress the whole session in the backend, which will have a more efficient compression ratio" (https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/optimize-storage.md). Cross-event compression wins because consecutive events share enormous amounts of structure.
- Transport: gzip the HTTP request body (standard `Content-Encoding: gzip` from the SDK) and store the raw JSON server-side.
- Other levers from the recipe: `sampling` (drop mousemove, throttle scroll to ~150 ms, `input: 'last'`), `blockClass` to skip noisy subtrees (animations, canvases, long lists), and dedup of repeated CSS across sessions.

Implication for ClickHouse: do NOT use `packFn`. Store raw event JSON in a `String` column and let the column codec (ZSTD) do cross-event compression within parts, which is exactly the "compress the whole session in the backend" recommendation, for free.

## Part 2: How PostHog and Highlight.io store rrweb data

### PostHog: from ClickHouse rows to S3 blobs

Sources: https://posthog.com/handbook/engineering/session-replay/session-replay-architecture, https://posthog.com/docs/how-posthog-works/recordings-ingestion, https://posthog.com/docs/self-host/configure/session-replay-storage

- Original architecture: rrweb events were chunked, gzipped and base64-encoded client-side into `$snapshot` events and stored as rows in a ClickHouse `session_recording_events` table with a short TTL. At scale this was "impractical and expensive" and has been deprecated; self-hosted PostHog now requires blob storage for recordings.
- Current architecture (Blob Storage v2): the SDK batches `$snapshot_items` to a `/s/` endpoint. A Rust capture service validates and publishes to Kafka (`session_recording_snapshot_item_events`, with an overflow topic for billing-limited sessions). A Node blob ingester parses the gzipped messages, buffers events per session on disk (line-delimited JSON, Snappy-backed session recorder), periodically flushes compressed blocks to S3, and only then emits metadata to Kafka for ClickHouse. One driver was that raw snapshot data routinely exceeds Kafka max message sizes.
- ClickHouse holds only the summary: `session_replay_events` is a sharded AggregatingMergeTree keyed by session, storing first/last timestamps, distinct_id, URLs, click_count, keypress_count, console log counts, active_milliseconds, and S3 block locations. Columns like `unique_url_count` are aggregate function states read with `uniqExactMerge()`. S3 is the source of truth for the replayer; Postgres holds recording metadata and soft-delete state.
- Result: "at least a hundred times less data per row in ClickHouse than in the original infrastructure, and compressing it about twice as much."

### Highlight.io: brotli chunks in S3, search metadata in ClickHouse

Sources (code, repo https://github.com/highlight/highlight): `backend/storage/storage.go`, `backend/payload/payload.go`, `backend/clickhouse/sessions.go`, `backend/clickhouse/migrations/000012_create_sessions_table.up.sql`

- Live ingestion buffers raw rrweb events in Redis sorted sets (`PushRawEvents`, scored by timestamp), so an in-progress session can be watched before it is finalized.
- On session completion a payload manager merges the buffered `EventsObject` payloads into large JSON arrays and writes them through a brotli `CompressedWriter` to files with suffix `.events.json.br` (`payload.EventsCompressed`), uploaded to S3 as payload type `session-contents-compressed` (filesystem client for self-host). Long sessions are chunked: `GetChunkedPayloadType` appends a `-%04d` chunk offset to the object key, and the player fetches chunks via presigned direct-download URLs. Network resources, WebSocket events, and timeline indicators go to sibling `.json.br` objects.
- Postgres stores the session records; ClickHouse stores a `sessions` table (migration 000012) used for session search and filtering, not for replay payloads.

### Takeaway for us

Both vendors converged on the same shape at scale: object storage for the raw rrweb stream, ClickHouse only for the searchable per-session summary. But both also started simpler (PostHog literally started with events in ClickHouse), and the pain points were scale-driven: Kafka message limits, ClickHouse storage cost at millions of sessions per day. For a homepage replacement recording our own marketing traffic, volumes are thousands of sessions per month, not millions per day. Raw events in ClickHouse with ZSTD gets within ~2x of the blob approach on compression, avoids a whole S3 lifecycle and chunk-index subsystem, and keeps replay fetch as one ordered range scan. The schema below keeps the PostHog-style summary table anyway, so a later blob migration only has to change where `payload` lives.

## Part 3: Candidate ClickHouse schema

### Rules checked

From `.agents/skills/clickhouse-best-practices/` (skill: `clickhouse-best-practices`):

- `schema-pk-plan-before-creation`: query patterns documented below before fixing ORDER BY (it is immutable).
- `schema-pk-prioritize-filters` and `schema-pk-filter-on-orderby`: both dominant queries filter on the ORDER BY prefix (`tenant_id`, then `session_id` or date).
- `schema-pk-cardinality-order`: low-to-high within the filter constraint; `tenant_id` (low) leads, `session_id` (high) follows because it is the equality filter of the dominant query. Guidance in the rule places session_id at position 3+; here it is position 2 deliberately, because the replay fetch is `WHERE tenant_id = ? AND session_id = ?` and `schema-pk-prioritize-filters` (CRITICAL) outranks pure cardinality ordering (see the rule's own tenant example).
- `schema-types-native-types`, `schema-types-minimize-bitwidth`: `UInt8` for enum values, `UInt16` for segment index, `UInt32` for sequence and byte sizes, `DateTime64(3)` matching rrweb ms timestamps.
- `schema-types-lowcardinality`: not applied to `session_id` (unbounded cardinality); applied nowhere else because the numeric enums are already 1 byte.
- `schema-types-avoid-nullable`: no Nullable columns; empty-string and zero defaults throughout.
- `schema-types-enum`: rrweb's numeric enums are stored as raw `UInt8` rather than ClickHouse `Enum8`, on purpose: rrweb adds IncrementalSource values over time and Enum would reject unknown values at insert.
- `schema-partition-low-cardinality`, `schema-partition-lifecycle`, `schema-partition-start-without`: monthly partitions (12/year, bounded), used for lifecycle only (TTL drops whole parts); partitioning is justified here because retention is a hard requirement, which is the rule's stated reason to partition at all.
- `schema-json-when-to-use`: `payload` is an opaque blob we never field-query in the hot path, so it is `String`, not `JSON` (the rule explicitly says use String for opaque blobs). The few extracted fields (counts, URL) are materialized into the summary table at insert time instead.
- `insert-batch-size`, `insert-async-small-batches`: SDK flush batches are small (a few KB every ~5 s per visitor), so the ingest endpoint must either buffer server-side into 10K+ row inserts or use `async_insert = 1`.

Repo rule (CLAUDE.md): do not add `tenant_id = getSetting('SQL_everr_tenant_id')` filters in queries; the row-level policy handles tenancy. The policy itself is created once in init SQL, mirroring `clickhouse/init/12-create-alert-events.sql`.

Conventions matched from `/Users/guidodorsi/workspace/everr/clickhouse/init/12-create-alert-events.sql` and `03-create-otel-tables.sql`: `app` database, `tenant_id String`, `CODEC(ZSTD(...))`, `Delta` codec on timestamps, `ttl_only_drop_parts`, `app_ro` row policy, per-tenant TTL via the `app.tenant_retention` dictionary if needed.

### Query patterns (drives ORDER BY, per schema-pk-plan-before-creation)

1. Replay fetch (hot path): `WHERE tenant_id = ? AND session_id = ? ORDER BY event_time, sequence`, optionally `AND event_time >= last_checkout` to seek. Full ORDER BY prefix.
2. Session list UI: served by the summary table, `WHERE tenant_id = ? AND session_date BETWEEN ? AND ?`, sorted by recency, filtered on counts/URL. Full ORDER BY prefix of the summary table.
3. Retention: TTL only, no query.

### Schema

```sql
-- Raw rrweb event stream. One row per rrweb event, payload stored as raw JSON
-- (no client-side packFn: the ZSTD column codec compresses across consecutive
-- events in a part, which beats per-event deflate).
CREATE TABLE IF NOT EXISTS app.replay_events
(
  tenant_id String,
  session_id String,                      -- SDK-generated UUID per recording session
  window_id String DEFAULT '',            -- tab/window within the session
  segment_id UInt16 DEFAULT 0,            -- checkout segment; increments on each FullSnapshot
  sequence UInt32,                        -- monotonic per-session counter from the SDK; breaks same-ms ties
  event_time DateTime64(3) CODEC(Delta(8), ZSTD(1)),  -- rrweb event.timestamp (ms)
  event_type UInt8,                       -- rrweb EventType (0..6); raw UInt8, not Enum8, so new SDK values never fail inserts
  incremental_source UInt8 DEFAULT 0,     -- rrweb IncrementalSource; meaningful only when event_type = 3
  is_checkout UInt8 DEFAULT 0,            -- 1 on a FullSnapshot emitted via checkoutEvery*
  payload String CODEC(ZSTD(3)),          -- the full rrweb event JSON
  payload_bytes UInt32 MATERIALIZED length(payload)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
-- Dominant read: one whole session as an ordered scan. tenant_id (low card)
-- leads per schema-pk-cardinality-order; session_id sits second, ahead of
-- what pure cardinality ordering suggests, because every hot-path query
-- filters on it with equality (schema-pk-prioritize-filters).
ORDER BY (tenant_id, session_id, event_time, sequence)
-- Replay retention is short by design. ttl_only_drop_parts + monthly
-- partitions make expiry a metadata-only part drop
-- (schema-partition-lifecycle). Swap the literal for the
-- app.tenant_retention dictGetOrDefault pattern (see 12-create-alert-events.sql)
-- if per-tenant retention becomes a requirement.
TTL toDateTime(event_time) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

GRANT SELECT ON app.replay_events TO app_ro;
GRANT INSERT, SELECT ON app.replay_events TO web_app_admin;

-- Tenancy: row policy only. Queries must NOT add getSetting-based tenant
-- filters (repo rule); this policy is the single enforcement point.
DROP ROW POLICY IF EXISTS tenant_filter_replay_events ON app.replay_events;
CREATE ROW POLICY tenant_filter_replay_events
ON app.replay_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

-- Per-session summary for the session list UI (PostHog session_replay_events
-- shape). Incremental MV keeps it fresh at insert time (query-mv-incremental).
CREATE TABLE IF NOT EXISTS app.replay_sessions
(
  tenant_id String,
  session_date Date,
  session_id String,
  first_event_time SimpleAggregateFunction(min, DateTime64(3)),
  last_event_time SimpleAggregateFunction(max, DateTime64(3)),
  event_count SimpleAggregateFunction(sum, UInt64),
  payload_bytes SimpleAggregateFunction(sum, UInt64),
  full_snapshot_count SimpleAggregateFunction(sum, UInt64),
  mouse_interaction_count SimpleAggregateFunction(sum, UInt64),  -- clicks and taps
  input_count SimpleAggregateFunction(sum, UInt64),
  first_url AggregateFunction(argMin, String, DateTime64(3))     -- read with argMinMerge(first_url)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(session_date)
-- Session list filters: tenant + date range (schema-pk-filter-on-orderby).
ORDER BY (tenant_id, session_date, session_id)
TTL session_date + INTERVAL 30 DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

GRANT SELECT ON app.replay_sessions TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_replay_sessions ON app.replay_sessions;
CREATE ROW POLICY tenant_filter_replay_sessions
ON app.replay_sessions
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.replay_sessions_mv
TO app.replay_sessions
AS
SELECT
  tenant_id,
  toDate(event_time) AS session_date,
  session_id,
  min(event_time) AS first_event_time,
  max(event_time) AS last_event_time,
  count() AS event_count,
  sum(length(payload)) AS payload_bytes,
  countIf(event_type = 2) AS full_snapshot_count,                          -- FullSnapshot
  countIf(event_type = 3 AND incremental_source = 2) AS mouse_interaction_count,  -- MouseInteraction
  countIf(event_type = 3 AND incremental_source = 5) AS input_count,       -- Input
  argMinState(
    if(event_type = 4, JSONExtractString(payload, 'data', 'href'), ''),
    event_time
  ) AS first_url                                                           -- Meta event carries href
FROM app.replay_events
GROUP BY tenant_id, session_date, session_id;
```

Ingestion notes:

- The `/replay` ingest endpoint should buffer incoming SDK batches and insert in large batches (10K to 100K rows, per `insert-batch-size`) or insert with `async_insert = 1, wait_for_async_insert = 1` (per `insert-async-small-batches`), because per-visitor flushes are tiny.
- The SDK config to pair with this: `checkoutEveryNms: 5 * 60 * 1000`, `sampling: { mousemove: 50, scroll: 150, input: 'last' }`, no `packFn`, gzip at the HTTP transport layer.
- Replay fetch is a single ordered range scan; seeking uses `is_checkout = 1` rows (or `segment_id`) to find the nearest earlier full snapshot.

### Volume estimates

Assumptions: homepage-style sessions, average ~2 minutes, ~800 events per session, one full snapshot of ~300 KB, incremental events averaging ~400 bytes raw. JSON compresses roughly 8x to 12x under ZSTD(3) (consistent with the 1 to 5 MB gzipped per 30-minute session benchmark cited in Part 1).

| Unit | Rows | Raw JSON | On disk (ZSTD) |
|---|---|---|---|
| 1 session | ~800 | ~0.6 MB | ~50 to 100 KB |
| 1000 sessions | ~0.8 M | ~0.6 GB | ~50 to 150 MB |
| 1000 sessions/month, 30-day TTL steady state | ~0.8 M | ~0.6 GB | ~50 to 150 MB |

Heavy-tail bound: a 30-minute active session at the top of the cited range is ~5 MB on disk; a few hundred such sessions per month is still low single-digit GB. The summary table is negligible (one row per session per date, ~100 bytes). Even at 100x these volumes (100K sessions/month, ~5 to 15 GB on disk) the design holds; the PostHog-style S3 offload only becomes interesting beyond that.

## Sources

- rrweb repo and guide: https://github.com/rrweb-io/rrweb, https://github.com/rrweb-io/rrweb/blob/master/guide.md
- rrweb event structure: https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/dive-into-event.md, https://app.unpkg.com/rrweb@1.0.8/files/typings/types.d.ts
- rrweb storage optimization recipe: https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/optimize-storage.md
- PostHog session replay architecture: https://posthog.com/handbook/engineering/session-replay/session-replay-architecture
- PostHog replay ingestion: https://posthog.com/docs/how-posthog-works/recordings-ingestion
- PostHog self-host replay storage (ClickHouse deprecation): https://posthog.com/docs/self-host/configure/session-replay-storage
- Highlight.io storage code: https://github.com/highlight/highlight (backend/storage/storage.go, backend/payload/payload.go, backend/clickhouse/migrations/000012_create_sessions_table.up.sql)
- Session size benchmark: https://www.blog.brightcoding.dev/2025/09/01/record-and-replay-user-sessions-on-the-web-a-deep-dive-with-rrweb
- Local rules: /Users/guidodorsi/workspace/everr/.agents/skills/clickhouse-best-practices/SKILL.md and rules/ files cited inline
- Local conventions: /Users/guidodorsi/workspace/everr/clickhouse/init/12-create-alert-events.sql, /Users/guidodorsi/workspace/everr/clickhouse/init/03-create-otel-tables.sql
