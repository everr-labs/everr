# 23: Delivery retries do not duplicate notifications

**What to build:** A retry after a provider accepted the request does not
page the same person twice, and a partially successful fan-out does not
retry every recipient. Stance decided 2026-08-09: documented
at-least-once. Slack, Discord and Telegram sell no idempotency, so the
crash-window double-page stays possible and is documented; the fix here
is per-recipient fan-out state plus provider idempotency where it
exists.

**Details:** finding 12 in `../04-alerting-branch-review.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [ ] Provider idempotency where available
- [ ] Recipient-level fan-out state when one delivery targets several recipients
- [x] The remaining at-least-once behavior is documented (design doc Durability section; not yet in the user docs)
