# Confirmed ingestion usage

This module measures decoded OTLP protobuf bytes after a storage exporter
confirms success. It contains an `everr_usage` extension, processor, and metrics
receiver, plus an `everr_queue` connector backed by the standard exporter helper
and file storage extension. The upstream storage exporter is unchanged.

Authenticated telemetry is acknowledged after it has been written to the disk
queue. The queue batches and retries delivery through the processor into the
synchronous storage exporter. The processor measures each tenant before
forwarding the payload, then records only scalar totals after downstream success. The shared extension aggregates
those totals across signal pipelines. The receiver drains them every 60 seconds
and attempts customer and internal publication separately, once each.

## Metric contract

| Field | Value |
| --- | --- |
| Name | `everr.ingestion.volume` |
| Type | Monotonic Sum |
| Temporality | Delta |
| Unit | `By` |
| Datapoint attributes | `everr.ingestion.signal`, `everr.usage.tenant.id` |
| Signal values | `logs`, `traces`, `metrics` |
| Resource service | `service.name=everr-ingestion` |
| Resource instance | A new `service.instance.id` for each extension instance |
| Resource owner | `everr.tenant.id`, the destination tenant |
| Scope | `github.com/everr-labs/everr/collector/usage`, version `1` |

The customer copy is owned by the measured tenant. Setting `internal_tenant` on
the extension creates another copy owned by that internal tenant, retaining the
customer in `everr.usage.tenant.id`. No second copy is made when the customer is
already the internal tenant. Empty `internal_tenant` disables duplication.

Sum the delta values across collector instances to obtain usage for a time
range. Interval timestamps use confirmation and flush time, not timestamps in
customer telemetry. Both copies have identical values and interval timestamps.

## Measurement version 1

Bytes are the protobuf serialization size of the decoded, nonempty telemetry
grouped by tenant within each queued export attempt. Measurement includes
resource and scope metadata, records, span events and links, metric buckets and
exemplars. It excludes the routing and retention resource attributes
`everr.tenant.id` and `everr.retention.days`, empty resources and scopes, and
metrics without datapoints. Histogram observation counts are not multiplied
into byte counts. JSON and protobuf requests use the same decoded measurement.

This is ingestion payload volume, not wire bytes, original JSON length, or
compressed database size. Client batching and repeated resource metadata can
change the measured volume. Changing this definition requires a new measurement
version and an explicit billing migration.

The processor requires trusted tenant resource attributes. Place authentication
and tenant stamping before it. Incoming metrics in `everr.ingestion.*` are
removed before storage and measurement; only the isolated usage receiver may
publish that namespace. Any other unmetered ingress into a billing store must
enforce the same namespace restriction.

## Configuration

See [the collector example](../config.example.yml) for the complete wiring.
All four factories must be included in the collector distribution.

```yaml
extensions:
  file_storage/ingestion:
    directory: /var/lib/everr/queue
    create_directory: true
    fsync: true
  everr_usage:
    internal_tenant: ${env:USAGE_INTERNAL_TENANT_ID:-}
    retention_days: 90
    max_series: 30000
connectors:
  everr_queue:
    sending_queue:
      storage: file_storage/ingestion
      queue_size: 10000
      batch:
        min_size: 8192
        flush_timeout: 1s
    retry_on_failure:
      enabled: true
      max_elapsed_time: 0s
processors:
  everr_usage:
    extension: everr_usage
receivers:
  everr_usage:
    extension: everr_usage
    interval: 60s
    timeout: 10s
```

Enable both extensions in `service.extensions`. Connect authenticated ingress to
`everr_queue`, after stamping trusted tenant and retention attributes. Do not put
an asynchronous batch processor before the queue: that would acknowledge data
before it is persisted.

For each signal, give the queue exactly one destination pipeline:

```text
authenticate + stamp tenant/retention
  -> everr_queue (disk persistence, batching, retries)
  -> everr_usage processor
  -> synchronous storage exporter
```

