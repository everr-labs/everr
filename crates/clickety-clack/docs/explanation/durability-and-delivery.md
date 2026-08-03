# Durability and delivery guarantees

This explains what clickety-clack promises about not losing or duplicating alerts,
and the mechanisms that deliver those promises. The short version: **at-least-once
end to end, made safe by idempotency and deduplication at every hand-off.**

## The guarantee

- **No silently lost events.** A firing/resolved transition that the evaluator
  commits will be published, even across crashes.
- **No double-notifications.** At-least-once redelivery is absorbed so each
  distinct alert produces one notification.
- **No stuck-firing alerts.** An alert whose evaluator dies is eventually
  auto-resolved.
- **No work consumed by a transient failure.** An eval job is acked only once its
  outcome is durable; a job whose Postgres, Redis, or ClickHouse step failed stays
  pending and is redelivered.

These are achieved without distributed transactions across systems: only local
Postgres transactions plus idempotent replay.

## The lost-publish problem and the outbox

A naive evaluator would: update the instance in Postgres, then publish the event
to Redis. If it crashes between those two steps, the state says "resolved" but no
event was ever sent: a lost alert.

clickety-clack uses the **transactional outbox** pattern:

1. In **one Postgres transaction**, the evaluator writes the new instance state
   **and** an `event_outbox` row carrying the event payload.
2. After commit, it publishes the event to `cc:events` and, on success, deletes
   the outbox row.

If it crashes after commit but before publishing (or the publish fails), the
outbox row survives. A **relay** in the maintenance loop periodically claims
outbox rows older than a 5-second grace window and republishes them, deleting on
success. So the event is published either by the inline path or by the relay:
never lost. The grace window keeps the relay from racing the normal inline
publish.

The relay is a **lease singleton**: only the evaluator holding
`cc:maintenance:lease` runs it, so there's no thundering herd of republishers,
while failover still happens when the holder dies.

## Why duplicates are safe

The outbox makes publishing *at-least-once* (a row can be republished after a
publish that actually succeeded but whose delete failed). Redis Streams are also
at-least-once on the consumer side. So duplicates are expected and absorbed in two
places:

- **Evaluation idempotency.** The evaluator claims `(rule, eval_ts)` in the
  `evaluations` ledger inside the same transaction as the state it writes. A
  redelivered job loses that claim at write time and commits nothing, so the
  state machine never double-steps.
- **Delivery deduplication.** Before sending, the dispatcher claims a dedup key
  in the `notifications` table. A key already in a terminal state (`sent` /
  `failed`) is not sent again. A key left `pending` is a lease: while it is held,
  a redelivery neither sends nor acks, and once the lease expires another sender
  reclaims it, so a sender that dies mid-send cannot suppress that notification
  forever. A row reclaimed more times than the claim cap is retired to the
  dead-letter stream instead of replaying whatever keeps killing its sender.

This is the core design choice: rather than fight for exactly-once delivery
(expensive, fragile), the system embraces at-least-once and makes every consumer
idempotent.

## Reconciliation

The outbox handles "the event was committed but not published." A different gap is
"no evaluation ran at all": e.g. the scheduler or evaluator was down, so a firing
instance's row absence was never observed and it's stuck firing.

The **reconciliation** sweep (also in the maintenance loop) handles this. It finds
instances not seen for longer than `max(4 × interval_secs, 60s)` and:

- **firing → ** emits a synthetic `resolved` event (through the same outbox, so
  it's durable) and resets the instance to inactive;
- **pending/inactive → ** quietly resets to inactive.

The threshold is per-rule (four missed intervals, floor 60s), so tight rules
recover quickly and slow rules aren't resolved prematurely.

## Expired-silence GC

A further maintenance task deletes silences more than 24 hours past their
`ends_at`, so the silences table doesn't grow forever. Its cadence is **wall-clock
hourly** and tracked so it survives lease hand-offs: a new maintenance leader
won't re-run GC early or skip it.

## The maintenance loop, together

The tasks share one loop (5-second tick) inside the evaluator role, gated by
the single `cc:maintenance:lease`:

| Task                | What it protects against            | Cadence |
| ------------------- | ----------------------------------- | ------- |
| Outbox relay        | Lost publishes (crash after commit) | every tick, rows past 5s grace |
| Rule reconciliation | Stuck-firing alerts (no evaluation) | every tick |
| SLO reconciliation  | Stuck-firing SLO alerts             | every tick |
| Silence GC          | Unbounded silence growth            | hourly wall-clock |
| Ledger pruning      | Unbounded ledger growth             | hourly wall-clock |

Ledger pruning ages out rows older than 7 days from the evaluation idempotency
ledgers (`evaluations`, `slo_evaluations`) and the delivery/dedup ledger
(`notifications`). That retention bounds the dedup guarantees: a redelivery
arriving more than 7 days after the original is no longer suppressed.

They are independent: any one can fail on a tick without blocking the others.

## Delivery effort and giving up

Delivery itself is bounded, not infinite (see
[the dispatch pipeline](dispatch-pipeline.md#retry-permanence-and-dead-lettering)):
transient failures retry with backoff up to 4 attempts; permanent (4xx) failures
don't retry. Anything that exhausts retries lands on the `cc:events:deadletter`
stream: durable, inspectable, and recoverable, rather than dropped. A flush-time
secret-decrypt failure likewise dead-letters the batch (the group was already
claimed from Redis) so the loss is observable.

## What this means for you

- **Expect occasional reprocessing**, especially around restarts and failovers:
  it's normal and harmless.
- **Treat the dead-letter stream as your delivery SLO signal.** A growing backlog
  means a channel is persistently failing; the events are safe but undelivered.
- **Resolve latency has a floor** set by reconciliation when an evaluator dies:
  `max(4 × interval_secs, 60s)` plus a maintenance tick. Tighter intervals ⇒
  faster auto-resolve.

## See also

- [Operate at scale](../how-to/operate-at-scale.md): monitoring these signals.
- [The evaluation model](evaluation-model.md): the idempotency ledger and absence
  path.
- [Tunables](../reference/tunables.md#maintenance-outbox-relay-reconciliation-silence-gc).
