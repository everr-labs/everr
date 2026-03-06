# Webhook Request Lifecycle

This document describes the intended lifecycle of a GitHub webhook when `webhook_events` is topic-based.

The key model is:
- one row per `(source, event_id, topic)`
- `topic` identifies the interested downstream service
- retries are isolated because each service has its own row

Current topics:
- `collector`
- `cdevents`
- `app`

## High-Level Flow

```mermaid
flowchart LR
    GH["GitHub"] --> IngressHTTP["Ingress HTTP handler"]
    IngressHTTP --> Router["Topic router"]
    Router --> Events["Postgres webhook_events"]
    Events --> Worker["Ingress worker"]
    Worker --> Collector["collector topic"]
    Worker --> CDEvents["cdevents topic"]
    Worker --> App["app topic"]
    Collector --> CHO["ClickHouse otel.otel_*"]
    CDEvents --> CHC["ClickHouse otel.cdevents_raw"]
```

## 1. Request Arrival

Ingress accepts the GitHub webhook and determines which services are interested.

Examples:
- `workflow_run` -> `collector`, `cdevents`
- `workflow_job` -> `collector`, `cdevents`
- `installation` -> `app`
- `installation_repositories` -> `app`

For each interested topic, ingress inserts one row into `webhook_events`.

### HTTP Acceptance Sequence

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant IH as Ingress HTTP
    participant R as Topic router
    participant DB as webhook_events

    GH->>IH: POST /webhook/github
    IH->>IH: Validate signature
    IH->>R: Determine interested topics
    R-->>IH: [collector, cdevents] or [app]
    IH->>DB: Insert one row per topic
    IH-->>GH: 202 / 200 / 409
```

## 2. Queue Row Model

Each row in `webhook_events` now means:
- one GitHub delivery
- one destination topic
- one retry lifecycle

Suggested important fields:
- `source`
- `event_id`
- `topic`
- `body_sha256`
- `headers`
- `body`
- `tenant_id`
- `status`
- `attempts`
- `next_attempt_at`
- `locked_until`
- `last_error`
- `error_class`

Suggested uniqueness:
- `(source, event_id, topic)`

## 3. Queue State Machine

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> processing: worker claims row
    failed --> processing: retry time reached
    processing --> done: topic delivery succeeded
    processing --> failed: retryable failure
    processing --> dead: terminal failure / max attempts reached
    done --> [*]
    dead --> [*]
```

## 4. Topic-Based Worker Processing

The worker claims rows from `webhook_events` and dispatches based on `topic`.

### Topic: `collector`
- parse webhook
- resolve tenant if needed
- persist `tenant_id` on the row
- replay to collector

### Topic: `cdevents`
- parse webhook
- resolve tenant if needed
- persist `tenant_id` on the row
- replay to cdevents

### Topic: `app`
- parse webhook
- forward installation event to app
- no tenant resolution required

### Processing Sequence

```mermaid
sequenceDiagram
    participant W as Worker
    participant E as webhook_events row
    participant TR as Tenant resolver
    participant T as Topic target

    W->>E: Claim row
    W->>W: Parse webhook
    W->>W: Inspect topic

    alt topic is collector or cdevents
        alt tenant_id missing
            W->>TR: Resolve tenant ID
            TR-->>W: tenant_id
            W->>E: Persist tenant_id
        else tenant_id already set
            W->>W: Reuse tenant_id
        end
    end

    W->>T: Replay to topic target
    T-->>W: 2xx / 4xx / 5xx
    W->>E: Mark done / failed / dead
```

## 5. Isolation Semantics

Isolation comes from separate rows, not from special retry logic.

If a `workflow_run` webhook fans out to:
- `(evt_123, collector)`
- `(evt_123, cdevents)`

then:
- collector can succeed while cdevents fails
- cdevents can succeed while collector fails
- retrying one does not re-drive the other

### Example

```mermaid
flowchart TD
    A["workflow_run webhook"] --> B["row: topic=collector"]
    A --> C["row: topic=cdevents"]
    B --> D["collector done"]
    C --> E["cdevents failed"]
    E --> F["retry only cdevents row"]
```

## 6. Tenant Resolution

Tenant resolution is topic-specific:

### `collector`
- required
- store `tenant_id` on the row after the first successful resolution
- reuse it on retry

### `cdevents`
- required
- store `tenant_id` on the row after the first successful resolution
- reuse it on retry

### `app`
- not required

This avoids repeated resolution for the same topic row.

## 7. Replay Semantics

For `collector` and `cdevents`:
- clone stored GitHub headers
- strip hop-by-hop headers
- preserve original body
- inject `X-Everr-Tenant-Id`

For `app`:
- forward original installation webhook
- no tenant header required

Status classification:
- `2xx`: success
- retryable: `408`, `429`, `5xx`
- terminal: other `4xx`

## 8. CDEvents Service

The cdevents service receives rows with `topic = cdevents`.

It:
- requires `X-GitHub-Event`
- requires `X-GitHub-Delivery`
- requires `X-Everr-Tenant-Id`
- parses the payload
- maps supported events to CDEvents
- writes normalized rows to ClickHouse

Supported mappings:
- `workflow_run.requested` -> `pipelineRun.queued`
- `workflow_run.in_progress` -> `pipelineRun.started`
- `workflow_run.completed` -> `pipelineRun.finished`
- `workflow_job.in_progress` -> `taskRun.started`
- `workflow_job.completed` -> `taskRun.finished`

## 9. End-To-End Outcomes

### Workflow run webhook
- ingress inserts:
  - one `collector` row
  - one `cdevents` row
- each row is retried independently

### Installation webhook
- ingress inserts:
  - one `app` row
- app forwarding is retried independently

### Partial success
- collector row can be `done`
- cdevents row can be `failed`
- no duplicate collector replay is needed for cdevents retry

## 10. Design Intent

This topic-based model deliberately keeps:
- one queue table
- one row per interested service
- isolated retry state per service

It avoids both:
- a shared multi-target row
- a separate `webhook_deliveries` table
