# 29: Bounded recipients and error bodies

**What to build:** Telegram fan-out cannot start unbounded
concurrent sends, and a failed webhook cannot buffer an unbounded
response body.

**Evidence:** Telegram channels accept an unbounded recipient array and
start every send at once, and a failed webhook buffers the whole response
body before it builds an error:

- `packages/app/src/data/alerting/schema.ts:115`
- `packages/app/src/data/alerting/delivery/channel-sender.server.ts:86`
- `packages/app/src/data/alerting/delivery/providers/slack.ts`

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

**Progress (2026-08-16):** Message bodies are bounded (per-line, line-count and total-budget caps against the tightest channel limit), and provider error text is sanitized. All three boxes stay open: recipient count is uncapped, send concurrency is unbounded, and providers read the whole `response.text()` before retaining it.

- [ ] Recipient count and field length limits
- [ ] Bounded send concurrency and tenant delivery quotas
- [ ] Only a small bounded error response is read and retained
