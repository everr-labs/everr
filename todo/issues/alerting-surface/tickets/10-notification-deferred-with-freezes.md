# 10: notification_deferred with the silence freeze

**What to build:** A notification held by a silence
leaves a visible, self-sufficient record. Demo: silence a firing alert,
let the silence lapse, and the chain shows fired, deferred (with the
silence comment on the row), then delivered; nothing needs a PostgreSQL
join to read it.

**Details:** step 6 of Order of work in `../02-alerting-clickhouse-surface.md`.

**Where:** `packages/app/src/server/alerting/delivery/suppression.ts`

**Blocked by:** 02, 09.

**Status:** ready-for-agent

- [ ] The deferred event type is written on each hold change, projected from the decision rows
- [ ] The silence comment and matchers freeze onto deferred and suppressed rows
- [ ] A deferred chain that ends without delivery gets its own terminal suppressed row with a matching reason

Record check 2026-08-10: the terminal row on the deferred path exists
(`deferSuppressedEvent`), but it omits `reason`, so the column defaults to the
empty string. The parallel direct drop in `process-event.ts` writes
`no_longer_firing`. The freeze columns from ticket 02 are still written empty.

Rescoped 2026-08-18: inhibitions were removed from the product; the silence half of this ticket is unchanged.
