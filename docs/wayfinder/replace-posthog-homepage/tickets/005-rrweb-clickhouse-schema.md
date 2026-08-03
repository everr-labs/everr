---
name: 005-rrweb-clickhouse-schema
title: What is rrweb's event format and what would a ClickHouse storage schema look like?
labels: [wayfinder:research]
status: closed
assignee: research-subagent
blocked-by: []
---

## Question

What is rrweb's recording model (full snapshots, incremental events, event types, typical payload sizes and compression) and what is a sensible ClickHouse schema for storing replay sessions: chunking, ordering keys, codecs, TTL-based retention, and expected volume per session? Consult the clickhouse-best-practices skill for schema rules. Reference how PostHog and Highlight store rrweb data.

Findings: research/005-rrweb-clickhouse-schema.md

## Resolution

- rrweb records one full DOM snapshot per checkout window plus incremental deltas (EventType 0 to 6; FullSnapshot=2, IncrementalSnapshot=3, Meta=4). checkoutEveryNth or checkoutEveryNms bound the snapshot chain. The rrweb storage recipe recommends backend whole-session compression over per-event packFn, which maps directly to a ZSTD column codec.
- Reference architectures: PostHog deprecated raw events in ClickHouse and now stores S3 blocks plus an AggregatingMergeTree session summary table (about 100x less data per row). Highlight.io stores brotli-compressed chunked event files in S3 with ClickHouse only for session search.
- Schema sketch (in the findings doc as SQL): app.replay_events (MergeTree, ORDER BY (tenant_id, session_id, event_time, sequence), payload String CODEC(ZSTD(3)), monthly partitions, 30-day TTL with ttl_only_drop_parts) plus app.replay_sessions (AggregatingMergeTree) fed by an incremental materialized view, matching conventions in clickhouse/init/12-create-alert-events.sql, tenancy via row policy only.
- clickhouse-best-practices rules cited: schema-pk-prioritize-filters, schema-pk-cardinality-order, schema-partition-lifecycle, schema-types-avoid-nullable, schema-json-when-to-use (opaque blob stays String), insert-batch-size and insert-async-small-batches for the small SDK flushes.
- Volumes: roughly 50 to 100 KB on disk per homepage session, 50 to 150 MB per 1000 sessions. S3 offload only becomes worth it beyond about 100K sessions per month, so ClickHouse-only storage is fine at homepage scale.

Full detail and the SQL sketch: research/005-rrweb-clickhouse-schema.md
