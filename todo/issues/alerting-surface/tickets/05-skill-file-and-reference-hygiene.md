# 05: Alerting skill file and reference hygiene

**What to build:** The artifact the one-shot agent caller reads: a skill
file with the column reference and worked queries, kept in lockstep with
the design doc's Reference. Demo: an agent answers "what fired in the
last day" from the skill file alone, and every documented query succeeds
under the SQL API profile.

**Details:** issues 7 and 8 in `../03-alerting-surface-plan.md`.

**Blocked by:** 02, 04.

**Status:** ready-for-agent

- [x] The skill file exists with the column reference and worked queries
- [x] The lockstep rule with the design doc's Reference is stated
- [x] Entry queries return `notification_event_id` so the chain query is reachable
- [ ] Every documented query carries a `LIMIT` and runs under the SQL API profile, verified with `everr-dev`
- [x] The skill file copies the corrected query forms; no documented query depends on a session setting
- [x] The no-personal-data claim in Constraints is conditioned on the open labels-redaction question
- [x] If the reference does not fit the page budget, that is reported as a design signal, not papered over

Record check 2026-08-10: every worked query carries `LIMIT 100`; only the live
run under the SQL API profile is open. Page budget report: the skill file is
223 lines, roughly four times the stated one-page budget. Decide whether to
split it or to accept the size.
