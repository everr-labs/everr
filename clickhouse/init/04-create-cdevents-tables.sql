CREATE TABLE IF NOT EXISTS otel.cdevents_raw (
    tenant_id UInt64,
    delivery_id String CODEC(ZSTD(1)),
    event_kind LowCardinality(String) CODEC(ZSTD(1)),
    event_phase LowCardinality(String) CODEC(ZSTD(1)),
    event_time DateTime64(3) CODEC(Delta, ZSTD(1)),
    subject_id String CODEC(ZSTD(1)),
    subject_name String CODEC(ZSTD(1)),
    subject_url String CODEC(ZSTD(1)),
    pipeline_run_id String CODEC(ZSTD(1)),
    repository String CODEC(ZSTD(1)),
    sha String CODEC(ZSTD(1)),
    ref String CODEC(ZSTD(1)),
    outcome LowCardinality(String) CODEC(ZSTD(1)),
    cdevent_json String CODEC(ZSTD(1)),
    INDEX idx_delivery_id delivery_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_subject_id subject_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_pipeline_run_id pipeline_run_id TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(event_time)
ORDER BY (tenant_id, event_kind, event_phase, toDateTime(event_time))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
