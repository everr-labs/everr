# 13: Pause and delete, end to end

**What to build:** Pausing a rule actually pauses it, and deleting a rule
pages nobody. The mutation closes its open instances in history with a
reason, resets them so resume starts from scratch, and stops in-flight
delivery. Demo: pause a firing rule; nothing sends afterwards; history
reads "stopped because paused", not "recovered"; resume re-fires.

**Details:** issue 16 in `../03-alerting-surface-plan.md`; finding 3 in
`../04-alerting-branch-review.md` (the delivery side).

**Blocked by:** 02 (the `reason` column and terminal type live in the
recreated table), 03, 11.

**Status:** ready-for-agent

- [ ] Pause and delete journal one terminal row per open instance, with the reason, in the mutation's own transaction
- [ ] Pause resets its instances so resume re-pends, re-fires, re-notifies
- [ ] Delivery checks respect the paused state; repeat delivery stops; pending notifications are canceled, per the decision (2026-08-09): unprocessed and deferred events go terminal (`notification_suppressed`, matching reason), held chains close, and group flush re-checks rule liveness at claim time
- [ ] Preview deletion writes its terminals as projections only
- [ ] Whether the logs projection carries pending rows is decided
