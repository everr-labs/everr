# Confirmed ingestion usage

This module measures decoded OTLP protobuf bytes after a storage exporter
confirms success. It contains an `everr_usage` extension, processor, and metrics
receiver. The upstream storage exporter is unchanged.

The processor measures each tenant before forwarding the payload, then records
only scalar totals after downstream success. The shared extension aggregates
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
grouped by tenant within each incoming processor call. Measurement includes
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
All three factories must be included in the collector distribution.

```yaml
extensions:
  everr_usage:
    internal_tenant: ${env:USAGE_INTERNAL_TENANT_ID:-}
    retention_days: 90
    max_series: 30000
processors:
  everr_usage:
    extension: everr_usage
receivers:
  everr_usage:
    extension: everr_usage
    interval: 60s
    timeout: 10s
```

Enable the extension in `service.extensions`. Put the processor last in each
metered signal pipeline, with exactly one storage exporter. An enabled sending
queue must use `wait_for_result: true` and cannot use persistent storage with
Collector v0.160.0. Export retries can remain enabled. Ingest requests now wait
through queue flushing and export retries; the example uses a one-second batch
flush timeout to limit low-volume latency. Tune batch size, concurrency, and
request timeouts together.

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
- Exporter retries happen below the processor. Eventual success contributes the
  original measurement once, even if retry attempts stored extra copies.
- A crash, cancellation, accumulator limit, or failed publication can lose usage.
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
validation, and failed publication without replay. For end-to-end validation,
send uniquely marked telemetry through an authenticated collector and query the
fresh payload and usage rows through Everr. Check both ownership copies and
confirm the reserved namespace cannot be forged.
