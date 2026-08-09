# 12: Pending, end to end

**What to build:** A rule inside its for-duration is visibly pending
everywhere: the engine journals it, the history shows it, and the rule
list and detail pages render the Pending state that is unreachable today.
Demo: a breaching rule with a for-duration shows Pending in the UI, then
Firing, and the history explains both.

**Details:** issue 15 in `../03-alerting-surface-plan.md`; finding 11 in
`../04-alerting-branch-review.md`.

**Blocked by:** 02, 03, 11.

**Status:** ready-for-agent

- [x] Chain membership for pending and terminal rows is specified in the design doc before the rows are written (Episodes and chain membership, 2026-08-09: pending and closed rows carry a zero `notification_event_id` and the `episode_id`)
- [ ] Pending rows on entry to pending, and a pending-cleared terminal when the condition clears before firing, both journaled and born processed
- [ ] The definition state distinguishes pending from inactive
- [ ] Rule lists, detail pages, triage, and API vocabulary stay consistent
- [ ] Rollup coverage for inactive, pending, firing, and resolved
