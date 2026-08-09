# 27: The preview kill switch works

**What to build:** Setting the preview-alerts environment switch to off
actually stops preview evaluation load. Today the value is parsed and
never used.

**Details:** finding 17 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] The switch is enforced before preview work is enqueued
- [ ] Both values are tested
