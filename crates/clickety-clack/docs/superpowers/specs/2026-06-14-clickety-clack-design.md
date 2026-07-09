# clickety-clack — Alerting System Design

**Date:** 2026-06-14
**Status:** Approved design, pending implementation plan
**Component:** `clickety-clack` — headless alerting engine for the everr ecosystem

## Summary

`clickety-clack` is a headless, HTTP-managed alerting system written in Rust. It
evaluates user-defined alert rules expressed as raw ClickHouse SQL, maintains
authoritative per-instance alert state, and dispatches notifications to external
channels. It targets a large multi-tenant SaaS deployment and is engineered for
extreme performance, correctness, and both horizontal and vertical scalability.

It is functionally a Prometheus-class evaluation engine plus an
Alertmanager-class dispatch pipeline, built directly on top of the ClickHouse
where the everr ecosystem stores OpenTelemetry data.

## Goals

- **Correctness first:** never miss a real alert; never emit a false "all-clear";
  bounded, rare notification duplicates rather than silent drops.
- **Extreme performance & scalability:** horizontal (add replicas) and vertical
  (efficient Rust async, protect the shared ClickHouse).
- **Headless:** all management via stable, versioned HTTP APIs. No UI.
- **Multi-tenant:** strong tenant isolation and fair scheduling.

## Non-Goals (v1)

- No built-in dashboards/UI — visualization is a consumer concern.
- No anomaly/ML-based detection — fixed-condition (threshold/row-presence) only.
  Anomaly detection is a possible later phase.
- No bespoke RPC-per-workflow — consumers compose the generic HTTP API.

## Core Decisions

| Decision | Choice |
|---|---|
| Rule definition | Raw ClickHouse SQL |
| Firing model | Each result row = one labeled alert instance |
| Scope | State engine **and** notification dispatch |
| Scale / tenancy | Multi-tenant SaaS, large |
| Control-plane state | PostgreSQL (durable truth) + Redis (hot path) |
| Distribution | Scheduler → work queue → stateless workers |
| Queue transport | Redis Streams now, swappable to Kafka via a `Queue` trait |
| Process topology | Single binary, role-selectable (`api`/`scheduler`/`evaluator`/`dispatcher`) |
| v1 dispatch features | for-duration, grouping+dedup, silences+inhibition, multi-channel routing |

ClickHouse holds the observability data being queried. It is **not** used for
control-plane state — it lacks the transactions/upserts needed to get state
transitions, dedup, and notification bookkeeping correct.

## Architecture

### Topology

One Rust workspace, one binary, four roles selected at startup. In production
each role scales as its own replica set; in local/CI all roles run in one
process.

```
                    ┌─────────────┐     ┌──────────────┐
   consumers ──────▶│  api (N)    │────▶│  PostgreSQL  │  durable truth:
   (HTTP)           │  stateless  │◀────│              │  rules, instances,
                    └─────────────┘     │              │  silences, routes,
                          ▲             │              │  notif log
                          │             └──────────────┘
                          │                    ▲ ▲
                    ┌─────────────┐            │ │        ┌──────────────┐
                    │ scheduler   │────────────┘ │        │    Redis     │
                    │ (singleton  │──────────────┼───────▶│ streams +    │
                    │  per shard) │  enqueue due │        │ leases +     │
                    └─────────────┘  evaluations │        │ dedup TTL    │
                                                 │        └──────────────┘
                    ┌─────────────┐              │              ▲
                    │ evaluator   │──────────────┘              │
   ClickHouse ◀─────│   (N)       │  read instance state,       │
   (query data)     │  stateless  │  write transitions,         │
                    └─────────────┘  emit firing/resolved ──────┘
                          (events stream)                       │
                    ┌─────────────┐                             │
   Slack/email ◀────│ dispatcher  │◀────────────────────────────┘
   PagerDuty/web    │   (N)       │  group, dedup, silence,
                    │  stateless  │  inhibit, route, deliver, retry
                    └─────────────┘
```

### Roles

- **api** — HTTP surface for consumers. CRUD on rules, routes/channels,
  silences, inhibitions, subscriptions; read alert state. Stateless. Validates
  SQL rules (parse, read-only enforcement, tenant + time-window injection,
  `EXPLAIN`/dry-run cost estimate). Writes config to Postgres.

