# Alert for-clock restarts, runbook

The **alert-clock-restarts** alert fires when the alerting engine restarts one
rule's pending clock 3 or more times in 30 minutes. Each firing instance is one
alerting rule.

## What the engine is doing, and why

A `for` clause claims the condition held **continuously**. The engine can only
claim that for stretches it watched. When an evaluation lands more than two
intervals after the last sighting of an instance, the engine treats the gap as
unwatched and restarts `pendingSince`
(`packages/app/src/server/alerting/evaluation/state-machine.ts`). Without that,
an outage longer than `for` would fire every affected rule on the first
evaluation after it came back.

The restart is correct. The problem is what it costs when it repeats: a rule on
a 60-second interval that routinely lands more than 120 seconds late resets its
clock on **every** evaluation, so a rule with `for: 5m` never fires while the
condition holds. Nothing else records this. The instance stays pending, no
transition is written, and the rule reads healthy the whole time. This alert is
the only place it is announced.

An instance that is already firing is not counted here: it keeps its
`activeSince` whatever the pending clock does.

## 1. How bad is it

```panel
ref: affected-rules
```

- `worst_gap_ms` **below** `for_secs * 1000`: the rule can still fire, between
  restarts, if the condition holds long enough. Degraded.
- `worst_gap_ms` **at or above** `for_secs * 1000`: the rule cannot fire at
  all. Treat every alert that rule was meant to raise as not raised for the
  window below.
- `for_secs` of 0: the rule fires on the first matching evaluation, so nothing
  was missed. The lateness is still real and worth the fix.

## 2. One event, or a cadence

```panel
ref: restarts-over-time
```

A worker restart or a deploy costs each pending rule exactly one restart, at
one instant, across many rules at once. That shape is expected and resolves on
its own.

A single rule restarting every interval is the failure this alert exists for.
Continue.

## 3. Is the rule's own query failing

```panel
ref: evaluation-failures
```

A failed evaluation observes nothing, so a run of them opens the same unwatched
stretch that lateness does. If the failures track the restarts, fix the query
and the restarts go with it. The failure text is on the rule's history, and on
the `alerts.evaluate.query_failed` log next to `everr.alert.definition_id`.

## 4. Is the engine behind

If the query is healthy, the evaluations are arriving late. Two known causes,
neither with a shipped fix yet:

- **Worker concurrency.** `server/worker/runtime.ts` sets
  `WORKER_CONCURRENCY = 2` for every alerting job in the process, and the
  hourly maintenance loop can hold one of the two lanes for up to 5 minutes.
  300 rules on a 60-second interval with a 1-second query each need 300 seconds
  of work per minute against 120 seconds of capacity.
- **Head-of-line blocking.** Evaluation jobs spread over 64 partitions across
  all tenants, so one rule with a 40-second query stalls about 1/64 of the
  fleet.

## 5. What to do now

Immediate, in order of how much it costs:

1. **Lengthen the rule's `evaluationInterval`.** The tolerance is two
   intervals, so a longer interval widens the window the engine accepts. A rule
   at `5m` tolerates 10 minutes of lateness.
2. **Shorten or drop the rule's `for`.** A rule that cannot accumulate its
   `for` fires never; one with a shorter `for` fires late. Late beats never.
3. **Take load off the fleet.** Pause rules that are not earning their
   evaluations, or move the expensive query to a longer interval. The
   partitions are shared, so one slow query is everyone's problem.

Do not silence this alert to make it stop. A silence hides the message, not the
condition, and the condition is that other alerts are not being delivered.
