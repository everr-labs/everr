# How to operate at scale

This guide covers running clickety-clack as a horizontally-scaled, multi-replica
deployment: scaling the scheduler with sharding, scaling the stream consumers, and
what to monitor. For the per-role basics see
[run and deploy the roles](run-and-deploy-roles.md).

## Scale the scheduler with sharding

The scheduler decides which rules are due and enqueues evaluation jobs. To run
more than one scheduler replica without double-scheduling, it uses **leaderless
rendezvous (HRW) hashing** over a Redis-backed membership set.

### How it works

- Each scheduler replica heartbeats its `CC_NODE_ID` into the sorted set
  `cc:scheduler:members` (score = Redis server time). Replicas that stop
  heartbeating are evicted after `CC_SCHEDULER_MEMBER_TTL_MS` (default 10s).
- Tenants are partitioned into `CC_SCHEDULER_SHARDS` shards. For each shard, the
  owner is the live member with the highest rendezvous hash for that shard: every
  replica computes the same assignment independently, no coordinator.
- Each replica claims due rules only for the shards it owns, using
  `FOR UPDATE SKIP LOCKED` so a brief overlap during membership changes is
  harmless (the loser simply skips locked rows).

### Configure it

```bash
# 3 scheduler replicas, each a distinct node id, shards >= replica count:
CC_ROLE=scheduler CC_NODE_ID=sched-1 CC_SCHEDULER_SHARDS=12 ./cc
CC_ROLE=scheduler CC_NODE_ID=sched-2 CC_SCHEDULER_SHARDS=12 ./cc
CC_ROLE=scheduler CC_NODE_ID=sched-3 CC_SCHEDULER_SHARDS=12 ./cc
```

Guidance:

- Set `CC_SCHEDULER_SHARDS` **≥ the number of replicas** (ideally a small multiple,
  e.g. 4×) so shards distribute evenly. With `shards=1` you get a single owning
  replica with automatic failover: correct, just not parallel.
- **Every replica must agree** on `CC_SCHEDULER_SHARDS`. Mismatched shard counts
  produce inconsistent ownership.
- Failover is automatic: when a replica dies, its shards are reassigned to
  survivors within the heartbeat TTL.

> **Toolchain note.** The rendezvous hash uses the standard-library hasher, which
> is stable within a single build but not guaranteed identical across different
> compiler toolchains. Run all scheduler replicas from the **same binary build**.

## Scale evaluators and dispatchers

These scale by sharing Redis Streams consumer groups: no extra config:

- **Evaluators** share the `evaluators` group on `cc:eval:jobs`. Jobs
  load-balance across replicas. Within a batch, jobs with identical
  `{sql, label_columns, value_column}` are coalesced into a single ClickHouse
  query, so adding rules that share a query doesn't multiply ClickHouse load.
- **Dispatchers** share the `dispatchers` group on `cc:events`. The group flusher
  runs on every dispatcher replica and claims due groups atomically, so grouped
  delivery scales too.

Just run more replicas (each with a unique `CC_NODE_ID`). At-least-once
redelivery is absorbed by the dedup log and idempotency ledger: see
[durability](../explanation/durability-and-delivery.md).

## The maintenance singleton

The maintenance loop (outbox relay, stale-instance reconciliation, expired-silence
GC) runs inside the **evaluator** role but is gated by a single Redis lease
(`cc:maintenance:lease`, ~10s TTL). Run as many evaluators as you like; exactly
one holds the lease and runs maintenance at a time, with automatic failover when
the holder dies. No configuration needed.

## What to monitor

clickety-clack has no metrics endpoint yet; monitor via its datastores:

| Signal | How | Watch for |
| ------ | --- | --------- |
| Dead-letter backlog | `redis-cli XLEN cc:events:deadletter` | Growth ⇒ a channel is persistently failing. |
| Eval queue depth | `redis-cli XLEN cc:eval:jobs` (and consumer-group lag) | Sustained growth ⇒ evaluators can't keep up; add replicas. |
| Event queue depth | `redis-cli XLEN cc:events` | Sustained growth ⇒ dispatchers behind. |
| Pending flushes | `redis-cli ZCARD cc:groupflush` | Large/old ⇒ flusher stalled. |
| Scheduler members | `redis-cli ZRANGE cc:scheduler:members 0 -1 WITHSCORES` | Missing replicas ⇒ heartbeat/connectivity problem. |
| Maintenance lease | `redis-cli GET cc:maintenance:lease` | No holder for long ⇒ all evaluators down. |
| Failed notifications | Postgres `SELECT count(*) FROM notifications WHERE status='failed'` | Spikes ⇒ delivery problems (target shown only as redacted digest). |
| Stuck-firing instances | Postgres `instances WHERE status='firing'` vs reality | Reconciliation auto-resolves stale ones after `max(4×interval,60s)`. |

## Capacity notes

- **Redis** carries the entire hot path (two streams, group buffers, membership,
  lease). Size it for your event rate; streams are length-capped (~1M).
- **Postgres** holds all durable state and is read every scheduler tick (due-rule
  scan) and every evaluation. Index health on `rules.next_eval` and
  `instances(rule)` / `(tenant,status)` matters at scale.
- **ClickHouse** load is driven by rule count and `interval_secs`, mitigated by
  per-batch query coalescing. Prefer shared query shapes across rules where
  possible.

## Next

- Why duplicates are safe: [durability and delivery](../explanation/durability-and-delivery.md).
- The sharding design in depth: [architecture](../explanation/architecture.md#scheduler-sharding).
