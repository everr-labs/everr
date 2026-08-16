# 07: Delivery reconciliation and the abandoned-delivery sweep

**What to build:** A lost delivery outcome is repaired, and a delivery
that never reaches terminal status stops being invisible forever. Demo:
drop a success row, the reconciler restores it from the journal outcome;
a delivery abandoned past the retry horizon becomes a terminal failure
with a counter.

**Details:** issue 10 in `../03-alerting-surface-plan.md`; blocker 6 in
the design doc's findings. This is the delivery half of the retention
leak whose event half is ticket 30.

**Blocked by:** 06.

**Status:** ready-for-agent

- [x] Delivery rows get deterministic ids derived from the journal
- [ ] The diff compares outcomes: a succeeded journal status with no succeeded row is repaired
- [ ] The repair reads by `event_id` before it writes, and rebuilds `event_time` from the delivery's `created_at`: the insert token's window is bounded, so a late repair cannot rely on it (see ticket 23)
- [ ] A sweep moves abandoned deliveries past the retry horizon to terminal failed, with a stuck-delivery counter
- [ ] The "Excluded from ClickHouse" row on dedup keys is narrowed in the design doc
