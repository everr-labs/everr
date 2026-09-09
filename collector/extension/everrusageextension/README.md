# Ingestion usage

The usage components measure decoded OTLP protobuf bytes durably accepted for
ingestion. This extension holds pending measurements, the
[processor](../../processor/everrusageprocessor) records accepted bytes, and the
[receiver](../../receiver/everrusagereceiver) flushes monthly deltas every minute.
The standard `delta_to_cumulative` processor converts these to cumulative counters.
One unmodified ClickHouse exporter owns persistence, batching, and retries.

```text
authenticate + stamp tenant/retention -> usage processor -> persistent exporter
                                            |
                                record after queue admission
                                            |
usage receiver -> delta_to_cumulative -> forward/usage
                                           |      |
                                  customer copy  resource: admin tenant
                                           |      |
                                     same persistent exporter
```

## Metric contract

| Field | Value |
| --- | --- |
| Name | `everr.ingestion.volume` |
| Stored type | Monotonic cumulative Sum |
| Unit | `By` |
| Publication interval | 60 seconds by default; no unchanged idle points |
| Datapoint attributes | `everr.ingestion.signal`, `everr.usage.tenant.id`, `everr.usage.month` |
| Signals | `logs`, `traces`, `metrics` |
| Month | UTC calendar month, `YYYY-MM`, assigned at successful admission |
| Resource owner | `everr.tenant.id`, the measured tenant |
| Resource service | `service.name=everr-ingestion` |
| Resource instance | A new `service.instance.id` for each extension instance |
| Scope | `github.com/everr-labs/everr/collector/usage`, version `1` |
| Retention | Fixed 365 days, independent of plan and source retention |

Monthly attribution happens before buffering measurements for publication. A
flush spanning midnight emits separate deltas for the two months. A delayed
September publication therefore still belongs to September, even if written
in October. There is no per-flush sequence attribute.

## Counter lifetimes and monthly totals

The standard cumulative processor retains inactive streams for five minutes,
with cleanup once per minute. If a customer sends 200 bytes, goes idle beyond
expiry, then sends another 200, the processor emits two counter lifetimes, each
with value 200 and a different `StartTimeUnix`. A continuously active counter
would instead emit 200 followed by 400. Both cases total 400 bytes.

Use [customer-usage.sql](customer-usage.sql) for customer usage and billing. Supply
`month` as a `YYYY-MM` string parameter. It selects cumulative points for that
month, takes the highest value per `(customer, signal, service.instance.id,
StartTimeUnix)`, then sums across lifetimes. Retries and out-of-order delivery do
not inflate maxima. A collector restart creates a new instance identity, while
idle expiry creates a new start timestamp. The exporter preserves both through
queue recovery. Do not sum raw samples or discard these identities in a rollup.

The month attribute controls billing; sample timestamps only provide a lower
scan bound. There is deliberately no end-of-month sample cutoff, because a final
snapshot may be published after midnight. Finalize invoices only after pending
writes have settled. Previously experimental delta/sequence points are excluded.
The invoice scheduler and customer usage UI must use this query contract; they
are outside these components.

The query excludes administrative copies by requiring the owner to equal the
measured customer. It also handles our own tenant's duplicate self-copy, since
both copies have the same lifetime. Tenant access remains enforced by row-level
policy. Service, metric, and month-start time filters constrain the scan.

The current tables store metric values as Float64. Values through `2^53` bytes
are exact. For larger cumulative values, the query subtracts 1024 bytes per
lifetime, the worst-case upward rounding bound for positive Int64 counters.
This conservatively undercounts instead of overbilling. Decimal summation keeps
monthly totals exact across individually representable counter values. Integer
overflow in an exceptionally large cumulative stream can undercount; negative
samples are excluded. Pending deltas are individually capped at `2^53` bytes.

## Measurement

Bytes are the protobuf serialization size of decoded, nonempty telemetry grouped
by tenant within each incoming request, before exporter queue batching. Included:
resource and scope metadata, records, span events and links, metric buckets and
exemplars. Excluded: routing and retention resource attributes `everr.tenant.id`
and `everr.retention.days`, empty resources and scopes, and metrics without
points. Histogram observation counts are not multiplied into bytes. JSON and
protobuf requests use the same decoded measurement.

