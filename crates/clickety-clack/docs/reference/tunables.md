# Tunables and defaults reference

Two kinds of knobs exist: **environment variables** (set at deploy time, listed in
[configuration](configuration.md)) and **compile-time constants** (baked into the
binary). This page is the complete table of the compile-time constants, so you
know the system's actual behavior without reading the source.

> These are not environment-configurable today. Changing them means editing the
> code and rebuilding. They are listed here because operating the system requires
> knowing them (e.g. "why did my alert take ~10s to deliver?" → group wait).

## Scheduler

| Constant                 | Value      | Effect |
| ------------------------ | ---------- | ------ |
| Tick interval            | 1 second   | How often the scheduler scans for due rules. |
| Claim batch size         | 500        | Max rules claimed per tick. |
| Member TTL               | env (`CC_SCHEDULER_MEMBER_TTL_MS`, default 10s) | Heartbeat window before a replica is evicted. |
| Shard count              | env (`CC_SCHEDULER_SHARDS`, default 1) | Tenant shard count. |

## Evaluator

| Constant            | Value         | Effect |
| ------------------- | ------------- | ------ |
| Consume batch       | 16 jobs       | Max eval jobs read per blocking poll. |
| Block timeout       | 2 seconds     | How long the consumer blocks waiting for jobs. |
| Query coalescing    | by signature  | Jobs sharing `{sql, label_columns, value_column}` run ClickHouse **once**; rows fan out to each rule. |

## Dispatcher

| Constant              | Value        | Effect |
| --------------------- | ------------ | ------ |
| Group flush poll      | 200 ms       | How often the flusher checks for due groups. |
| Group wait (default)  | 10 s         | Initial hold before a group's first delivery (per-route override: `group_wait_secs`). |
| Group interval (default) | 300 s     | Minimum spacing between a group's later deliveries (per-route override: `group_interval_secs`). |
| Default `group_by`    | `["rule","severity"]` | Grouping key when a route omits it. |
| Group TTL             | 7 days       | A group hash expires if untouched this long. |
| Max delivery attempts | 4            | Retries before an event is dead-lettered. |
| Retry backoff         | `50ms · 2^attempt`, capped at 5s | Deterministic exponential backoff between attempts (transient errors only). |
| Filter cache TTL      | 2 s          | How long a tenant's silence/inhibition/firing snapshot is cached per dispatcher replica. |
| Notification lease    | 120 s        | How long a `pending` notifications row is treated as held by its sender. Past this, another sender reclaims it. |
| Max notification claims | 3          | Reclaims of one notification before it is retired (marked failed and dead-lettered) instead of retried. |
| In-flight reflush backoff | 15 s     | Wait before reflushing a group whose notification another sender still holds. |
| Take-failure backoff  | 1 s          | Wait before retrying a claimed group whose Redis take failed. |
| Group claim lease     | 60 s         | Hold time on a claimed group before another flusher may reclaim it. |

### HTTP status → retry classification

| Channel    | 2xx | 4xx              | 429        | other 5xx/transport |
| ---------- | --- | ---------------- | ---------- | ------------------- |
| webhook    | ok  | permanent        | transient  | transient |
| slack      | ok  | permanent        | transient  | transient |
| telegram   | ok  | permanent        | transient  | transient |
| email      | ok  | permanent (bad/empty recipients, at build) | none | transient (SMTP errors) |

Permanent → not retried, goes straight to dead-letter after the attempt.
Transient → retried up to the max-attempts limit, then dead-lettered.

## Maintenance (outbox relay, reconciliation, silence GC)

| Constant               | Value      | Effect |
| ---------------------- | ---------- | ------ |
| Maintenance tick       | 5 s        | Cadence of the maintenance loop (relay + reconcile). |
| Lease TTL              | 10 s       | `cc:maintenance:lease` hold time; refreshed by the holder. |
| Outbox grace window    | 5 s        | Outbox rows older than this are eligible for relay republish. |
| Outbox relay batch     | 256        | Max outbox rows republished per tick. |
| Reconcile staleness    | `max(4 × interval_secs, 60s)` | An instance not seen for longer than this is auto-resolved (firing→synthetic Resolved). |
| Silence GC cadence     | 1 hour (wall-clock) | How often expired silences are collected, and how often the ledgers below are pruned; survives lease hand-offs. |
| Silence retention      | 24 hours after `ends_at` | When an expired silence is deleted. |
| Ledger retention       | 7 days     | Cutoff for the hourly prune of `evaluations`, `slo_evaluations` (by `eval_ts`) and `notifications` (by `updated_at`). All three are dedup/idempotency state with no reader past the window; alert history lives in the ClickHouse alert-log export. |

## Why these matter operationally

- **Delivery latency floor.** A routed alert is held for the group wait (default
  10s) before its first notification. If you need faster, lower `group_wait_secs`
  on the route, not these constants.
- **Resolve latency.** A crashed evaluator's firing alerts are auto-resolved by
  reconciliation only after `max(4 × interval_secs, 60s)` of silence, then on the
  next maintenance tick. Tighter `interval_secs` ⇒ faster auto-resolve.
- **At-least-once.** Streams redeliver; dedup (notifications log) and idempotency
  (evaluations ledger) absorb it. The retry/backoff and dead-letter constants
  bound how hard delivery tries before giving up.
