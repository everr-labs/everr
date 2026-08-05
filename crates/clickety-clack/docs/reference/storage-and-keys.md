# Storage reference: Postgres tables, Redis keys, migrations

This is the operator's map of where state lives. You should rarely touch these
directly, but knowing them is essential for debugging, capacity planning, and
incident response.

## PostgreSQL

Durable state. The schema is created and kept current by migrations the binary
runs itself at startup (see [migrations](#migrations)). Connection: `CC_PG_URL`.

| Table           | Key columns                                                            | Purpose |
| --------------- | --------------------------------------------------------------------- | ------- |
| `rules`         | `id` (uuid PK), `tenant`, `namespace`, `name`, `spec` (jsonb), `version`, `paused`, `next_eval`, `last_eval`, plus health columns (`health_status`, `consecutive_failures`, `degraded_since`, `last_error`, `last_error_at`), rolled-up alert state (`alert_state`, `firing_instance_count`, `last_fired_at`, `last_resolved_at`, `last_seen_at`, `last_row_count`) and `eval_backoff_secs` | Rule definitions. Identity is unique on `(tenant, namespace, name)`; `next_eval` indexes the scheduler scan; the rollup columns feed the alert list without an `instances` scan. |
| `instances`     | `key` (text PK), `rule`, `tenant`, `status`, `labels` (jsonb), `value`, `active_since`, `last_seen`, `absent_count` | Per-instance state machine. Indexed by `rule` and `(tenant,status)`. |
| `evaluations`   | `(rule, eval_ts)` PK, `applied_at`, `error`                            | Idempotency ledger: one row per evaluated `(rule, eval_ts)` so redeliveries don't double-evaluate. |
| `notifications` | `dedup_key` (text PK), `tenant`, `channel`, `target`, `status`, `attempts`, `claims`, `last_error`, `created_at`, `updated_at` | Delivery/dedup log, and the send lease. `target` holds a **redacted** `sha256:` digest, never the cleartext secret. `status` ∈ pending/sent/failed; `sent`/`failed` are terminal and dedup every later attempt. A `pending` row is a lease stamped at `updated_at`: once it expires (`NOTIFICATION_LEASE_MS`) another sender reclaims it and bumps `claims`, so a sender that dies mid-send cannot suppress that notification forever. `attempts` counts the delivery retries of one send; `claims` counts the senders that have owned the row. Pruned hourly at `LEDGER_RETENTION` (7 days past last update): the rows are dedup state with no reader outside the claim protocol, and the alert history the UI shows comes from the ClickHouse alert-log export, not from here. |
| `channels`      | `id` (uuid PK), `tenant`, `name`, `config` (jsonb)                     | Named delivery endpoints. Unique on `(tenant,name)`. `config` secrets are **encrypted at rest**. |
| `receivers`     | `id` (uuid PK), `tenant`, `name`, `channels` (jsonb array of names), `annotations` (jsonb) | Named sets of channel references. Unique on `(tenant,name)`. Holds channel names only, never secrets. |
| `routes`        | `id` (uuid PK), `tenant`, `matchers` (jsonb), `receiver`, `continue_matching`, `priority`, `group_by` (jsonb), `group_wait_secs`, `group_interval_secs`, `repeat_interval_secs` | Routing tree. `(tenant,receiver)` is a foreign key onto `receivers (tenant,name)`: a route cannot name a receiver that does not exist, and a receiver a route targets cannot be deleted. |
| `silences`      | `id` (uuid PK), `tenant`, `matchers` (jsonb), `starts_at`, `ends_at`, `comment`, `author`, `created_at` | Suppression windows. Indexed by `(tenant, ends_at)`. |
| `inhibitions`   | `id` (uuid PK), `tenant`, `source_matchers` (jsonb), `target_matchers` (jsonb), `equal` (jsonb) | Inhibition rules. |
| `event_outbox`  | `id` (uuid PK), `tenant`, `payload` (jsonb), `created_at`              | Transactional outbox: events written in the same tx as the instance update; a relay republishes stragglers. Indexed oldest-first. |
| `slos`          | `id` (uuid PK), `tenant`, `namespace`, `name`, `spec` (jsonb), `version`, `paused`, `next_eval`, `budget_epoch`, plus health columns (`health_status`, `consecutive_failures`, `degraded_since`, `last_error`, `last_error_at`) | SLO definitions, mirroring `rules`. Unique on `(tenant, namespace, name)`; `next_eval` indexes the SLO scheduler scan; `budget_epoch` is when the error budget last began. |
| `slo_status`    | `slo` (uuid PK, FK to `slos`, cascade), `tenant`, `payload` (jsonb), `computed_at` | One status snapshot per SLO: budget/burn plus per-window freshness timestamps. |
| `slo_evaluations` | `(slo, eval_ts)` PK, `applied_at`                                    | Idempotency ledger for SLO evaluations, mirroring `evaluations`. |
| `slo_instances` | `key` (text PK), `slo` (FK to `slos`, cascade), `tenant`, `status`, `labels` (jsonb), `value`, `active_since`, `last_seen`, `absent_count` | Per-(SLO, burn-rate tier) alert-instance state, mirroring `instances`. Indexed by `slo` and `(tenant,status)`. |

### What is encrypted at rest

- `channels.config`: the secret fields inside each channel config (Slack URL,
  Discord URL, webhook URL, Telegram bot token; email recipients and Telegram
  chat ids are structural). Receivers hold channel names only.
- `notifications.target`: stored as a one-way `sha256:` digest, not encryption;
  it is an audit/dedup value, never recoverable to the secret.

See [the security model](../explanation/security-model.md).

## Redis

The hot path and coordination primitives. Connection: `CC_REDIS_URL`.

| Key / stream            | Type        | Purpose | Lifetime |
| ----------------------- | ----------- | ------- | -------- |
| `cc:eval:jobs`          | Stream      | Evaluation jobs from scheduler → evaluator. Consumer group `evaluators`. | uncapped; drained by consumers |
| `cc:slo:jobs`           | Stream      | SLO evaluation jobs from scheduler → SLO evaluator, kept separate from `cc:eval:jobs` so SLO evaluation is never head-of-line blocked by rule evaluation. Consumer group `slo-evaluators`. | uncapped; drained by consumers |
| `cc:events`             | Stream      | Firing/resolved events from evaluator → dispatcher. Two independent consumer groups: `dispatchers` (delivery) and `cc:logexport` (the `events` log-export role); each group receives every event. | capped (~1M) |
| `cc:events:deadletter`  | Stream      | Permanently undeliverable events and flush-time decrypt failures. | capped |
| `cc:group:{group_id}`   | Hash        | A notification group's buffered events: fields `ev:{instance}` (event JSON), `__meta__` (group metadata; carries channel NAMES only, resolved to configs at flush time), `__last_flush__`, `__repeat_ms__` (the route's repeat interval, refreshed on every buffered event; absent = never re-notify), `__last_notified__` (when a notification for the group last actually went out). | 7 days if untouched |
| `cc:groupflush`         | Sorted set  | Flush-timer index: member = group id, score = due-time ms. | with its groups |
| `cc:groupflush:inflight` | Sorted set | Groups a flusher has claimed: member = group id, score = claim-lease expiry ms. Once that expiry passes, the reclaim pass moves the group back onto `cc:groupflush`, so a dispatcher dying mid-flush cannot strand a buffered group. | claim lease (60s), not refreshed |
| `cc:scheduler:members`  | Sorted set  | Scheduler membership: member = `CC_NODE_ID`, score = heartbeat ms (Redis server time). Stale members evicted past the TTL. | `CC_SCHEDULER_MEMBER_TTL_MS` |
| `cc:maintenance:lease`  | String      | Single-holder lease (`SET NX PX`) gating the maintenance loop (outbox relay, reconciliation, silence GC). | ~10s, refreshed by holder |

### Inspecting Redis safely

```bash
# Pending group flushes (soonest first):
redis-cli ZRANGE cc:groupflush 0 -1 WITHSCORES

# Live scheduler members and their heartbeats:
redis-cli ZRANGE cc:scheduler:members 0 -1 WITHSCORES

# Dead-letter backlog size:
redis-cli XLEN cc:events:deadletter

# A specific group's buffered metadata (target is ciphertext: safe to view):
redis-cli HGET cc:group:<id> __meta__
```

## ClickHouse

Read-only from clickety-clack's perspective: the evaluator runs each rule's `sql`
against it. clickety-clack does **not** manage the ClickHouse schema: your alert
SQL targets whatever tables you already have. Connection: `CC_CH_URL` /
`CC_CH_USER` / `CC_CH_PASSWORD`.

## Migrations

SQL migrations live in `migrations/` and are applied automatically at startup by
the `api`/`all` path (and any role that connects, via `PgStore::migrate()`).

| File            | Adds |
| --------------- | ---- |
| `0001_init.sql` | The whole schema: `rules`, `instances`, `evaluations`, `notifications`, `receivers`, `routes`, `channels`, `silences`, `inhibitions`, `event_outbox`, `slos`, `slo_status`, `slo_evaluations`, `slo_instances`. |

Schema changes go in a new numbered file. `sqlx` checksums what it has applied
and refuses to start against a database whose recorded migrations no longer match
the source, so editing an existing file requires dropping the database.
