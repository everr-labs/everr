---
"@everr/desktop-app": patch
---

Fix logs queries failing with `Unknown identifier TimestampTime` on installs whose local schema predates the column. The local collector previously wrote to `otel_*` tables and exposed them through plain views named after the cloud tables (`logs`, `traces`, `metrics_*`); those views froze their column set at creation, so views created before the `TimestampTime` column kept rejecting it even after the underlying table gained it. The collector now writes directly to tables carrying the cloud names — no views. On first startup with the new layout the legacy views are dropped and the `otel_*` tables are renamed into their place, so previously collected local telemetry is preserved; the adopted logs table gets the missing `TimestampTime` column in the same step.
