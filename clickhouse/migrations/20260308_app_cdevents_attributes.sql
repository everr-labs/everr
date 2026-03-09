ALTER TABLE app.cdevents
    ADD COLUMN IF NOT EXISTS attributes Map(LowCardinality(String), String) CODEC(ZSTD(1))
    AFTER cdevent_json;

ALTER TABLE app.cdevents
    DROP INDEX IF EXISTS idx_pipeline_run_id;

ALTER TABLE app.cdevents
    DROP COLUMN IF EXISTS pipeline_run_id;
