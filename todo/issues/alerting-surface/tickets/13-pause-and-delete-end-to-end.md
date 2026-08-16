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

**Status:** done

- [x] Pause and delete journal one terminal row per open instance, with the reason, in the mutation's own transaction (`closeRuleLifecycle`; the projection runs from a job enqueued in the same transaction)
- [x] Pause resets its instances so resume re-pends, re-fires, re-notifies (reset to inactive with `episode_id` cleared, after the close reads the open set)
- [x] Delivery checks respect the paused state; repeat delivery stops; pending notifications are canceled, per the decision (2026-08-09): unprocessed and deferred events go terminal (`notification_suppressed`, matching reason), held chains close, and group flush re-checks rule liveness at claim time (the mutation marks unprocessed and deferred events processed and projects their terminals; flush reads liveness in the claim join and drops paused or deleted members, writing the terminal for never-notified chains)
- [x] Preview deletion writes its terminals as projections only (`deleteStalePreviews` collects the open set in the delete transaction and projects `instance_closed` with `reason = 'preview_deleted'` for the previews it actually removed)
- [x] Whether the logs projection carries pending rows is decided (moot: the projection was later cut entirely; recorded in the design doc under "Whether alerting belongs in `app.logs`")
