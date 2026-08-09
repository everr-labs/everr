# 01: Name the terminal event type

**What to build:** The terminal rows that close an alert instance get one
`event_type` name, recorded in the design doc and in the alerting
vocabulary constants. Decided 2026-08-09: `instance_closed`, born
processed, discriminated by the existing `reason` column
(`pending_cleared`, `rule_paused`, `rule_deleted`, `preview_deleted`);
`instance_resolved` stays the notifying resolve with
`reason = 'condition_cleared'`.

**Details:** issue 1 in `../03-alerting-surface-plan.md`.

**Blocked by:** None; can start immediately.

**Status:** ready-for-agent

- [x] The name appears in the design doc's event-type table and Reference
- [x] The event-type arithmetic in the design doc is corrected
- [ ] The alerting vocabulary constants include the new type
