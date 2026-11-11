CREATE TABLE IF NOT EXISTS "%s"."%s_trace_id_ts" %s (
    TraceId String CODEC(ZSTD(3)),
    Start DateTime CODEC(Delta, ZSTD(3)),
    End DateTime CODEC(Delta, ZSTD(3))
) ENGINE = %s
    PARTITION BY toDate(Start)
    ORDER BY (TraceId, Start)
    %s
    SETTINGS index_granularity=8192, ttl_only_drop_parts = 1