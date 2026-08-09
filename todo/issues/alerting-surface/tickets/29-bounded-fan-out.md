# 29: Bounded recipients and error bodies

**What to build:** Email and Telegram fan-out cannot start unbounded
concurrent sends, and a failed webhook cannot buffer an unbounded
response body.

**Details:** finding 19 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] Recipient count and field length limits
- [ ] Bounded send concurrency and tenant delivery quotas
- [ ] Only a small bounded error response is read and retained
