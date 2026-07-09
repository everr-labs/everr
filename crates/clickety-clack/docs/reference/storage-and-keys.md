# Storage reference: Postgres tables, Redis keys, migrations

This is the operator's map of where state lives. You should rarely touch these
directly, but knowing them is essential for debugging, capacity planning, and
incident response.

## PostgreSQL

Durable state. The schema is created and kept current by migrations the binary
runs itself at startup (see [migrations](#migrations)). Connection: `CC_PG_URL`.

| Table           | Key columns                                                            | Purpose |
| --------------- | --------------------------------------------------------------------- | ------- |
| `rules`         | `id` (uuid PK), `tenant`, `spec` (jsonb), `version`, `paused`, `next_eval`, `last_eval`, `last_error` | Rule definitions. `next_eval` indexes the scheduler scan. |
| `instances`     | `key` (text PK), `rule`, `tenant`, `status`, `labels` (jsonb), `value`, `active_since`, `last_seen`, `absent_count` | Per-instance state machine. Indexed by `rule` and `(tenant,status)`. |
| `evaluations`   | `(rule, eval_ts)` PK, `applied_at`, `error`                            | Idempotency ledger — one row per evaluated `(rule, eval_ts)` so redeliveries don't double-evaluate. |
| `subscriptions` | `id` (uuid PK), `tenant`, `webhook_url`                                | Firehose webhooks. `webhook_url` is **encrypted at rest**. |
| `notifications` | `dedup_key` (text PK), `tenant`, `channel`, `target`, `status`, `attempts`, `last_error`, `created_at`, `updated_at` | Delivery/dedup log. `target` holds a **redacted** `sha256:` digest, never the cleartext secret. `status` ∈ pending/sent/failed. |
| `channels`      | `id` (uuid PK), `tenant`, `name`, `config` (jsonb)                     | Named delivery endpoints. Unique on `(tenant,name)`. `config` secrets are **encrypted at rest**. |
| `receivers`     | `id` (uuid PK), `tenant`, `name`, `channels` (jsonb array of names)    | Named sets of channel references. Unique on `(tenant,name)`. Holds channel names only, never secrets. |
| `routes`        | `id` (uuid PK), `tenant`, `matchers` (jsonb), `receiver`, `continue_matching`, `priority`, `group_by` (jsonb), `group_wait_secs`, `group_interval_secs` | Routing tree. |
| `silences`      | `id` (uuid PK), `tenant`, `matchers` (jsonb), `starts_at`, `ends_at`, `comment`, `author`, `created_at` | Suppression windows. Indexed by `(tenant, ends_at)`. |
| `inhibitions`   | `id` (uuid PK), `tenant`, `source_matchers` (jsonb), `target_matchers` (jsonb), `equal` (jsonb) | Inhibition rules. |
| `event_outbox`  | `id` (uuid PK), `tenant`, `payload` (jsonb), `created_at`              | Transactional outbox — events written in the same tx as the instance update; a relay republishes stragglers. Indexed oldest-first. |

### What is encrypted at rest

- `channels.config` — the secret fields inside each channel config (Slack
  URL, PagerDuty routing key, Telegram bot token; webhook URL and email
  recipients are structural). Receivers hold channel names only.
- `subscriptions.webhook_url`.
- `notifications.target` — stored as a one-way `sha256:` digest, not encryption;
  it is an audit/dedup value, never recoverable to the secret.

See [the security model](../explanation/security-model.md).

## Redis

The hot path and coordination primitives. Connection: `CC_REDIS_URL`.

| Key / stream            | Type        | Purpose | Lifetime |
| ----------------------- | ----------- | ------- | -------- |
| `cc:eval:jobs`          | Stream      | Evaluation jobs from scheduler → evaluator. Consumer group `evaluators`. | capped (~1M) |
| `cc:events`             | Stream      | Firing/resolved events from evaluator → dispatcher. Consumer group `dispatchers`. | capped (~1M) |
| `cc:events:deadletter`  | Stream      | Permanently undeliverable events and flush-time decrypt failures. | capped |
| `cc:group:{group_id}`   | Hash        | A notification group's buffered events: fields `ev:{instance}` (event JSON), `__meta__` (group metadata; carries channel NAMES only, resolved to configs at flush time), `__last_flush__`. | 7 days if untouched |
| `cc:groupflush`         | Sorted set  | Flush-timer index: member = group id, score = due-time ms. | with its groups |
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

# A specific group's buffered metadata (target is ciphertext — safe to view):
redis-cli HGET cc:group:<id> __meta__
```

## ClickHouse

Read-only from clickety-clack's perspective: the evaluator runs each rule's `sql`
against it. clickety-clack does **not** manage the ClickHouse schema — your alert
SQL targets whatever tables you already have. Connection: `CC_CH_URL` /
`CC_CH_USER` / `CC_CH_PASSWORD`.

## Migrations

SQL migrations live in `migrations/` and are applied automatically at startup by
the `api`/`all` path (and any role that connects, via `PgStore::migrate()`).

| File                          | Adds |
| ----------------------------- | ---- |
| `0001_init.sql`               | `rules`, `instances`, `evaluations`, `subscriptions`. |
| `0002_notifications.sql`      | `notifications` (delivery/dedup log). |
| `0003_routing.sql`            | `receivers`, `routes`. |
| `0004_grouping.sql`           | Adds `group_by`, `group_wait_secs`, `group_interval_secs` to `routes`. |
| `0005_silences_inhibitions.sql` | `silences`, `inhibitions`. |
| `0006_event_outbox.sql`       | `event_outbox`. |
| `0007_rule_pause.sql`         | Adds `paused` to `rules` (+ partial index on `next_eval WHERE NOT paused`). |
| `0013_receiver_channels.sql`  | Renames `receivers.channel` to `channels` and wraps single configs into one-element arrays. |
| `0014_named_channels.sql`     | `channels` table; materializes inline receiver configs as named channels and rewrites receivers to reference them by name. |

Phase 3D (secret encryption) added **no** migration — existing column types
already accommodate ciphertext.
