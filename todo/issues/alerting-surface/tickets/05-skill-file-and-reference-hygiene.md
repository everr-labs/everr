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
- [x] Every documented query carries a `LIMIT` and runs under the SQL API profile, verified with `everr-dev`
- [x] The skill file copies the corrected query forms; no documented query depends on a session setting
- [x] The no-personal-data claim in Constraints is conditioned on the open labels-redaction question
- [x] If the reference does not fit the page budget, that is reported as a design signal, not papered over

Record check 2026-08-10: every worked query carries `LIMIT 100`; only the live
run under the SQL API profile is open. Page budget report: the skill file is
223 lines, roughly four times the stated one-page budget. Decide whether to
split it or to accept the size.

Record check 2026-08-11: every worked query ran unchanged under the SQL API
profile through `everr-dev cloud query`, against real dev history. All five
returned correct results; the critical-with-no-delivery query returned empty
because every dev rule is `info` severity. Four drift items found and fixed in
the same pass: the writer-coverage paragraph still said `instance_pending` and
`instance_closed` had no writer (both do, and both have rows); the `reason`
row was missing `labels_changed`, `no_longer_firing` and `no_channels`; the
inhibition freeze note conflated the unwritten columns with the written
`inhibited` flag; and nothing warned that a resolve starts its own chain, so
a chain query for a fire never shows the recovery. The lockstep sentence in
`../02-alerting-clickhouse-surface.md` was corrected to match.
