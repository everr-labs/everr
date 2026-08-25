# 1: Dropped-insert counters

**What to build:** Best-effort stops being unmeasured. Dropped history
inserts are counted, so a rotting write path is visible before an incident
finds it.

**Details:** step 5 of Order of work in `../02-alerting-clickhouse-surface.md`.

**How to read the counters:** a dropped insert is permanent, so any
non-zero rate is history that no longer exists.

**Blocked by:** nothing.

**Status:** ready-for-agent

- [x] A counter or span event on both history insert failure sites (implemented as named error log records: `alerts.history.insert_failed`, `alerts.history.delivery_outcome_failed`)
- [ ] Verified visible through Everr telemetry with `everr-dev`
