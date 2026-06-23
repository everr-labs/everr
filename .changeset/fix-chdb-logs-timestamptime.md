---
"@everr/desktop-app": patch
---

Fix "Failed to load logs" in the logs explorer. The embedded collector's local `otel_logs` table was missing the `TimestampTime` column that log queries filter on, so every query failed with `Unknown identifier TimestampTime`. New installs now create the column, and existing installs are migrated on startup with an idempotent `ADD COLUMN IF NOT EXISTS`.
