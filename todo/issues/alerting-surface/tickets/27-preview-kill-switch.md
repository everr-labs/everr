# 27: The preview kill switch works

**What to build:** Setting the preview-alerts environment switch to off
actually stops preview evaluation load. Today the value is parsed and
never used.

**Details:** finding 17 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [x] The switch is enforced before preview work is enqueued
- [ ] Both values are tested

Record check 2026-08-10: enforcement exists at the scanner and at the per-rule
reschedule. The off value is tested; the on branch of the gate condition is not
reached by any current test.