This measures accepted ingestion, not wire size, compressed database size, or
confirmed database storage. Client batching and repeated metadata affect volume.
Changing the definition after release requires a billing migration.

## Configuration

See [config.example.yml](../../config.example.yml) for complete wiring. Enable
the usage and file-storage extensions. Place the usage processor directly before
one persistent exporter, with fsync, queue-admission acknowledgment
(`wait_for_result: false`), and unlimited retries. Startup validation checks this
immediate boundary. Upstream processors, connectors, and receiver fanout are
allowed: each resulting storage admission is metered. Stamp trusted tenant
attributes before any component that loses authentication context.

```yaml
processors:
  delta_to_cumulative/usage:
    max_stale: 5m
    max_streams: 60000
connectors:
  forward/usage: {}
service:
  pipelines:
    metrics/usage:
      receivers: [everr_usage]
      processors: [delta_to_cumulative/usage]
      exporters: [forward/usage]
    metrics/usage_customer:
      receivers: [forward/usage]
      exporters: [clickhouse]
```

Convert once, before fanout and exporter retries. The standard forward connector
lets deployments add destinations after conversion. Do not replay a delta
through the converter; retries belong after conversion. The pinned v0.160.0
cumulative processor is alpha and keeps its state in memory. Its `max_streams`
limit drops new streams rather than evicting active ones; size it for active
customer/signal/month combinations, including rollover overlap. The usage
extension separately bounds each pending flush with `max_series` (default 30000).

Reserve incoming `everr.*` metric names with the standard filter processor on
all incoming metrics pipelines, before metering. Generated usage bypasses both
that filter and metering. Never route generated usage back through public ingress.

Keep exporter ID and queue directory stable across restarts. Docker Compose
mounts a named volume; other deployments need persistent storage at
`EVERR_QUEUE_DIRECTORY` (default `/var/lib/everr/queue`). Each replica needs its
own volume. Unlimited retries do not imply unlimited queue or disk capacity.
Drain any earlier experimental custom queue before switching storage identities.

## Optional administrative copy

Load [usage-admin.example.yaml](../../config/usage-admin.example.yaml) with a
second `--config` argument and set `EVERR_ADMIN_TENANT_ID`. The standard resource
processor changes only the copy's resource owner. Customer, month, signal,
counter start, values, and retention are preserved. Both copies use the same
ClickHouse exporter; no custom duplication component is involved.

The two writes can succeed independently. Our copy is for reporting, while
customer-owned stored points remain authoritative for invoices. For reporting
from our copy, query as our tenant and omit the owner/customer equality, keeping
the per-lifetime maximum calculation.

## Failure behavior

- Queue rejection or ambiguous admission returns without adding usage.
- A persisted admission is billable even if delivery later fails permanently or
  the queue volume is lost. Client resubmissions are separate admissions.
- A crash before publishing accepted bytes can undercount. Both telemetry and
  already queued cumulative usage survive collector restarts with the volume.
- The receiver never restores drained deltas. If a cumulative snapshot cannot be
  enqueued, a later snapshot in the same lifetime includes its bytes. If the
  stream expires or the process dies first, its unqueued tail can be lost.
- Retry duplicates of cumulative snapshots do not increase lifetime maxima.
- Idle expiry does not lose any values already queued. Once expired, returning
  traffic starts a new lifetime; no month-long cache or synthetic idle points.
- Publication and the administrative copy bypass metering and do not bill
  themselves. Shutdown attempts a final flush.

## Validation

Run `go test -race ./...` in each usage component module and `make build` in
`collector`. Tests cover measurement, tenant isolation, admission errors, native
queue retries/recovery, bounds, UTC monthly attribution, and month rollover
through the actual upstream cumulative processor.

Run [the opt-in smoke test](../../test/smoke/usage.py) against the local database:

```sh
python3 collector/test/smoke/usage.py --everr-cli everr-dev
```

It uses the real collector, shared exporter, and admin overlay. It tests storage
outages, forced restart, successful writes with lost acknowledgments, idle
resumption, retention, reserved-name filtering, and lifetime-max totals. The
idle test accelerates `max_stale` to two seconds but waits for the upstream
one-minute cleanup ticker, without replacing its clock or expiry implementation.
It also runs the canonical query through local Everr after replaying the actual
stored usage rows, including duplicates.
