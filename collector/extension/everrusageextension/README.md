# Ingestion usage

The usage components measure decoded OTLP protobuf bytes durably accepted for
ingestion. This module provides the shared accumulator extension. The
[processor](../../processor/everrusageprocessor) measures admitted requests, and
the [receiver](../../receiver/everrusagereceiver) publishes usage metrics. All
three use the component ID `everr_usage`. The unmodified storage exporter owns
its persistent queue, batching, and retries.

```text
authenticate + stamp tenant/retention
  -> usage processor
  -> storage exporter: persist -> batch -> retry -> database
```

The processor calculates each tenant's bytes before forwarding and records
scalar totals only after the exporter accepts the request into its persistent
queue. It does not wait for the database write. Queue-full and persistence errors
return to the receiver without usage. Export retries and queue recovery never
pass through the processor again.

## Metric contract

| Field | Value |
| --- | --- |
| Name | `everr.ingestion.volume` |
| Type | Monotonic delta Sum |
| Unit | `By` |
| Publication interval | 60 seconds by default |
| Datapoint attributes | `everr.ingestion.signal`, `everr.usage.tenant.id`, `everr.usage.sequence` |
| Signals | `logs`, `traces`, `metrics` |
| Resource owner | `everr.tenant.id`, the measured tenant |
| Resource service | `service.name=everr-ingestion` |
| Resource instance | A new `service.instance.id` for each extension instance |
| Scope | `github.com/everr-labs/everr/collector/usage`, version `1` |
| Retention | Fixed 365 days, independent of plan and source retention |

The receiver submits each snapshot once to the same exporter used for telemetry.
The persistent exporter queue owns batching, retries, and recovery for both.
Only tenant/signal pairs with newly accepted bytes produce points. Timestamps
use admission and flush time, not customer telemetry timestamps.

## Retry-safe totals

Exporter delivery is at least once: a successful write with a lost acknowledgment
can leave duplicate rows. Never bill by directly summing raw `Value` rows.
Use [customer-usage.sql](customer-usage.sql) for both customer-facing totals and
billing. Supply a half-open UTC period through the `from` and `to` DateTime
parameters. The invoice scheduler and usage UI are outside this module; their
integration must use this query contract.

Each point's identity is `(service.instance.id, everr.usage.tenant.id,
everr.ingestion.signal, everr.usage.sequence)`. The sequence advances once per
nonempty drain, under the accumulator lock. A restart creates a new instance ID.
Retries and administrative copies preserve all four fields. A sequence is needed
because the current metric tables store timestamps at second precision; two
flushes in the same second must remain distinct. This attribute deliberately
adds one identity per flush to the low-volume usage metric.

The query groups by this identity before summing, using `min(Value)` so identical
retry copies contribute once (conflicting copies conservatively use the smaller
value). Decimal summation preserves exact integer byte totals beyond `2^53`.
It excludes legacy points without identity. Service, metric, and time filters
bound the scan; tenant access remains enforced by the existing row-level policy.
Do not apply a pre-deduplication rollup that discards the identity.

## Optional administrative copy

The base configuration publishes customer-owned usage. Deployments may add
[usage-admin.example.yaml](../../config/usage-admin.example.yaml) as a second
`--config` file, setting `EVERR_ADMIN_TENANT_ID` to our internal tenant. Standard
pipeline fanout and the resource processor make an isolated copy, replace only
resource `everr.tenant.id`, and send it to the same `clickhouse` exporter. The
customer identity, sequence, bytes, timestamps, and 365-day retention are kept.
No custom copy component or additional exporter is needed.

Both publication branches bypass metering and the reserved-name filter. Do not
send generated usage back through public ingress, which drops `everr.*` metrics.
If the measured tenant is our own tenant, the two copies have the same identity
and the canonical query still counts them once.

The two branches can succeed independently. Our copy is for reporting; the
customer-owned points remain the billing authority. The canonical query excludes
administrative copies by requiring owner and measured customer to match, even
when run with administrative access across tenants. To report from the admin
copy, query as our tenant and omit that equality, keeping identity deduplication.

## Measurement version 1

Bytes are the protobuf serialization size of decoded, nonempty telemetry grouped
by tenant within each incoming request, before exporter queue batching. Included:
resource and scope metadata, records, span events and links, metric buckets and
exemplars. Excluded: routing and retention resource attributes `everr.tenant.id`
and `everr.retention.days`, empty resources and scopes, and metrics without
points. Histogram observation counts are not multiplied into bytes. JSON and
protobuf requests use the same decoded measurement.

This is accepted ingestion volume, not wire bytes, original JSON length,
compressed database size, or proof of successful database storage. Client batching
and repeated resource metadata can change the volume. Changing the definition
after release requires an explicit billing migration.

Authentication and trusted tenant stamping must precede the processor. Configure
the standard filter processor before metering on every incoming metrics pipeline
to reserve all `everr.*` metric names:

```yaml
filter/reserved_everr:
  error_mode: propagate
  metric_conditions:
    - 'IsMatch(metric.name, "^everr[.]")'
