# How to run and deploy the roles

clickety-clack is a single binary (`cc`) whose behavior is selected by `CC_ROLE`.
This guide covers building it, running it for development, and splitting the roles
across processes for production.

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

`all` runs the api, scheduler, evaluator, and dispatcher in one process. It
connects to Postgres (and runs migrations), Redis, and ClickHouse using the
[default connection strings](../reference/configuration.md#datastores) unless you
override them.

## Run the roles separately (production)

In production, run each role as its own deployment so you can scale them
independently. They coordinate entirely through Postgres and Redis — there is no
direct RPC between roles.

```bash
# Shared environment for every process:
export CC_PG_URL=postgres://…  CC_REDIS_URL=redis://…  CC_CH_URL=http://…
export CC_SECRET_PROVIDER=env  CC_SECRET_KEYS=v1:…  CC_SECRET_ACTIVE_KEY=v1

# API (front it with your load balancer on CC_HTTP_ADDR):
CC_ROLE=api        CC_NODE_ID=api-1        ./cc

# Scheduler (see "Scaling" below for replicas):
CC_ROLE=scheduler  CC_NODE_ID=sched-1      ./cc

# Evaluator (also runs the maintenance loop):
CC_ROLE=evaluator  CC_NODE_ID=eval-1       ./cc

# Dispatcher (set CC_SMTP_* if you use email receivers):
CC_ROLE=dispatcher CC_NODE_ID=disp-1       ./cc
```

> **`CC_NODE_ID` must be unique per process.** It is the scheduler membership
> identity and the stream consumer name. Two processes sharing a node id will
> corrupt membership/consumer-group bookkeeping. Use the pod/host name.

### Which role needs what

| Role        | Postgres | Redis | ClickHouse | SMTP |
| ----------- | :------: | :---: | :--------: | :--: |
| `api`       | ✅       | ✅    | ✅         |      |
| `scheduler` | ✅       | ✅    |            |      |
| `evaluator` | ✅       | ✅    | ✅         |      |
| `dispatcher`| ✅       | ✅    |            | ✅ (if email) |

All roles build the cipher at startup, so all of them need the
[secret env vars](manage-secret-encryption.md) even though only `api`,
`dispatcher`, and `evaluator` actually read/write secrets.

## Scaling each role

| Role        | How to scale | Coordination |
| ----------- | ------------ | ------------ |
| `api`       | Run N replicas behind a load balancer. Stateless; any replica can serve any request. | none needed |
| `scheduler` | Run N replicas and set `CC_SCHEDULER_SHARDS` ≥ N. Tenants are partitioned across replicas by rendezvous hashing; a dead replica's shards are reassigned within the heartbeat TTL. With shards=1 it is an auto-failover singleton. | `cc:scheduler:members` |
| `evaluator` | Run N replicas; they share the `evaluators` consumer group on `cc:eval:jobs`, so jobs load-balance automatically. The maintenance loop self-elects via a single lease, so only one evaluator runs it at a time. | consumer group + `cc:maintenance:lease` |
| `dispatcher`| Run N replicas; they share the `dispatchers` consumer group on `cc:events`. The group flusher runs on every replica and claims due groups atomically. | consumer group + atomic Redis claims |

See [Operate at scale](operate-at-scale.md) for the scheduler-sharding details and
[durability](../explanation/durability-and-delivery.md) for why duplicate
processing is safe.

## Graceful shutdown

Each process installs a Ctrl-C / SIGINT handler that signals all its background
loops to stop and waits for them to drain before exiting. Send SIGINT (not
SIGKILL) for clean shutdown.

## Health checks

The `api` role exposes `GET /healthz` (liveness) and `GET /readyz` (readiness),
both returning `ok` with no auth. Point your orchestrator's probes at these. The
non-api roles have no HTTP surface; supervise them by process liveness and by
watching their work (queue depth, lease ownership) — see
[Operate at scale](operate-at-scale.md#what-to-monitor).
