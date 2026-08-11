# 43: A rule that outgrows the result cap says so

**What to build:** A rule whose query returns more rows than the SQL API
profile allows tells its author that, instead of reading as a rule that
broke. Demo: apply a rule whose query returns 1001 rows; the rule detail
names the result limit and what to do about it, and a rule sitting just under
the limit is visible before it starts failing.

**Details:** found 2026-08-11 during the branch review.

`sql_api_profile` sets `max_result_rows = 1000` with
`result_overflow_mode = 'throw'`
(`clickhouse/init/15-create-sql-api-role.sql`). Rule evaluation runs through
that profile (`querySqlApiWithMeta` in `evaluation/rule.ts`), so a rule whose
result grows past 1000 rows throws on every evaluation from then on. The
engine handles it correctly: the rule goes degraded, the failure is
journaled, and the retry backs off. Nothing tells the author which wall was
hit.

The cap is right and it should stay. It is what bounds instance fan-out: one
evaluation can create at most 1000 instances, and therefore at most 1000
journal rows and 1000 group memberships, which is what makes the flush claim
cap (ticket 35) a drain problem instead of an unbounded one.

Two parts, and the second is the one that matters:

- **The message.** The evaluation failure names the cap and the ways out
  (aggregate, add a `HAVING`, narrow the instance labels), instead of passing
  the provider's exception text through.
- **The warning before the cliff.** This failure mode is a cliff, not a
  slope: the rule works, the fleet it watches grows, and then every
  evaluation fails at once, so the alert goes silent exactly when the thing
  it watches got bigger. A rule near the cap is a rule about to go silent.
  `last_row_count` is written on every successful evaluation and the rule
  detail already reads it, so "940 rows of a maximum 1000" needs no new
  state.

The cap also belongs in the rule-authoring reference. Today it appears in the
docs only as a constraint on the documented history queries (ticket 05),
never as a limit on what a rule's own query may return.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] A rule that exceeds the result cap reports the cap, not a raw provider
      error
- [ ] A rule approaching the cap is visible before it starts to fail
- [ ] The rule-authoring reference states the cap and what it implies for how
      many instances one rule can carry
