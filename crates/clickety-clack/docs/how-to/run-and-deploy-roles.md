# How to run and deploy the roles

clickety-clack is a single binary (`cc`) whose behavior is selected by `CC_ROLE`.
This guide covers building it, running it for development, replicating it for
production availability, and (when a bottleneck calls for it) splitting the roles
across processes.

## Build

```bash
cargo build            # debug → target/debug/cc
cargo build --release  # optimized → target/release/cc
```

The repo pins Rust 1.94.1 via `rust-toolchain.toml`; `rustup` will fetch it
automatically.

## Run everything in one process (development)

```bash
# Required: a secret key (the process is fail-closed without one)
export CC_SECRET_KEYS="dev:$(head -c 32 /dev/urandom | base64)"
export CC_SECRET_ACTIVE_KEY="dev"

CC_ROLE=all cargo run
```

`all` runs the api, scheduler, evaluator, dispatcher, and (when the trusted OTLP
vars are set) events roles in one process. It connects to Postgres (and runs
migrations), Redis, and ClickHouse using the
[default connection strings](../reference/configuration.md#datastores) unless you
override them.

## Deploy for production: replicate `all`

The recommended production shape is **two or more identical `role=all` replicas**
behind a load balancer:

```bash
# Every replica gets the same environment except CC_NODE_ID:
export CC_PG_URL=postgres://…  CC_REDIS_URL=redis://…  CC_CH_URL=http://…
export CC_SECRET_PROVIDER=env  CC_SECRET_KEYS=v1:…  CC_SECRET_ACTIVE_KEY=v1
export CC_API_KEYS=…                       # the api role fails closed without keys
export CC_CH_USER=cc_eval CC_CH_PASSWORD=… # hardened user; `default` is refused

CC_ROLE=all CC_NODE_ID=cc-1 ./cc     # replica 1
CC_ROLE=all CC_NODE_ID=cc-2 ./cc     # replica 2
```

This gives you what actually matters first: no monitoring blackout during
deploys or crashes. All coordination happens through Postgres and Redis (there
is no RPC between roles), and every coordination primitive behaves identically
whether roles share a process or not: scheduler replicas partition tenants and
fail over automatically, evaluators and dispatchers load-balance through their
consumer groups, and duplicate processing is safe by design (see
[durability](../explanation/durability-and-delivery.md)). An alerting engine's
workload is small relative to its importance; even thousands of rules on
1-minute intervals is tens of evaluations per second, well within one process.

## Split roles when a bottleneck shows

Because `CC_ROLE` is just a flag, peeling a role into its own deployment later is
a config change, not a rewrite. Do it when a signal tells you to, not upfront.
Typical triggers: sustained `cc:events` queue growth or slow third-party webhook
endpoints starving other work (peel off `dispatcher`), evaluation latency from
ClickHouse contention (peel off and scale `evaluator`), or wanting the trusted
export credentials confined to one process (peel off `events`).

```bash
# Shared environment for every process:
export CC_PG_URL=postgres://…  CC_REDIS_URL=redis://…  CC_CH_URL=http://…
export CC_SECRET_PROVIDER=env  CC_SECRET_KEYS=v1:…  CC_SECRET_ACTIVE_KEY=v1
export CC_API_KEYS=…                       # the api role fails closed without keys
export CC_CH_USER=cc_eval CC_CH_PASSWORD=… # hardened user; `default` is refused

# API (front it with your load balancer on CC_HTTP_ADDR):
CC_ROLE=api        CC_NODE_ID=api-1        ./cc

# Scheduler (see "Scaling" below for replicas):
CC_ROLE=scheduler  CC_NODE_ID=sched-1      ./cc

# Evaluator (also runs the maintenance loop):
CC_ROLE=evaluator  CC_NODE_ID=eval-1       ./cc

# Dispatcher (set CC_SMTP_* if you use email receivers):
CC_ROLE=dispatcher CC_NODE_ID=disp-1       ./cc

# Events (alert-log export; needs CC_TRUSTED_OTLP_ENDPOINT + CC_TRUSTED_INGEST_SECRET):
CC_ROLE=events     CC_NODE_ID=events-1     ./cc
```

A `role=all` deployment can also run alongside split-out roles during a
transition; the coordination primitives are the same either way.

> **`CC_NODE_ID` must be unique per process.** It is the scheduler membership
> identity and the stream consumer name. Two processes sharing a node id will
> corrupt membership/consumer-group bookkeeping. Use the pod/host name.

### Which role needs what

| Role        | Postgres | Redis | ClickHouse | SMTP | Trusted OTLP |
| ----------- | :------: | :---: | :--------: | :--: | :----------: |
| `api`       | ✅       |       | ✅         |      |      |
| `scheduler` | ✅       | ✅    |            |      |      |
| `evaluator` | ✅       | ✅    | ✅         |      |      |
| `dispatcher`| ✅       | ✅    |            | ✅ (if email) | ✅ (if set) |
| `events`    | ✅       | ✅    |            |      | ✅   |

Every process connects to Postgres and runs migrations at startup regardless of
role, so Postgres must be reachable even for roles (like `events`) whose steady
state never queries it. Likewise all roles build the cipher at startup, so all
of them need the [secret env vars](manage-secret-encryption.md) even though
only `api`, `dispatcher`, and `evaluator` actually read/write secrets.

## Scaling each role

| Role        | How to scale | Coordination |
| ----------- | ------------ | ------------ |
| `api`       | Run N replicas behind a load balancer. Stateless; any replica can serve any request. | none needed |
| `scheduler` | Run N replicas and set `CC_SCHEDULER_SHARDS` ≥ N. Tenants are partitioned across replicas by rendezvous hashing; a dead replica's shards are reassigned within the heartbeat TTL. With shards=1 it is an auto-failover singleton. | `cc:scheduler:members` |
| `evaluator` | Run N replicas; they share the `evaluators` consumer group on `cc:eval:jobs`, so jobs load-balance automatically. The maintenance loop self-elects via a single lease, so only one evaluator runs it at a time. | consumer group + `cc:maintenance:lease` |
| `dispatcher`| Run N replicas; they share the `dispatchers` consumer group on `cc:events`. The group flusher runs on every replica and claims due groups atomically. | consumer group + atomic Redis claims |
| `events`    | Run N replicas; they compete on the `cc:logexport` consumer group (an independent group on the same stream, so log export never steals dispatcher deliveries). | consumer group |

See [Operate at scale](operate-at-scale.md) for the scheduler-sharding details and
[durability](../explanation/durability-and-delivery.md) for why duplicate
processing is safe.

## Rolling upgrades: SLO awareness on the dispatcher

The dispatcher's SLO-aware behavior: the synthetic `slo` label, the auto-
provisioned tier inhibitions that stop a burn from paging on all three tiers
at once, and the `slo`-first default `group_by` for SLO events: all depend on
the dispatcher binary knowing about an event's `slo` field. During a rolling
upgrade where evaluator and dispatcher replicas are on mixed versions, a
**previous-version dispatcher replica simply doesn't know the field exists**:
it deserializes the event fine (unknown/absent fields don't break
deserialization) but treats every SLO tier-firing event exactly like a rule
event:

- no synthetic `slo` label is added, so route/silence/inhibition matchers on
  `slo` never match against it there;
- no tier inhibition is synthesized, so a burn that breaches `fast-burn`,
  `slow-burn`, and `ticket` together can page for all three instead of just
  the fastest;
- grouping falls back to the ordinary `["rule","severity"]` default instead of
  the SLO's `["slo", ...group labels]` default (an explicit route `group_by`
  is unaffected either way).

None of this corrupts state: it's a temporary loss of the SLO-specific
notification shaping, not a data-loss or evaluation-correctness issue, and it
self-resolves as soon as that replica is upgraded.

If you're enabling SLOs with paging tiers for the first time on an existing
deployment, **upgrade (or bounce) every dispatcher replica before creating
paging SLOs**, or accept that any tier breach during the mixed-version window
may arrive as several duplicate-looking tier pages instead of one deduplicated
notification.

## Graceful shutdown

Each process installs a signal handler for Ctrl-C / SIGINT and SIGTERM that
signals all its background loops to stop and waits for them to drain before
exiting. Send SIGINT or SIGTERM (an orchestrator's normal stop signal), not
SIGKILL, for clean shutdown.

## Health checks

The `api` role exposes `GET /healthz` (liveness) and `GET /readyz` (readiness),
with no auth. `/healthz` always returns `ok`; `/readyz` returns `ok` only while
every supervised role in the process is running, and 503 `degraded: <roles>`
while any is down or waiting out a restart backoff. Point your orchestrator's
probes at these. The
non-api roles have no HTTP surface; supervise them by process liveness and by
watching their work (queue depth, lease ownership): see
[Operate at scale](operate-at-scale.md#what-to-monitor).