- **scheduler** — Computes which rules are *due* and enqueues evaluation jobs
  onto the Redis Stream. Runs as a **singleton per shard** via a Redis/Postgres
  lease (leader election). Shards partition the tenant space so the scheduler
  tier scales and has no single point of failure. Enforces fair scheduling
  (per-tenant quotas / weighted round-robin) and adds jitter to avoid
  thundering-herd on ClickHouse.

- **evaluator** — Stateless worker pool. Pulls jobs (Redis consumer group →
  at-least-once), runs the rule SQL against ClickHouse, diffs result rows
  against current instance state in Postgres, applies the for-duration state
  machine, persists transitions, and emits `firing`/`resolved` events to the
  events stream. Idempotent per `(rule_id, eval_ts)`.

- **dispatcher** — Stateless worker pool. Consumes firing/resolved events and
  applies **silence → inhibition → grouping → dedup → routing → delivery**,
  delivering to channels with per-channel retry/backoff. Records delivery in the
  Postgres notification log for at-least-once-with-dedup semantics.

### Shared crates

- `domain` — core types: `Rule`, `Instance`, `Silence`, `InhibitionRule`,
  `Route`, `Receiver`, `Event`.
- `queue` — the swappable `Queue` trait + Redis Streams implementation.
- `stores` — Postgres (`sqlx`) + Redis access layers.
- `clickhouse` — query client with guards, limits, pooling.
- `sqlguard` — rule SQL validation and rewriting.
- `dispatch` — silence/inhibition/grouping/dedup/routing/delivery modules.

## Evaluation Lifecycle & State Machine

A rule carries: `sql`, `interval`, `for` duration, `label_columns` (identity),
optional `value_column`, `severity`, `annotations`, optional `group_by`.

### Job execution (evaluator)

1. Pull job `{rule_id, eval_ts, tenant}` from the stream (consumer group,
   at-least-once).
2. **Idempotency guard:** the unit of truth is `(rule_id, eval_ts)`. Claim it
   (Postgres upsert into `evaluations` with a unique key, or Redis SETNX) before
   doing work. A redelivered already-applied job is a no-op.
3. Run the rule SQL via the ClickHouse client. `sqlguard` has already (at create
   time) verified it is read-only and wrapped it: tenant predicate injected, a
   bounded time window enforced, `max_execution_time` / `max_rows_to_read` /
   `max_memory_usage` set, and the query tagged to run on a **read-only CH
   user/quota** isolated from ingestion.
4. Each returned row → an **instance key** = `hash(rule_id, label columns)`. The
   set of keys in the result is the "currently-true" set.

### Per-instance state machine (Postgres, keyed by instance key)

```
            row present              held ≥ `for`
  inactive ─────────────▶ pending ──────────────▶ firing
     ▲                      │ row absent             │ row absent
     │                      ▼                        ▼
     └──────────────────── inactive ◀──────────── resolved
```

- **inactive → pending:** first evaluation where the row appears. Record
  `active_since = eval_ts`.
- **pending → firing:** row still present and `eval_ts - active_since ≥ for`.
  Emit a `firing` event. (`for = 0` fires immediately.)
- **firing → resolved:** row absent. Emit a `resolved` event.
- **pending → inactive:** row absent while still pending — silently drop (never
  fired, nothing to resolve).
- To absorb a single flaky evaluation, resolution can require absence for **K
  consecutive evaluations** (configurable, default 1).
- Each evaluation refreshes `value`, `last_seen`, and annotations.

**Resolution by absence:** when the underlying condition clears, the row
disappears and the instance auto-resolves — no separate all-clear query.

### Correctness under failure

- **At-least-once + idempotent** `(rule_id, eval_ts)` claim → redeliveries are
  safe.
- **Missed evaluations** (worker crash, CH timeout): the job NACKs/expires and is
  redelivered; the scheduler also detects a stale `last_eval` and re-enqueues.
  Evaluations use **at-`eval_ts` semantics**, not "now," so a late evaluation
  still computes the right window.
- **CH query failure/timeout:** the evaluation is marked errored (surfaced via
  API + meta-alert); **state is not changed** — never resolve an alert because a
  query failed.
- **Clock source:** `eval_ts` and `for` use the scheduler-assigned evaluation
  timestamp (logical clock), not worker wall-clock, so distributed workers agree
  and replays are deterministic. `for` is measured by timestamps, not eval
  count, so scheduler gaps don't prematurely fire or resolve.