The destination pipeline has only the metering processor and one exporter.
Disable both `sending_queue` and `retry_on_failure` on that exporter. The queue
owns retries, with `max_elapsed_time: 0s`, so retriable outages do not exhaust a
retry time budget. Queue-full and disk-write failures return an error to the
receiver rather than acknowledging data that was not persisted. Permanently
invalid telemetry can still be rejected by the downstream pipeline.

Keep the queue directory and connector ID stable across restarts. Docker Compose
mounts a named volume at the example path, and the image makes the directory
writable by its collector user. Other deployments must mount persistent storage
at `EVERR_QUEUE_DIRECTORY` (default `/var/lib/everr/queue`). Each collector replica
needs its own directory/volume. Losing the volume loses the queued telemetry.
Capacity defaults to 10,000 requests, not bytes; size disk capacity and queue
limits for the deployment's request sizes and expected outage duration.

Connect the receiver to a separate metrics pipeline with no processors and one
exporter targeting the same metrics tables. This exporter's `sending_queue.enabled`
and `retry_on_failure.enabled` must both be `false`. Do not put a retrying proxy or
another buffering collector between this exporter and storage. The extension
validates pipeline topology at startup. Exactly one usage receiver may claim an
extension, including across pipelines.

The storage exporter must acknowledge completed storage and propagate errors,
including partial failures. Backend settings remain the deployment's responsibility.
For ClickHouse the example explicitly sets `wait_for_async_insert=1` and
`materialized_views_ignore_errors=0`. Replacing the database requires verifying
the replacement exporter's acknowledgement, filtering, and deduplication behavior.

Usage points receive an explicit retention window (90 days by default), independent
of the source signal's retention. Configure a window covering the billing and
dispute period. This change does not add a permanent invoice ledger.

## Failure contract

- A failed or ambiguous export contributes zero usage, including partial writes.
- The persistent queue retries unsuccessful export attempts. Each successful
  attempt contributes its measurement once, even if earlier ambiguous attempts
  stored extra copies.
- Accepted telemetry survives process restarts while its queue volume remains
  available. A crash, cancellation, accumulator limit, or failed publication can
  still lose usage metrics.
- Every queued request carries an overwritten, server-generated collector-start
  marker in persisted request metadata. It is never emitted as a telemetry
  attribute. After restart, all older requests are delivered without billing,
  including requests that had not previously reached storage. This intentionally
  undercounts to avoid charging twice when a crash follows usage publication but
  precedes deletion of the queue entry.
- Queue batching always partitions by that marker, so recovered requests cannot
  borrow a fresh request's billing eligibility. Missing or foreign markers cannot
  contribute usage. The queue overwrites client-supplied markers on admission.
- A drained snapshot is never restored or replayed. Customer and internal copies
  may differ if one publication fails. Do not add the two copies together.
- At most `max_series` tenant/signal totals are retained per interval. New series
  beyond that bound are dropped and reported in collector logs. Individual totals
  cannot exceed `2^53` bytes, preserving exact values in Float64 metric storage.
- Repeated client submissions are separate ingestion calls. Exporter success does
  not distinguish newly inserted rows from a backend-deduplicated no-op. This is
  not an exactly-once ledger for unique records, and cannot provide that guarantee
  without a stable submission identity and storage receipts.

Usage is published directly from the receiver, bypassing metering, so it never
charges for itself. A final flush is attempted on receiver shutdown; measurements
finishing after that flush can be lost.

## Validation

Run `go test -race ./...` in this directory and `make build` in `collector`.
The tests exercise measurement across tenants and all signal types, exporter queue
and retry behavior, namespace protection, concurrent drains, limits, topology
validation, disk-backed recovery for every signal, mixed recovered/fresh batches,
and failed publication without replay. For end-to-end validation,
send uniquely marked telemetry through an authenticated collector and query the
fresh payload and usage rows through Everr. Check both ownership copies and
confirm the reserved namespace cannot be forged.
