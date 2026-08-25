# 20: An open instance outlives its own history

**What to build:** an instance that keeps firing stays visible in ClickHouse
however long it fires, so a fold over the transition rows cannot report it as
closed.

**Status:** needs-a-decision (not ready for an agent)

## The gap

The fold that answers "what is firing now" reads the transition rows and
takes the newest one per instance:

```sql
SELECT alert_definition_id, instance_fingerprint,
       argMax(event_type, (event_time, event_id)) AS state,
       max(event_time) AS since
FROM alert_events
WHERE is_live
  AND event_type IN ('instance_pending', 'instance_fired',
                     'instance_resolved', 'instance_closed')
  AND event_time >= now() - INTERVAL 30 DAY
GROUP BY alert_definition_id, instance_fingerprint
HAVING state = 'instance_fired'
LIMIT 100
```

Transitions are written on a state change, so an instance that fires
continuously has exactly one row. The TTL deletes that row at the tenant's
`logs_days`, and the instance is then invisible: the fold reports it closed
while it is still firing and still paging. Nothing re-asserts it.

The instance stays correct in PostgreSQL throughout. Only the ClickHouse
answer rots, which is the answer an agent and the SQL API get.

## Why this is worth reopening

Settled on 2026-08-09 as a declared caveat rather than a re-assertion row,
with "revisit only if a real incident ever approaches the retention length".
Two things weaken that:

- The TTL for transition rows is the tenant's `logs_days`, not the 3650-day
  fallback. On a 30-day plan a chronic alert crosses it in a month. This is
  not a decade-scale hypothetical.
- The failure is a confident wrong negative during an incident. The decision
  immediately above it in the same list, "the fold takes no time window",
  rejects a bounded window for exactly that reason. The two decisions do not
  agree.

## Options

1. **A state row on every evaluation.** Simplest to explain. It scales with
   open instances, which the rule controls through `instanceLabels`: at 100
   open instances it is 144,000 rows a day per tenant, twice the evaluation
   stream, and the fold reads the whole non-evaluation stream over full
   retention by design. It inverts the cost model the partition split
   assumes.
2. **A fixed low cadence** (hourly, daily). Same information, 1/60th to
   1/1440th of the rows. Still pays for instances that fire for a minute.
3. **Expiry-driven re-assertion.** The hourly maintenance cron already runs.
   Add a pass that re-asserts an open instance only when its newest row is
   older than a fraction of the tenant's `logs_days`. An instance firing for
   a year costs about four rows; an instance firing for an hour costs none.

Option 3 targets the actual failure and nothing else. It needs a way to know
when the instance was last projected, which is either a stamp on
`alert_instances` or a bounded ClickHouse read per sweep.

## Open questions

- The event type. Reusing `instance_fired` would read as a new fire and break
  "since when". A distinct type keeps the fold honest but every reader has to
  learn it.
- "Firing since" once the opening row has expired. Re-assertions carry the
  same `episode_id`, so the fold can take `min(event_time)` per episode and
  report "since at least X". Truthful, and different from what the column
  says today.
- Whether the same sweep should re-assert the hold rows a long silence
  leaves, for the same reason.
- Whether this is worth building before the state view itself (ticket 02),
  which is where the caveat is currently documented.

**Blocked by:** nothing technically. It needs a decision on the option and
the event type first.