```

Only the isolated usage receiver bypasses this filter. Apply the same rule to
unmetered ingress into the billing store. Namespace filtering belongs to pipeline
configuration; the metering component does not filter incoming metric names.

## Configuration

See [the collector example](../../config.example.yml) for complete wiring. Enable
the usage and file storage extensions in `service.extensions`. Place one usage
processor last in each ingestion pipeline, directly before one exporter.

```yaml
extensions:
  file_storage/ingestion:
    directory: /var/lib/everr/queue
    create_directory: true
    fsync: true
  everr_usage:
    max_series: 30000
processors:
  everr_usage: {}
receivers:
  everr_usage:
    interval: 60s
    timeout: 10s
exporters:
  clickhouse:
    # Connection and schema settings omitted; see the collector example.
    sending_queue:
      enabled: true
      storage: file_storage/ingestion
      wait_for_result: false
      queue_size: 10000
      num_consumers: 10
      batch:
        min_size: 8192
        flush_timeout: 1s
    retry_on_failure:
      enabled: true
      max_elapsed_time: 0s
```

Batching normally belongs inside `sending_queue.batch`. Startup validation
requires one meter directly before one persistent exporter with fsync and
unlimited retries. Upstream connectors, processors, and receiver fanout are
allowed: billing measures each downstream admission after those transformations,
not the original receiver acknowledgment. If an upstream component buffers,
filters, duplicates, or retries data, that affects which admissions reach the
meter. Configure tenant stamping before any component that loses auth context.

The usage receiver publishes into a metrics pipeline that bypasses metering.
It may fan out through resource processors into the same exporter. Exactly one
usage receiver may claim an extension; sharing that receiver across pipelines
uses the Collector's built-in fanout.

Keep exporter ID and queue directory stable across restarts. Docker Compose
mounts a named volume; other deployments must mount persistent storage at
`EVERR_QUEUE_DIRECTORY` (default `/var/lib/everr/queue`). Each replica needs its own
volume. Queue capacity defaults to 10,000 requests per signal, not bytes. Size
queue and disk capacity for request sizes and expected outages; unlimited retry
time does not imply unlimited capacity.

The previous experimental `everr_queue` connector used different queue storage
identities. Its files are not automatically imported by the storage exporter.
Drain that collector before switching configurations; do not discard pending
queue files during rollout.

## Failure contract

- A persisted admission contributes usage even if database delivery later fails
  permanently, the backend deduplicates the write, or the queue volume is lost.
- Queue-full and failed or ambiguous persistence operations contribute zero
  usage. Persistence may have committed despite returning an error.
- Export retries and recovered queue entries do not generate additional usage.
- Client resubmissions are separate admissions, including retries after a lost
  receiver acknowledgement. This does not deduplicate client requests.
- A crash after admission but before recording or publishing usage can undercount.
- The receiver never restores a drained snapshot. Failure to enqueue usage can
  undercount. Once queued, exporter retries and recovery preserve point identity.
  Deduplicated billing reads only customer-owned points present in storage.
- At most `max_series` tenant/signal totals are retained per interval. New series
  beyond the bound are dropped. Each total is capped at `2^53` bytes to preserve
  exact values in Float64 metric storage.

Usage publication bypasses metering and never charges for itself. Receiver
shutdown attempts a final flush; measurements finishing later can be lost.

## Validation

Run `go test -race ./...` in each usage component module and `make build` in
`collector`. The modules are `extension/everrusageextension`,
`processor/everrusageprocessor`, and `receiver/everrusagereceiver`. Tests cover byte
measurement, admission failures, concurrent drains, limits,
topology, native persistent exporter retries and recovery for every signal,
full queues, snapshot identities, and failed receiver submissions without replay.

For end-to-end validation, send uniquely marked authenticated telemetry for two
tenants while database writes are unavailable. Verify admission usage through
the persistent queue, kill the collector, restart with the same volume, and
verify delivery without additional usage. Fresh admissions must count once; full queues must
reject requests with no usage. Include all five metric types. Verify the standard
filter drops reserved names from mixed payloads and that reserved-only payloads
produce neither stored metrics nor usage.

The opt-in [usage smoke test](../../test/smoke/usage.py) exercises the real
collector and ClickHouse with an injected outage and successful writes whose
acknowledgments are lost. See its `--help` for local prerequisites. It compares
canonical totals, customer/admin copies, retention, native queue recovery,
reserved-name filtering, and receiver fanout without tenant mutation leaks.