## Dispatch Pipeline

The dispatcher consumes `firing`/`resolved` events. Stages run in order; each is
an independent, testable module in the `dispatch` crate. The pipeline never
touches ClickHouse — dispatch load is fully decoupled from query load.

1. **Ingest & normalize.** Pull event (consumer group). Event carries
   `{tenant, rule_id, instance_key, labels, value, severity, status, eval_ts,
   annotations}`.
2. **Silence filter.** Drop if the event matches an active silence (label
   matchers `=`/`!=`/regex + time window + tenant). Matchers are compiled and
   cached in-memory, invalidated via Redis pub/sub on change → O(matchers), no
   per-event Postgres hit.
3. **Inhibition filter.** Suppress if a higher-priority alert matching an
   inhibition rule (`{source matchers, target matchers, equal labels}`) is
   currently firing. "Is a source firing?" answered from firing-instance state
   (Postgres + Redis hot cache) — no extra ClickHouse load.
4. **Grouping.** Group events by configurable `group_by` (default
   `tenant + rule + severity`). Hold `group_wait` (e.g. 5–30s) to batch a burst
   into one notification; `group_interval` between subsequent notifications for
   the same group. Group timers live in a Redis sorted-set of due flushes, so any
   dispatcher replica can flush — no sticky ownership.
5. **Dedup.** `dedup_key = hash(group_key, channel, fingerprint-of-active-set)`.
   A Redis key with TTL prevents re-sending an identical notification within a
   window; the Postgres notification log is the durable record →
   **at-least-once delivery with dedup**.
6. **Routing.** An Alertmanager-style routing tree matches group labels to one or
   more **receivers**; each receiver binds a channel config. Supports `continue`
   (match multiple) and per-route overrides of `group_by`/`group_wait`/timing.
7. **Delivery & retry.** Each channel implements a `Notifier` trait
   (`async send(Notification) -> Result`). Bounded exponential backoff + jitter;
   permanent failures (4xx) → dead-letter stream + API surface; transient
   (5xx/timeout) retry. Every attempt is written to the notification log
   (`pending → sent → failed`) for audit and idempotency.

**Resolved events** flow through the same pipeline so consumers get resolved
notifications (and to clear PagerDuty incidents).

**Channels v1:** Slack, email (SMTP), PagerDuty, generic webhook. The `Notifier`
trait makes new channels additive.

## HTTP API Surface

JSON over HTTP (`axum`). All routes tenant-scoped via auth; consumers never pass
tenant IDs in the body. The api role is stateless behind a load balancer.

### Auth & tenancy

Reuse the everr ecosystem auth (bearer/JWT or service tokens) → resolves to
`tenant_id` + scopes. Every query and write is tenant-filtered at the store
layer; `sqlguard` tenant-predicate injection means even a rule's raw SQL cannot
read across tenants.

### Resources (CRUD unless noted)

| Resource | Routes | Notes |
|---|---|---|
| **Rules** | `POST/GET/PATCH/DELETE /v1/rules`, `GET /v1/rules/{id}` | Body: `sql`, `interval`, `for`, `label_columns`, `value_column`, `severity`, `annotations`, `group_by?`. Create/PATCH runs validation (read-only check, `EXPLAIN`/dry-run, cost estimate); 422 with diagnostics on failure. |
| **Alert state** | `GET /v1/alerts` (filter rule/label/status/severity), `GET /v1/alerts/{instance_key}` | status, `active_since`, `value`, `last_eval`, last error. |
| **Silences** | `POST/GET/DELETE /v1/silences` | Matchers + window + comment/author. |
| **Inhibition rules** | `POST/GET/DELETE /v1/inhibitions` | source/target matchers + equal labels. |
| **Routes & receivers** | `…/v1/routes`, `…/v1/receivers` | Routing tree + channel configs (secrets encrypted, write-only). |
| **Subscriptions** | `POST /v1/subscriptions` (register webhook), `GET /v1/events/stream` (SSE) | Firing/resolved pushed (webhook + retries) or tailed via SSE. |
| **Ops** | `GET /v1/rules/{id}/evaluations`, `POST /v1/rules/{id}/test`, `GET /healthz`, `GET /readyz` | `test` = ad-hoc evaluate now, no state change ("try before save"). |

### Cross-cutting conventions

