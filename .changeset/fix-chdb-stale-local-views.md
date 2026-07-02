---
"@everr/desktop-app": patch
---

Fix logs queries still failing with `Unknown identifier TimestampTime` on installs that predate the column migration. The local `logs`/`traces`/`metrics_*` query views freeze the source table's column set when created, so a view created before the `TimestampTime` migration kept rejecting the column even after the underlying `otel_logs` table was migrated. On startup the collector now compares each query view's columns against its source table and drops and recreates the view only when it is stale; a pre-existing object that is not a view is left untouched.
