# Ingestion usage

This module measures decoded OTLP protobuf bytes durably accepted for ingestion.
It contains an `everr_usage` extension, processor, and metrics receiver. The
unmodified storage exporter owns its persistent queue, batching, and retries.

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
| Datapoint attributes | `everr.ingestion.signal`, `everr.usage.tenant.id` |
| Signals | `logs`, `traces`, `metrics` |
| Resource owner | `everr.tenant.id`, the measured tenant |
| Resource service | `service.name=everr-ingestion` |
| Resource instance | A new `service.instance.id` for each extension instance |
| Scope | `github.com/everr-labs/everr/collector/usage`, version `1` |
| Retention | Fixed 365 days, independent of plan and source retention |

Each point is published once into the customer's own metrics. Billing reads
those same points through administrative access across tenants. There is no
administrative copy. Sum deltas across instances; never carry a previous value
into an empty interval. Only tenant/signal pairs with newly accepted bytes
produce points. Timestamps use admission and flush time, not the customer's
telemetry timestamps. The invoice scheduler is outside this module.

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

Authentication and trusted tenant stamping must precede the processor. Incoming
metrics in `everr.ingestion.*` are removed before admission and measurement; only
the isolated usage receiver may publish that namespace. Any other unmetered
ingress into a billing store must enforce the same restriction.

## Configuration

See [the collector example](../config.example.yml) for complete wiring. Enable
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

There must be no asynchronous batch processor before admission and no exporter
fanout. Batching belongs inside `sending_queue.batch`. Startup validation accepts
synchronous resource, attributes, filter, transform, and memory limiter processors
before the meter. It rejects connectors feeding metered pipelines, which could
replay already-accounted data.

The usage receiver needs a separate metrics pipeline with no processors and one
exporter targeting the same customer metrics tables. Explicitly disable both
that exporter's queue and retries. Do not place a retrying proxy or buffering
collector before usage storage. Exactly one usage receiver may claim an
extension. Startup validation enforces these pipeline constraints.

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
- Drained usage snapshots are never restored or replayed. Failed publication can
  lose usage, while an ambiguous one may already be stored. Billing reads only
  customer-visible points actually present in metrics storage.
- At most `max_series` tenant/signal totals are retained per interval. New series
  beyond the bound are dropped. Each total is capped at `2^53` bytes to preserve
  exact values in Float64 metric storage.

Usage publication bypasses metering and never charges for itself. Receiver
shutdown attempts a final flush; measurements finishing later can be lost.

## Accounting health

The Collector internal meter provider exposes two operational counters:

| Instrument | Unit | Attributes | Meaning |
| --- | --- | --- | --- |
| `everr.usage.discarded.volume` | `By` | `everr.ingestion.signal`, `everr.usage.discard.reason` | Accepted bytes excluded by accumulator limits |
| `everr.usage.publication.failed` | `1` | None | Failed publication attempts, including ambiguous writes |

Discard reasons are `series_limit` and `value_limit`. These counters contain no
customer identifiers. Through the Prometheus reader they are cumulative, first
appear after an event, and reset with the process. The internal scraper allows
both dotted and normalized names (`everr_usage_discarded_volume` and
`everr_usage_publication_failed`) according to scrape protocol negotiation. They
use ordinary authenticated ingestion into our tenant. They are diagnostics,
not billing corrections: ambiguous publication may already be stored, and
crashes can lose operational observations too.

## Validation

Run `go test -race ./...` here and `make build` in `collector`. Tests cover byte
measurement, namespace protection, admission failures, concurrent drains, limits,
topology, native persistent exporter retries and recovery for every signal,
full queues, and failed usage publication without replay.

For end-to-end validation, send uniquely marked authenticated telemetry for two
tenants while database writes are unavailable. Verify admission usage through
Everr, kill the collector, restart with the same volume, and verify delivery
without additional usage. Fresh admissions must count once; full queues must
reject requests with no usage. Include all five metric types.
