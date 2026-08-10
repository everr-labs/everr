# 10: notification_deferred with the silence and inhibition freeze

**What to build:** A notification held by a silence or an inhibition
leaves a visible, self-sufficient record. Demo: silence a firing alert,
let the silence lapse, and the chain shows fired, deferred (with the
silence comment on the row), then delivered; nothing needs a PostgreSQL
join to read it.

**Details:** issue 13 in `../03-alerting-surface-plan.md`.

**Blocked by:** 02, 09.

**Status:** ready-for-agent

- [ ] The deferred event type is written on each hold change, projected from the decision rows
- [ ] The silence comment and matchers freeze onto deferred and suppressed rows
- [ ] The inhibiting source freezes into the columns ticket 02 reserved
- [ ] A deferred chain that ends without delivery gets its own terminal suppressed row with a matching reason
