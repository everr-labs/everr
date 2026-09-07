# 19: An abandoned delivery reaches retention

**What to build:** A delivery that never reaches terminal status stops being
invisible forever. A delivery abandoned past the retry horizon becomes a
terminal failure with a counter, so cleanup can collect it and an operator can
see that it happened.

**Why it leaks:** `alert_deliveries` rows are collected on terminal status
(`sent`, or `failed` with attempts at the cap). If every attempt dies before
the status update lands, the row stays `pending`: no terminal status, no
ClickHouse row, and cleanup's terminal predicate never matches it. Nothing
ages it out.

This is the delivery half of the retention leak whose event half is ticket 10.

**Where:**

- `packages/app/src/server/alerting/maintenance/cleanup.ts`
- `packages/app/src/server/alerting/delivery/send-delivery.ts`

**Blocked by:** nothing. This half was previously bundled with delivery
reconciliation, which was cut on 2026-08-18; the sweep never depended on it.

**Status:** ready-for-agent

- [ ] A sweep moves deliveries abandoned past the retry horizon to terminal
      failed
- [ ] The sweep emits a stuck-delivery counter, so the leak is visible before
      an operator finds it
- [ ] A swept delivery is collected by the existing terminal-status cleanup
