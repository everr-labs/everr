---
"@everr/cli": minor
---

The local store behind `everr local start` now has the same tables as Everr Cloud and self-hosted installations. A query that works against one works against the other. `logs`, `traces`, `traces_trace_id_ts` and the `metrics_*` tables keep their names and gain the `tenant_id` and `retention_days` columns. `SHOW TABLES` also lists `alert_events`, which stays empty locally, and the materialized views that fill the tables.

The first `everr local start` after this update deletes the telemetry that the previous version stored locally. Local telemetry is kept for 7 days at most, so nothing older than that is lost.
