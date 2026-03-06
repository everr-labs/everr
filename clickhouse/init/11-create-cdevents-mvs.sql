CREATE TABLE IF NOT EXISTS app.cdevents
ENGINE = MergeTree
PARTITION BY toDate(event_time)
ORDER BY (tenant_id, event_kind, event_phase, toDateTime(event_time))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT *
FROM otel.cdevents_raw
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.cdevents_mv
TO app.cdevents
AS
SELECT *
FROM otel.cdevents_raw;
