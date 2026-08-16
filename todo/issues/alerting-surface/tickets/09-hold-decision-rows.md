# 09: Hold decision rows

**What to build:** Hold decisions stop mutating the notification work
item. Each change to the silenced, inhibited, silence triple journals its
own decision row referencing the event, so a hold is durable and
repairable. The freeze-then-clear sequence disappears.

**Details:** step 2's code half in `../02-alerting-clickhouse-surface.md`, and The transition journal in
the same doc.

**Where:**

- `packages/app/src/server/alerting/delivery/suppression.ts`
- `packages/app/src/server/alerting/delivery/process-event.ts`

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] The compare-and-insert runs in one transaction holding the event row lock
- [ ] The previous triple is read from the journal, never from ClickHouse
- [ ] One row per hold period, not per 60-second re-deferral
- [ ] The freeze-then-clear code path is removed
