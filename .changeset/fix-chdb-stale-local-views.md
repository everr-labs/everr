---
"@everr/desktop-app": patch
---

Fix logs queries still failing with `Unknown identifier TimestampTime` on installs that predate the column migration. The local `logs`/`traces`/`metrics_*` query views freeze the source table's column set when created, so a view created before the `TimestampTime` migration kept rejecting the column even after the underlying `otel_logs` table was migrated. The collector now drops and recreates these views on every startup so they always expose the current column set.
