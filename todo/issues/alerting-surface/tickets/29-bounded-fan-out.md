# 29: Bounded recipients and error bodies

**What to build:** Email and Telegram fan-out cannot start unbounded
concurrent sends, and a failed webhook cannot buffer an unbounded
response body.

**Details:** finding 19 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

**Progress (2026-08-16):** Message bodies are bounded (per-line, line-count and total-budget caps against the tightest channel limit), and provider error text is sanitized. All three boxes stay open: recipient count is uncapped, send concurrency is unbounded, and providers read the whole `response.text()` before retaining it.

- [ ] Recipient count and field length limits
- [ ] Bounded send concurrency and tenant delivery quotas
- [ ] Only a small bounded error response is read and retained
