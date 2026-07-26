# The evaluation model and state machine

This explains how a SQL query becomes alert state: the heart of clickety-clack's
correctness. Understanding it tells you exactly when an alert fires, stays quiet,
or resolves.

## From query to instances

A rule's `sql` is run on each evaluation. The result is a set of rows. Each row
becomes an **instance** candidate:

- The `label_columns` values form the instance's labels.
- Those labels, hashed with the rule id (SHA-256 over the sorted label set), form
  a stable `InstanceKey`. Same labels ⇒ same key, deterministically, forever and
  across processes.
- The optional `value_column` is carried as the numeric value.

So "is this thing alerting?" reduces to "is there a row for this instance in the
current result?" A row present means the condition holds; a row absent means it
does not. **You design the rule so rows appear only when something is wrong.**

## The three states

Each instance is a small state machine:

| State      | Meaning |
| ---------- | ------- |
| `inactive` | Not alerting. Never fired, or has resolved. |
| `pending`  | Condition holds, but not yet long enough to fire (the for-duration). |
| `firing`   | Condition has held for at least the for-duration; alert is active. |

## Transitions

On each evaluation, for each instance, the engine looks at whether the row is
**present** and the current state:

### Row present (condition holds)
- Update labels/value, set `last_seen`, reset `absent_count` to 0.
- `inactive → pending`: set `active_since = now`. Then immediately check the
  for-duration: if `now - active_since >= for_secs`, fire (so `for_secs: 0` fires
  on first sight).
- `pending → firing`: once `now - active_since >= for_secs`, **emit one `firing`
  event** and move to firing. If this evaluation follows an absent gap
  (`absent_count > 0`), `active_since` first restarts at `now`: the condition
  must hold *continuously*, so absent time never counts toward `for_secs`.
- `firing → firing`: no event. An alert fires exactly **once** per active episode.

### Row absent (condition no longer holds)
- `inactive`: nothing to do.
- `pending`: increment `absent_count`; once it reaches `resolve_after`, drop back
  to `inactive` **silently** (no event: it never fired).
- `firing`: increment `absent_count`; once it reaches `resolve_after`, **emit one
  `resolved` event** and return to `inactive`.

## Why `for_secs` and `resolve_after` exist

They are the two anti-flap controls, on opposite edges:

- **`for_secs`** debounces the *firing* edge: a momentary spike that clears before
  the for-duration elapses passes through `pending` and back to `inactive` without
  ever paging anyone.
- **`resolve_after`** debounces the *resolved* edge: a single missing evaluation
  (a gap in your data, one slow query) doesn't immediately resolve a real,
  ongoing alert. The instance must be absent for `resolve_after` consecutive
  evaluations.

Together they give you: "fire only after the problem has persisted, resolve only
after it has genuinely cleared."

## The invariants

The state machine guarantees (and proptest enforces):

1. Never emit `firing` while already firing: one firing event per episode.
2. Never emit `resolved` without a preceding `firing`: a pending flap that
   disappears makes no noise.
3. `resolve_after` absorbs gaps: brief absences below the threshold are ignored.

These invariants are what make the downstream story tractable: the dispatcher and
notification log only ever see clean firing/resolved transitions, never a stream
of repeats.

## The absence path and why evaluation loads known instances

To resolve an alert, the evaluator must notice that a row that *used* to be there
is now *gone*. So each evaluation doesn't just process the rows ClickHouse
returned: it also loads the rule's known instances from Postgres and runs the
absent branch for any instance not in the current result. This is how a firing
instance whose row vanished gets its `resolved` event.

## Resolution safety net

What if the evaluator (or scheduler) stops entirely while alerts are firing? Those
instances would be stuck firing forever, since no evaluation runs to notice their
absence. The **reconciliation** sweep in the maintenance loop covers this: any
instance not seen for longer than `max(4 × interval_secs, 60s)` is auto-resolved
(a synthetic `resolved` event is emitted and the instance reset). See
[durability and delivery](durability-and-delivery.md#reconciliation).

## Idempotent evaluation

Eval jobs arrive over an at-least-once stream, so the same `(rule, eval_ts)` can be
delivered twice. The evaluator claims that pair in an idempotency ledger (the
`evaluations` table) in the **same transaction** that writes the instance state,
health, and outbox events it guards. A redelivered job evaluates, then loses the
claim at write time: nothing is written and the job is acked without
double-stepping the state machine.

Claiming inside the write, rather than before the evaluation, is what makes an
ack mean "durably applied". A job whose store, Redis, or ClickHouse step fails
committed no claim, so it stays pending and reclaim redelivers it for a clean
retry instead of being consumed by a transient failure.

## Rule health: a separate axis

The `inactive/pending/firing/resolved` machine above lives on **instances** (rows). It
answers "is this thing alerting?" The different question "is the rule's query even
working?" has no row to attach to. When the evaluation query *errors* (ClickHouse down,
a dropped column, a timeout, a result-row cap, a misprovisioned per-tenant user), there is
no result set to step the machine with.

That is tracked on a second axis, on the **rule**: a `healthy ↔ degraded` status with a
consecutive-failure counter. After `CC_RULE_DEGRADE_AFTER` consecutive query failures the
rule goes **degraded** and emits a routable `rule_health` notification; the first success
clears it and emits a recovery. This axis is independent of the instance machine: a
degraded rule's instances are simply **frozen** (the evaluator never runs the absence path
on an error), so a broken query can never drain firing alerts to a false `resolved`.

Crucially, the resolution safety net above is **suppressed for degraded rules**: their
frozen instances are deliberately *not* auto-resolved, because we never learned their truth
reaping them would re-introduce the false all-clear from the other direction.

## See also

- Field semantics: [data model → Rule](../reference/data-model.md#rule) and
  [Instance/Status](../reference/data-model.md#instance-and-status).
- Writing good rules around this model: [write alert rules](../how-to/write-alert-rules.md).
- Surfacing broken rules: [observe and respond to degraded rules](../how-to/observe-degraded-rules.md).