- **Idempotency:** mutating POSTs accept `Idempotency-Key` (stored, deduped).
- **Optimistic concurrency:** rules/routes carry a `version`; PATCH uses
  `If-Match`/ETag to prevent lost updates.
- **Pagination:** cursor-based (`limit` + opaque `cursor`) on all lists.
- **Versioned + stable:** `/v1` prefix; additive evolution. OpenAPI spec
  generated from types so consumers (and agents) get a typed contract.
- **Errors:** RFC 9457 `application/problem+json` with machine-readable codes and
  field-level validation detail.

## Scalability & Performance

### Horizontal

- Every role except scheduler-per-shard is stateless → scale by adding replicas.
  Evaluators and dispatchers are pulled by Redis consumer groups (automatic work
  balancing + backpressure).
- **Tenant sharding:** the tenant space is partitioned into shards (hash ring);
  each shard has one active scheduler via lease. Add shards to scale the
  scheduler tier. Workers are shard-agnostic (pull from shared streams), so they
  scale independently of shard count.
- **Queue is swappable:** the `Queue` trait lets us move Redis Streams →
  Kafka/Redpanda when per-stream throughput becomes the ceiling, without touching
  evaluation/dispatch logic.

### Vertical

- Rust + async (`tokio`); ClickHouse access over native protocol with connection
  pooling.
- **Protect ClickHouse** (the shared bottleneck): rule queries run on an isolated
  read-only CH user with enforced `max_execution_time`/`max_rows`/`max_memory`;
  the evaluator caps in-flight CH queries (semaphore) and applies per-tenant
  concurrency quotas; identical-query coalescing where rules overlap.
- Hot-path caches (silences, inhibitions, routing tree, firing-set) in-memory
  with Redis pub/sub invalidation → dispatch does zero DB round-trips per event
  in the common case.

## Reliability & Correctness

- At-least-once everywhere + idempotency keys (`rule_id+eval_ts` for eval;
  `dedup_key` for notifications) → no missed alerts, bounded/rare duplicates.
- Query failure never mutates alert state (no false all-clear).
- **Meta-alerting:** evaluation errors, queue lag, scheduler lease loss, and
  delivery dead-letters are themselves observable and alertable.
- Graceful shutdown: drain in-flight jobs, release leases, ack/nack cleanly.

## Observability

The service is OpenTelemetry-instrumented end to end — spans for the eval and
dispatch pipelines, metrics for queue depth / eval latency / CH query time /
delivery success, structured logs. Its own telemetry can feed back into
clickety-clack (dogfooding everr).

## Testing Strategy

- **Unit (TDD):** state machine (every transition incl. flap/`for`/gap edges),
  `sqlguard` rewriting, silence/inhibition matchers, routing tree, dedup — pure
  functions, exhaustively tested.
- **Property-based (`proptest`):** state machine (random row-presence sequences
  never produce a fire-without-resolve or stuck state) and dedup invariants.
- **Integration (`testcontainers`):** real Postgres + Redis + ClickHouse; full
  rule → evaluation → event → delivery path with a mock `Notifier`.
- **Concurrency/correctness:** multi-worker redelivery and at-least-once tests
  (kill a worker mid-job, assert no missed/duplicate transition); scheduler
  failover (lease handoff).
- **Load:** synthetic N-tenant × M-rule harness validating fair scheduling and CH
  protection under burst.

## Implementation Phasing

The full design above is intact. Recommended phasing to de-risk delivery (collapse
if a single big-bang v1 is preferred):

- **Phase 1 — Evaluation engine & state.** `api` (rules CRUD + validation +
  `test`), `scheduler` (single shard), `evaluator`, the for-duration state
  machine, raw firing/resolved exposed via webhook subscriptions + SSE. Postgres
  + Redis Streams. No grouping/silencing yet.
- **Phase 2 — Dispatch core.** `dispatcher` with grouping + dedup + routing tree
  + receivers; channels: Slack, email, PagerDuty, generic webhook; delivery
  retry + notification log.
- **Phase 3 — Advanced correctness & scale.** Silences + inhibition; tenant
  sharding for the scheduler tier; Kafka-ready `Queue` implementation;
  identical-query coalescing; load-test hardening.

## Open Questions / Future Work

- Anomaly/ML-based detection as an additional rule type.
- Rule templating / shared rule libraries across a tenant.
- Backfill / "what would have fired" replay over historical ClickHouse data.
