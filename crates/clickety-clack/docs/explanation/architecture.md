# Architecture overview

This explains how clickety-clack is put together and why. It is background reading,
not a task list — for those see the [how-to guides](../how-to/run-and-deploy-roles.md).

## The big picture

clickety-clack is a pipeline of four roles connected only through shared
infrastructure — Postgres (durable state) and Redis Streams (the hot path). There
is no direct RPC between roles; each one reads its work from a queue or table and
writes its results to another. This is what lets every role scale independently
and fail without taking the others down.

```
            ┌───────────┐   cc:eval:jobs    ┌────────────┐
  rules ───▶│ scheduler │ ────(stream)────▶ │ evaluator  │───▶ ClickHouse (read)
 (Postgres) └───────────┘                   └────────────┘
                                                  │ publishes (via outbox)
                                                  ▼  cc:events (stream)
                                            ┌────────────┐
                                            │ dispatcher │──▶ Slack / email /
                                            └────────────┘     PagerDuty / webhook
                                              silence · inhibit · route · group · dedup
```

Everything is one binary (`cc`); `CC_ROLE` picks which stage(s) a process runs.
`all` runs the whole pipeline in one process for development.

## Why this decomposition

- **Independent scaling.** The scheduler is cheap and mostly idle; the evaluator
  is ClickHouse-bound; the dispatcher is network-bound on delivery; the api is
  request-bound. Splitting them lets you add replicas exactly where the load is.
- **Failure isolation.** A wedged ClickHouse slows evaluators but doesn't block
  the api or in-flight dispatch. A dead dispatcher replica's events are picked up
  by its peers via the shared consumer group.
- **Backpressure via queues.** Each stage consumes at its own rate; Redis Streams
  buffer the difference and provide at-least-once redelivery.

## The roles

### scheduler
Decides which rules are due (`rules.next_eval <= now`) and enqueues an evaluation
job per due rule onto `cc:eval:jobs`. To run multiple replicas safely it uses
[sharding](#scheduler-sharding). It is the only stateful-coordination role; the
rest lean on Redis consumer groups.

### evaluator
Consumes eval jobs, runs each rule's SQL against ClickHouse, advances the
[state machine](evaluation-model.md), and publishes firing/resolved events to
`cc:events`. It coalesces identical queries within a batch and publishes
transactionally through an [outbox](durability-and-delivery.md). It also hosts the
**maintenance loop** (relay, reconciliation, silence GC) behind a single lease.

### dispatcher
Consumes events and runs the [delivery pipeline](dispatch-pipeline.md): silence →
inhibition → routing → grouping → dedup → delivery, with retry and dead-lettering.

### api
Serves the management HTTP API. Stateless: any replica can serve any request.

## Storage roles

| Store | Role | Why it was chosen |
| ----- | ---- | ----------------- |
| **PostgreSQL** | Durable system of record: rules, instances, routing config, silences/inhibitions, notification log, outbox. | Transactions (the outbox needs atomic instance+event writes), rich queries (due-rule scans, reconciliation joins), and `FOR UPDATE SKIP LOCKED` for safe concurrent claims. |
| **Redis Streams** | Hot path: eval jobs, events, group buffers, membership, lease. | Consumer groups give at-least-once delivery and automatic load-balancing; atomic Lua scripts implement the group buffer and membership; cheap, low-latency. |
| **ClickHouse** | The data alerts are evaluated against. | It's the query target; clickety-clack reads it, never writes it or manages its schema. |

## Scheduler sharding

With one scheduler this is trivial: it owns everything, and a dead one is replaced
by a standby within the heartbeat TTL. With several, the problem is "who schedules
which tenant" without a leader election.

The answer is **rendezvous (highest-random-weight) hashing**. Tenants map to
`CC_SCHEDULER_SHARDS` shards (by hashing the tenant). For each shard, every replica
independently computes `hash(node_id, shard)` for all live members and the highest
wins — so all replicas agree on ownership with zero coordination, just a shared
view of the live membership set (`cc:scheduler:members`, maintained by
heartbeats). When membership changes, only the affected shards move, and the brief
window where two replicas both think they own a shard is harmless because rule
claims use `FOR UPDATE SKIP LOCKED` plus the per-evaluation idempotency ledger.

This is "leaderless": no lock, no election, no split-brain to resolve — just a
deterministic function of (node id, shard, live members). The trade-off is that
the hash must be identical across replicas, so they must run the same binary
build.

## Multi-tenancy

Every rule, instance, receiver, route, silence, inhibition, and event carries a
`TenantId`. The API scopes by the `X-CC-Tenant` header; the dispatcher's filter
caches and the scheduler's sharding are per-tenant. Tenants are isolated by data,
not by process — one deployment serves many tenants.

## Process supervision

Every role task in a process runs under an in-process supervisor (`cc::supervisor`).
A role that exits before shutdown, whether it panicked, returned an error, or
returned cleanly when it should still be running, is logged at error level with
the role name and cause, and restarted with exponential backoff: 1s doubling per
consecutive rapid failure, capped at 60s. A run of 10 minutes or more counts as
stable and resets the counter.

The 5th consecutive rapid failure of the same role escalates: the supervisor logs
the failure, asks the surviving roles to shut down gracefully, and the process
exits nonzero so the orchestrator restarts the whole pod. A role that cannot
recover in-process takes the process down honestly instead of leaving a zombie
that reports healthy with a dead worker inside.

Shutdown stays clean: roles, the signal handler, and the supervisor share one
shutdown watch channel, so task exits after a shutdown request are drained as
expected completions, not failures. The evaluator additionally isolates each
consume batch with a panic guard, so one poisonous batch is logged and counted
(`cc.eval.errors` with `kind=batch_panic`) without killing the consume loop.

Readiness reflects supervision: `/readyz` returns 503 with `degraded: <roles>`
while any role in the api process is down or waiting out a restart backoff;
`/healthz` (liveness) stays unconditional so the pod is not killed while the
supervisor is already handling the failure.

What ops should alert on:

- `role task exited unexpectedly` (error) - a role crashed; one is noise, a
  burst means a dependency or bug is hurting that role.
- `role failed repeatedly; escalating` (error) - the process is about to exit
  nonzero; expect a pod restart. Repeated escalations mean the failure is not
  transient.
- `/readyz` returning 503 for more than a backoff interval or two.
- A rising `cc.eval.errors` rate with `kind=batch_panic`.

## What's deliberately not here (yet)

- **No metrics endpoint** — observability is via the datastores (see
  [operate at scale](../how-to/operate-at-scale.md#what-to-monitor)).
- **No Kafka** — but the queue layer is abstracted (opaque ids, a
  backend-contract test) so a Kafka backend can replace Redis Streams
  without touching the roles.
- **No cache-invalidation pub/sub** — silence/inhibition/routing changes propagate
  via short TTL caches (~2s) rather than push invalidation.

## Further reading

- [The evaluation model](evaluation-model.md) — how SQL rows become firing state.
- [The dispatch pipeline](dispatch-pipeline.md) — how an event becomes a notification.
- [Durability and delivery](durability-and-delivery.md) — the guarantees and how
  they're achieved.
- [Security model](security-model.md) — secret encryption at rest.
