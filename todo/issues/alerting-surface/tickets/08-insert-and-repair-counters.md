# 08: Dropped-insert and repair counters

**What to build:** Best-effort stops being unmeasured. Dropped history
inserts and reconciler repairs are counted, so a rotting write path is
visible before an incident finds it.

**Details:** issue 11 in `../03-alerting-surface-plan.md`.

**Blocked by:** 06.

**Status:** ready-for-agent

- [x] A counter or span event on both history insert failure sites (implemented as named error log records: `alerts.history.insert_failed`, `alerts.history.delivery_outcome_failed`)
- [ ] A repair counter per stream in the reconciler
- [ ] Verified visible through Everr telemetry with `everr-dev`
