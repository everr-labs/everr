# 42: An evaluation error is sanitized on every path, not one

**What to build:** The error text a failed evaluation stores in
`alert_definitions.last_error` goes through `sanitizeAlertError`, like the
copy of the same string that goes to ClickHouse. Demo: fail a rule whose SQL
carries a URL-shaped literal, then read `last_error` and the
`evaluation_failed` history row: both hold `[redacted-url]`.

**Details:** found 2026-08-11 during the branch review.

`recordEvaluationFailure` (`server/alerting/evaluation/rule.ts`) builds one
message and writes it to two stores. The ClickHouse copy is sanitized inside
`evaluationFailureHistoryRow`. The PostgreSQL copy is stored raw, and the
rule detail page renders it (`alerts/rules_.$project.$slug.tsx`).

The delivery path already settled this the other way. `failDelivery`
sanitizes before the PostgreSQL write, and says why in place: the same string
is already sanitized on the ClickHouse path, so the boundary should not
depend on which store is being written.

The exposure here is smaller than on the delivery path. A delivery error
routinely echoes the webhook URL, which for Slack, Discord and Telegram is
the secret itself. An evaluation error comes from ClickHouse and quotes the
rule's own SQL, which is applied configuration. The problem is not this
string, it is that two writers of the same string disagree about whether the
boundary sanitizes, so the next writer has no rule to copy.

One difference is worth stating in the code rather than losing: ClickHouse is
append-only, so a secret written there cannot be withdrawn, while
`last_error` is overwritten by the next evaluation and cleared by the next
success. Sanitizing `last_error` buys one rule for the boundary, not
permanence.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] `last_error` is sanitized at the write, not at the read
- [ ] The rule (every alerting error string is sanitized before it leaves the
      process) is stated once, where the next writer of one will see it
- [ ] A URL-shaped error reaches neither store intact, under test
