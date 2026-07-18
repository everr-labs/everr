# Configuration reference

All configuration is via environment variables, read once at startup by
`Config::from_env()` (`src/config.rs`). There is no config file. Unknown
variables are ignored; the variables below are the complete set the binary reads.

## Core

| Variable        | Default                                                      | Purpose |
| --------------- | ----------------------------------------------------------- | ------- |
| `CC_ROLE`       | `all`                                                        | Which role(s) this process runs: `api`, `scheduler`, `evaluator`, `dispatcher`, or `all`. See [roles](#roles). |
| `CC_HTTP_ADDR`  | `0.0.0.0:8080`                                               | Listen address for the HTTP API (only used by the `api` role). |
| `CC_NODE_ID`    | `node-1`                                                     | Unique identifier for this process. Used as the scheduler membership ID and as the evaluator/dispatcher consumer name. **Must be unique per replica.** |

## HTTP API authentication

| Variable      | Default  | Purpose |
| ------------- | -------- | ------- |
| `CC_API_KEYS` | *(none)* | Comma-separated static bearer keys gating every `/v1` endpoint; `/healthz` and `/readyz` stay open. Clients send `Authorization: Bearer <key>`; keys are compared in constant time. List two keys during rotation, then drop the old one. **Unset => the gate is off and `/v1` is open** (dev default). Any network-reachable deployment must set this: without it, anyone who can reach the port can assert any tenant via `X-CC-Tenant`. Only the `api` role reads it. |
| `CC_ALLOW_PRIVATE_WEBHOOKS` | `0` | Set to `1` (or `true`) to allow webhook URLs targeting private, loopback, or link-local IP literals and `localhost` (subscriptions and `webhook` receivers). Dev/compose escape hatch only, for targets like a local mailpit; never set it in a multi-tenant deployment. Structural rules (http/https scheme, no userinfo) always apply. Only the `api` role reads it. |

Each `CC_API_KEYS` entry is either a plain key or a tenant-bound key of the
form `<key>@<tenant-id>` (split at the last `@`; tenant ids cannot contain
`@`). A plain key may act as any tenant via `X-CC-Tenant`. A bound key acts as
exactly its tenant: the request's tenant is derived from the key, and an
`X-CC-Tenant` header, if also sent, must match or the request gets `401`. The
two forms can be mixed in one list, e.g.
`CC_API_KEYS=everr-backend-key, tenant-a-key@tenant-a`. A bound entry with an
invalid tenant id is dropped with an error log and can never match; the gate
stays enabled, so a typo fails closed instead of widening access.

See [HTTP API reference → Authentication](http-api.md#authentication) for the
request-side contract.

## Datastores

| Variable         | Default                                                       | Purpose |
| ---------------- | ------------------------------------------------------------ | ------- |
| `CC_PG_URL`      | `postgres://postgres:postgres@127.0.0.1:5432/postgres`       | PostgreSQL connection string. Durable state + migrations. |
| `CC_REDIS_URL`   | `redis://127.0.0.1:6379`                                     | Redis connection string. Streams, groups, membership, lease. |
| `CC_CH_URL`      | `http://127.0.0.1:8123`                                      | ClickHouse HTTP endpoint queried by the evaluator. |
| `CC_CH_USER`     | `default`                                                    | ClickHouse user. Used as-is in `shared` auth mode (see below). |
| `CC_CH_PASSWORD` | `` (empty)                                                   | ClickHouse password. Used as-is in `shared` auth mode (see below). |

### Per-tenant ClickHouse authentication

By default clickety-clack authenticates to ClickHouse with a single
`CC_CH_USER`/`CC_CH_PASSWORD` shared by all tenants. `CC_CH_AUTH_MODE` lets each
tenant instead authenticate as its **own** ClickHouse user, so the
least-privilege grants and (optional) row policies from
[Harden ClickHouse access](../how-to/harden-clickhouse-access.md) become a
per-tenant isolation boundary.

In `derived` and `map` modes the auth provider is built **fail-closed at
startup**: if a required variable is missing or invalid (no master key, an
unparseable or empty tenant map, etc.) the process exits immediately with a
clear error rather than starting with broken auth. `shared` mode is the default
and preserves the existing single-user behavior.

| Variable                | Default      | Purpose |
| ----------------------- | ------------ | ------- |
| `CC_CH_AUTH_MODE`       | `shared`     | How clickety-clack authenticates to ClickHouse per tenant. One of `shared`, `derived`, or `map`. `shared`: all tenants use the single `CC_CH_USER`/`CC_CH_PASSWORD` (the pre-existing behavior; no per-tenant isolation). `derived`: each tenant authenticates as its own ClickHouse user with a password derived from a shared master key. `map`: explicit per-tenant credentials from a JSON map. |
| `CC_CH_USER_TEMPLATE`   | *(none)*     | **Required in `derived` mode.** Per-tenant username template; `{tenant}` is substituted with the tenant id. Example: `sql_api_org_{tenant}`. |
| `CC_CH_MASTER_KEY`      | *(none)*     | **Required in `derived` mode.** HMAC key from which each tenant's password is derived as `hex(HMAC-SHA256(master_key, tenant_id))` plus the suffix. **High-value secret** — it derives *every* tenant's password. Store it in a secret manager, never in the repo. |
| `CC_CH_PASSWORD_SUFFIX` | `` (empty)   | *(derived mode, optional)* String appended verbatim to every derived password. Use when a deployment requires a suffix to satisfy password-complexity rules. |
| `CC_CH_TENANT_MAP`      | *(none)*     | **Required in `map` mode.** Either inline JSON or a path to a JSON file mapping tenant id → credentials: `{"<tenant>": {"user": "...", "password": "..."}, ...}`. |

## Scheduler

| Variable                     | Default | Purpose |
| ---------------------------- | ------- | ------- |
| `CC_SCHEDULER_SHARDS`        | `1`     | Number of tenant shards. `1` = a single owning replica with automatic failover. Higher = tenants are spread across replicas by rendezvous hashing. **Clamped to a minimum of 1** (a `0` would silently disable all scheduling). |
| `CC_SCHEDULER_MEMBER_TTL_MS` | `10000` | Heartbeat retention window in milliseconds. A scheduler replica that has not heartbeated within this window is evicted from the membership set and its shards are reassigned. |

See [Operate at scale](../how-to/operate-at-scale.md) and
[architecture](../explanation/architecture.md#scheduler-sharding) for how these
interact.

## Rule health

| Variable                | Default | Purpose |
| ----------------------- | ------- | ------- |
| `CC_RULE_DEGRADE_AFTER` | `3`     | Consecutive evaluation-query failures before a rule is marked **degraded** and a `rule_health` notification fires. Recovery is always on the first success (not configurable). A value below `1` (or an unparseable one) falls back to the default `3`. |

See [Observe and respond to degraded rules](../how-to/observe-degraded-rules.md).

## SLO evaluation

| Variable                      | Default | Purpose |
| ------------------------------ | ------- | ------- |
| `CC_SLO_BASE_CADENCE_SECS`    | `30`    | Fixed scheduling cadence applied to every SLO (SLOs have no per-resource `interval_secs` like rules). Also the floor for each window's own refresh cadence (`max(base_cadence, window_secs / 12)`). A value below `1` (or an unparseable one) falls back to the default `30`. |
| `CC_SLO_BUDGET_REFRESH_SECS`  | `300`   | **Reserved, not yet read by any code path.** Parsed and clamped the same way as the cadence above (`>= 1`, else falls back to `300`) but has no effect today. |

SLO health (degraded/recovered) reuses `CC_RULE_DEGRADE_AFTER` — see
[Rule health](#rule-health) above — rather than a separate threshold. See
[define SLOs and burn-rate alerts](../how-to/define-slos-and-burn-rate-alerts.md#evaluation-cadence).

## Email (SMTP) — optional

The email channel is **disabled unless `CC_SMTP_HOST` is set**. When unset, the
dispatcher logs `email channel disabled` and email receivers cannot deliver.

| Variable          | Default            | Purpose |
| ----------------- | ------------------ | ------- |
| `CC_SMTP_HOST`    | *(none)*           | SMTP server hostname. Setting this **enables** the email channel. |
| `CC_SMTP_PORT`    | `25`               | SMTP port. |
| `CC_SMTP_FROM`    | `alerts@localhost` | `From:` address on outgoing mail. |
| `CC_SMTP_USER`    | *(none)*           | SMTP auth username (optional). |
| `CC_SMTP_PASSWORD`| *(none)*           | SMTP auth password (optional). |

> The current SMTP transport relays in plaintext (no STARTTLS). Treat it as
> trusted-network only until TLS lands.

## Secret encryption — required

clickety-clack encrypts delivery secrets at rest and is **fail-closed**: if the
cipher cannot be built from these variables, the process exits before serving any
role. See [Manage secret encryption](../how-to/manage-secret-encryption.md) for
task steps and [the security model](../explanation/security-model.md) for the
design.

| Variable               | Default | Purpose |
| ---------------------- | ------- | ------- |
| `CC_SECRET_PROVIDER`   | `env`   | Cipher provider: `env` (static versioned keys) or `kms` (envelope-encryption via a fake KMS that mirrors the real KMS data-key-wrap path). |
| `CC_SECRET_KEYS`       | *(none)* | **Required when provider is `env`.** Comma-separated `id:base64key` pairs. Each key is a base64-encoded **32-byte** (AES-256) key. Example: `v1:Base64Key==,v2:Base64Key==`. Whitespace around entries is trimmed. |
| `CC_SECRET_ACTIVE_KEY` | *(none)* | **Required when provider is `env`.** The key `id` (from `CC_SECRET_KEYS`) used to **encrypt new** secrets. All listed keys remain available for **decryption**, which is what makes rotation possible. |
| `CC_KMS_FAKE_ROOT_KEY` | *(none)* | **Required when provider is `kms`.** A base64-encoded **32-byte** root key used to wrap per-secret data keys. |

### Fail-closed error messages

These come from `build_cipher()` / the keyring constructors and cause the process
to exit at startup:

| Condition                                        | Error |
| ------------------------------------------------ | ----- |
| Provider is `env`, `CC_SECRET_KEYS` unset/empty  | `CC_SECRET_KEYS required for env provider` / `no keys configured` |
| `CC_SECRET_ACTIVE_KEY` not present in the keyring | `active key '<id>' not in keyring` |
| `CC_SECRET_PROVIDER` is not `env` or `kms`        | `unknown CC_SECRET_PROVIDER '<value>'` |
| Provider is `kms`, `CC_KMS_FAKE_ROOT_KEY` unset   | root-key required / invalid base64 |

## Engine telemetry and metrics (optional)

The engine can ship its own operational telemetry (traces plus the engine
metrics listed in [Monitor the engine](../how-to/monitor-the-engine.md)) over
OTLP/gRPC. Both variables must be set together; when either is unset the
process logs `engine telemetry disabled` at startup and every trace exporter
and metric instrument degrades to a no-op. This is the engine's *own*
telemetry, distinct from the trusted alert-log export
(`CC_TRUSTED_OTLP_ENDPOINT` / `CC_TRUSTED_INGEST_SECRET`) used by the `events`
role and the dispatcher.

| Variable                    | Default  | Purpose |
| --------------------------- | -------- | ------- |
| `CC_ENGINE_OTLP_ENDPOINT`   | *(none)* | Public OTLP **gRPC** endpoint that receives the engine's traces and metrics. |
| `CC_ENGINE_INGEST_API_KEY`  | *(none)* | Ingest API key sent as `Authorization: Bearer <key>` on every export. The receiving pipeline derives the destination tenant from the key. |

Metrics are exported on a 60 second interval by a background reader; a clean
shutdown flushes the final collection.

## Roles

`CC_ROLE` selects which background work this process performs. `all` runs every
role in one process (the development default). Each role and the infrastructure it
touches:

| Role        | Spawns                                                                 | Needs |
| ----------- | --------------------------------------------------------------------- | ----- |
| `api`       | HTTP API server                                                        | Postgres, Redis, ClickHouse |
| `scheduler` | The scheduling loop: heartbeat → compute owned shards → claim due rules → enqueue eval jobs | Postgres, Redis |
| `evaluator` | The evaluation loop (consume jobs → query ClickHouse → publish events) **and** the maintenance loop (outbox relay, reconciliation, silence GC) | Postgres, Redis, ClickHouse |
| `dispatcher`| The event-processing loop + the group flusher | Postgres, Redis, (+ SMTP if email receivers are used) |
| `all`       | All of the above in one process                                       | All of the above |

The cipher is built **before** any role logic, so a missing key fails every role,
including ones that never touch secrets.

## Things that are *not* environment-configurable

Several operational constants are compile-time, not env vars. They are documented
in [Tunables and defaults](tunables.md) (scheduler tick interval, claim batch
size, group flush poll interval, retry attempts/backoff, maintenance cadence,
cache TTLs, etc.).
