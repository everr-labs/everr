# Webhook Ingress + Worker with Postgres-Backed Queue

## Replaying Webhooks to OpenTelemetry Collector

## Overview
This design introduces a single service that:

1. Receives third-party webhooks (vendor-controlled).
2. Persists them durably in PostgreSQL (queue pattern).
3. Processes them asynchronously (tenant resolution + side effects).
4. Replays the original webhook request to the OpenTelemetry Collector with an added tenant header.
5. Supports retries, backoff, and dead-letter handling.

The OpenTelemetry Collector remains focused solely on telemetry ingestion and processing.

## Architecture
```text
Vendor Webhook
      |
      v
Ingress HTTP Handler
      |
      v
Postgres (webhook_events queue table)
      |
      v
Background Worker (same service)
      |
      v
Replay HTTP -> Collector (githubactions receiver)
```

Single deployable service includes:

- HTTP ingress
- Postgres-backed queue
- Worker loop
- Webhook replay client

## Goals
- Durable webhook ingestion.
- Idempotent processing.
- Safe retries with backoff.
- Separation of concerns (no business logic inside Collector).
- Ability to scale horizontally later.
- Replay original webhook body and headers without mutation.
- Attach resolved tenant context to replay via a dedicated header.

## Non-Goals
- Using Collector as a queue consumer.
- Performing database/API side effects inside the Collector.
- Exactly-once global guarantees (at-least-once with idempotency is acceptable).

## Database Design
### Table: `webhook_events`
```sql
CREATE TABLE webhook_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    body_sha256 TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    headers JSONB NOT NULL,
    body BYTEA NOT NULL,

    status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | done | failed | dead
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    error_class TEXT,
    done_at TIMESTAMPTZ,
    dead_at TIMESTAMPTZ,

    UNIQUE (source, event_id)
);
```

Recommended indexes:

```sql
CREATE INDEX webhook_events_claim_idx
  ON webhook_events (next_attempt_at, received_at)
  WHERE status IN ('queued', 'failed');

CREATE INDEX webhook_events_dead_idx
  ON webhook_events (dead_at)
  WHERE status = 'dead';
```

### Important Fields
| Column | Purpose |
| --- | --- |
| `event_id` | Vendor delivery ID (idempotency key). |
| `body_sha256` | Detect conflicting duplicate deliveries for the same idempotency key. |
| `headers` | Required for exact replay. |
| `body` | Raw webhook payload (unmodified bytes). |
| `status` | Queue state. |
| `attempts` | Retry counter. |
| `next_attempt_at` | Backoff scheduling. |
| `locked_until` | Crash recovery protection. |

Idempotency key policy:

- Events are emitted by a single vendor.
- Use vendor `event_id` directly as the idempotency key (`UNIQUE (source, event_id)`).
- No derived idempotency key logic is required for now.

## Ingress Flow
### Step 1: Receive Webhook
1. Read raw request body bytes once.
2. Capture required headers (or full header set).
3. Verify vendor signature at ingress.
4. Extract idempotency key (delivery ID).
5. Compute `body_sha256`.
6. Insert row into `webhook_events`.

```sql
INSERT INTO webhook_events (...)
ON CONFLICT (source, event_id) DO NOTHING;
```

If conflict occurs:

- If existing `body_sha256` matches, treat as duplicate delivery and return success.
- If existing `body_sha256` differs, record a high-severity alert and move to manual investigation.

Signature verification policy (simplicity-first):

- Verify exactly once at ingress.
- If signature is invalid, return `401` or `403` and do not enqueue.
- Worker trusts ingress verification and does not perform signature checks.

### Step 2: Respond to Vendor
Return `200` or `202` immediately after successful DB insert.

Recommended approach: ACK after durable insert, not after side effects.

## Worker Flow
Runs in the same service as a background loop.

### Claiming Work (Safe for Scaling)
```sql
WITH cte AS (
  SELECT id
  FROM webhook_events
  WHERE status IN ('queued','failed')
    AND next_attempt_at <= now()
    AND (locked_until IS NULL OR locked_until <= now())
  ORDER BY received_at
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE webhook_events e
SET status = 'processing',
    attempts = attempts + 1,
    locked_until = now() + interval '2 minutes'
FROM cte
WHERE e.id = cte.id
RETURNING e.*;
```

This allows:

- Multiple service replicas.
- No duplicate processing.
- Safe horizontal scaling.

Lease handling defaults:

- Set `locked_until` at claim time.
- Extend lease periodically while processing long-running tasks.
- On success, clear `locked_until`.
- On failure, clear `locked_until` before rescheduling.

## Processing Steps
For each claimed event:

1. Parse JSON body.
2. Perform tenant resolution (DB lookup or API call).
3. Execute side effects (external API calls, internal DB writes).
4. Replay webhook to Collector.
5. Mark row as `done`.

Ordering rationale:

- Side effects are required to keep application job state accurate (for example, "currently running").
- Collector replay is downstream telemetry and occurs after application state is updated.

If failure occurs:

- Update `status = failed`.
- Compute exponential backoff.
- Set `next_attempt_at`.
- Store error in `last_error`.
- Set `error_class` to `retryable` or `terminal`.
- After `N` attempts, move to `dead`.

## Replay to Collector
### Method
Replay original webhook via HTTP to Collector's custom receiver endpoint.

