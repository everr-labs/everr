# 14: app.alert_state

**What to build:** "What fires now, since when, at what value" becomes one
query. A view folds the transition rows into current state, correct
without the reader knowing the fold trick, with staleness visible.

**Details:** issue 17 in `../03-alerting-surface-plan.md`, and step 8's
decision list in `../02-alerting-clickhouse-surface.md`.

**Blocked by:** 12, 13. Also 34: the fold reports an instance whose
terminal was lost as firing forever, and preview teardown can lose one.

**Status:** ready-for-agent

- [ ] The view folds live-alert rows across both write sources; ties break on time then id
- [ ] A plain select is correct and includes staleness (`last_evaluation_at` folded from a 24-hour window), so a stuck instance is distinguishable from a firing one
- [ ] The retention-horizon caveat (decided 2026-08-09: a declared blind spot, no re-assertion row) is stated in the Reference and the skill file
- [ ] Point-in-time is a documented query pattern (the fold bounded by `event_time <= T`), not a second view
- [ ] The view itself is granted through the tenancy template from ticket 04, with the row policy verified
- [ ] The escalation to a refreshable materialized view carries the tenancy template as a precondition
- [ ] A worked query lands in the Reference and the skill file
