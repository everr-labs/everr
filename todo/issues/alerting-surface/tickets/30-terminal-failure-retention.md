# 30: Permanently failed event jobs reach retention

**What to build:** An event whose processing exhausts every retry no
longer evades cleanup forever. Terminal processing failure is recorded
with a timestamp, so retention can collect it. The delivery half of this
leak is ticket 07.

**Details:** finding 21 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] A terminal processing failure state and timestamp are recorded
- [ ] Active retries are retained; terminal failures are deleted after a safe horizon