- Method: `POST`
- URL: Collector webhook endpoint
- Body: original `BYTEA`
- Headers: replay all captured headers as received, plus `X-Citric-Tenant-Id: <resolved_tenant_id>`

### Important Requirements
- Do not re-marshal JSON.
- Preserve all captured headers.
- Add `X-Citric-Tenant-Id` from tenant resolution before sending to Collector.
- Ensure body is byte-for-byte identical to preserve replay fidelity.

Default replay success criteria:

- `2xx`: success, continue workflow.
- `408`, `429`, `5xx`, and network failures: retryable failure.
- Other `4xx`: terminal failure unless explicitly allowlisted as retryable.

## Collector Tenant Attribution via Extension
Use a Collector extension + processor split so tenant attribution stays centralized and reusable.

### Components
- `tenantresolverextension`: reads `X-Citric-Tenant-Id` from incoming request metadata and exposes resolved tenant context.
- `tenantenricherprocessor`: fetches tenant context from the extension and writes `citric.tenant.id` on telemetry resource attributes.

### Flow
1. Receiver accepts replayed webhook request with `X-Citric-Tenant-Id`.
2. Extension extracts tenant ID from request metadata.
3. Processor sets `citric.tenant.id=<tenant_id>` on emitted telemetry.
4. Exporters send telemetry with tenant attribute attached.

### Behavior
- If `X-Citric-Tenant-Id` is present: set `citric.tenant.id`.
- If header is missing or empty: fail closed for multitenant pipelines (drop or route to error pipeline), and emit an error metric/log.
- Collector does not perform tenant DB lookups in this path; it uses the header provided by ingress worker.

## Retry Strategy
### Recommended Defaults
- Max attempts: `10`
- Backoff: exponential (for example, `2^attempt` seconds)
- Jitter: yes (to avoid thundering herd)
- Dead-letter threshold: configurable
- Timeout: `10s` connect + `30s` request

### Dead-Letter Handling
When attempts exceed threshold, set:

```text
status = 'dead'
```

Also set `dead_at = now()` for aging and cleanup.

Dead rows can be:

- Manually reprocessed.
- Exported to observability backend.
- Alerted on.

Dead-letter workflow (simple default):

- Retry is manual only (CLI/admin action), no automatic dead-letter retries.
- Support requeue of a single event or filtered bulk requeue.
- Requeue operation sets `status='queued'`, `attempts=0`, `next_attempt_at=now()`, `locked_until=NULL`, `last_error=NULL`, `error_class=NULL`, `dead_at=NULL`.
- Alert when dead-letter count is greater than zero in a 5-minute window.

## Failure Modes Covered
| Scenario | Outcome |
| --- | --- |
| Service crashes after insert | Event remains queued. |
| Service crashes mid-processing | Lock expires, then retried. |
| Collector temporarily unavailable | Worker retries. |
| External API fails | Retries with backoff. |
| Duplicate webhook delivery | Unique constraint prevents duplicate insert. |

## Concurrency Model
Even if starting with a single instance, the design supports:

- Multiple worker goroutines.
- Multiple service replicas.
- Safe distributed locking via `SKIP LOCKED`.

## Observability Recommendations
The ingress + worker service should emit:

- A span for webhook handling.
- A span for tenant resolution.
- A span for replay to Collector.
- Structured logs for state transitions.

This supports:

- Retry tracking.
- Dead-letter monitoring.
- Latency analysis.

## Operational Considerations
### Connection Pooling
Use a Postgres connection pool with:

- Max connections limit.
- Short query timeouts.
- Prepared statements.

### Backpressure
If queue depth grows:

- Alert.
- Scale replicas.
- Increase worker batch size.

### Metrics to Monitor
- Queue depth (`status in queued/failed`).
- Processing rate.
- Retry rate.
- Dead-letter count.
- Replay latency.

### Retention and Cleanup
Configured defaults:

- Keep `done` rows for 7 days, then delete in batches.
- Keep `dead` rows for 30 days, then archive or delete per compliance policy.
- Run cleanup with bounded batch size to avoid vacuum and lock spikes.

Retention configuration:

- `retention_done_days` (default `7`)
- `retention_dead_days` (default `30`)

### Data Protection Defaults (Simple)
- Rely on standard Postgres at-rest protection; no additional application-layer payload encryption for now.
- Never log raw webhook body or sensitive/signature headers.
- Keep raw headers/body only for configured retention windows, then delete via cleanup jobs.

## Why This Design Works
- Collector remains focused on telemetry.
- No side effects inside Collector.
- Durable ingestion.
- At-least-once delivery with idempotency.
- Horizontal scalability.
- Clear separation of concerns.
- Operationally predictable.

## Future Enhancements (Optional)
- Replace Postgres queue with Kafka/SQS if throughput grows.
- Add rate limiting per vendor.
- Add priority lanes.
- Add replay tool for dead events.
- Add schema validation layer.

## Open Questions and Clarifications Needed
1. What is the expected webhook throughput (average and peak QPS)?

## Summary
This design:

- Merges ingress and worker into one service.
- Uses PostgreSQL as a durable queue.
- Performs tenant resolution and side effects outside the Collector.
- Replays original webhooks unchanged to the Collector.
- Provides reliability, scalability, and operational clarity.

The OpenTelemetry Collector remains a pure telemetry processing component, simplifying upgrades and long-term maintenance.
