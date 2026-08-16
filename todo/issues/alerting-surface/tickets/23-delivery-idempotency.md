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

**Progress (2026-08-16):** Delivery-row convergence is done: one send twice leaves one `delivery_succeeded` row. The three open boxes are per-recipient, and overlap ticket 29: a fan-out to several recipients has no per-recipient state, so a retry re-sends to recipients that already succeeded (recorded in `providers/telegram.ts`).

**Requirement on the ClickHouse trail, decided 2026-08-11.** A delivery that
is sent twice must still leave one `delivery_succeeded` row. The trail
cannot lean on the engine for this: `app.alert_events` is a plain MergeTree,
and its sort key puts `event_time` before `event_id`, so a
`ReplacingMergeTree` could not collapse two writes of one row either
(measured on 26.2; see Rejected alternatives in
`../02-alerting-clickhouse-surface.md`). The sort key is immutable once the
table ships.

Convergence is therefore a property of what is written:

- A row with a derived `event_id` derives every other column, `event_time`
  included. A success row takes the delivery's `created_at`; only a failed
  row, whose id already hashes its attempt, carries an attempt clock.
- Nothing that varies per attempt may be added to a success row. Send
  duration and attempt counts stay in PostgreSQL.
- Any work here that adds per-recipient rows must give each one a derived id
  and a derived time on the same rule, or a retried fan-out duplicates the
  trail permanently.

- [ ] Provider idempotency where available
- [ ] Recipient-level fan-out state when one delivery targets several recipients
- [ ] Per-recipient trail rows, if any, keep derived ids and derived times
- [x] The remaining at-least-once behavior is documented (design doc Durability section; not yet in the user docs)
- [x] One send twice leaves one `delivery_succeeded` row (deterministic `event_time`, plus the live insert token)
