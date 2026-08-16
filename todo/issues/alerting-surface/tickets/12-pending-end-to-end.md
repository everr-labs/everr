# 12: Pending, end to end

**What to build:** A rule inside its for-duration is visibly pending
everywhere: the engine journals it, the history shows it, and the rule
list and detail pages render the Pending state that is unreachable today.
Demo: a breaching rule with a for-duration shows Pending in the UI, then
Firing, and the history explains both.

**Details:** issue 15 in `../03-alerting-surface-plan.md`; finding 11 in
`../04-alerting-branch-review.md`.

**Blocked by:** 02, 03, 11.

**Status:** done

- [x] Chain membership for pending and terminal rows is specified in the design doc before the rows are written (Episodes and chain membership, 2026-08-09: pending and closed rows carry a zero `notification_event_id` and the `episode_id`)
- [x] Pending rows on entry to pending, and a pending-cleared terminal when the condition clears before firing, both journaled and born processed (state-machine `pending`/`pending_cleared` events; `transitionEventRows` writes them state-kind with `processed_at` set; the episode opens at pending and the fire inherits it)
- [x] The definition state distinguishes pending from inactive (`alert_state` enum gains `pending`; the evaluator stores it when instances are pending and none fire)
- [x] Rule lists, detail pages, triage, and API vocabulary stay consistent (rollup emits `pending`; both pages already render the badge; history, chart and instance detail label pending events)
- [x] Rollup coverage for inactive, pending, firing, and resolved (`rollupAlertState` + test)
