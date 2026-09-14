# Ingestion usage

The usage components measure decoded OTLP protobuf bytes durably accepted for
ingestion. This extension holds pending measurements, the
[processor](../../processor/everrusageprocessor) records accepted bytes, and the
[connector](../../connector/everrusageconnector/README.md) publishes monthly deltas
every minute. The standard `delta_to_cumulative` processor converts them to
cumulative counters. A dedicated usage exporter isolates publication from the
customer metrics queue. Both exporters retain native persistence, batching, and
retries and write to the same tables.

```text
authenticate + stamp tenant/retention -> usage processor -> telemetry exporter
                                            |         \-> usage connector input
                                record after queue admission
                                            |
usage connector -> delta_to_cumulative -> dedicated usage exporter
```

## Metric contract

| Field | Value |
| --- | --- |
| Name | `everr.ingestion.volume` |
| Stored type | Monotonic cumulative Sum |
| Unit | `By` |
| Publication interval | 60 seconds by default; no unchanged idle points |
| Datapoint attributes | `everr.ingestion.signal`, `everr.usage.tenant.id`, `everr.usage.month`, `everr.usage.clock.generation` |
| Signals | `logs`, `traces`, `metrics` |
| Month | UTC calendar month, `YYYY-MM`, assigned at successful admission |
| Timestamp | Latest successful admission represented by the delta |
| Resource owner | `everr.tenant.id`, the measured tenant |
| Resource service | `service.name=everr-ingestion` |
| Resource instance | A new `service.instance.id` for each extension instance |
| Scope | `github.com/everr-labs/everr/collector/usage`, version `1` |
| Retention | Fixed 365 days, independent of plan and source retention |

Monthly attribution and the point timestamp come from the same admission clock.
A flush spanning midnight emits separate deltas for the two months, each
timestamped at its latest admission. A delayed September publication therefore
retains a September timestamp even if it is written in October. When the process
clock repeats or moves backward, the meter advances `everr.usage.clock.generation`
and starts new counter streams at the actual admission time. This preserves
strict ordering within each stream without moving usage into a later month.
The generation starts at zero, survives flushes, and changes only on a clock
discontinuity accompanying a retained measurement, not on each publication.
The meter retains one clock and generation, rather than unbounded per-customer
clock history. A discontinuity starts new streams for subsequent admissions
across all customers and signals, while pending older generations remain intact.

## Counter lifetimes and monthly totals

The standard cumulative processor retains inactive streams for five minutes,
with cleanup once per minute. If a customer sends 200 bytes, goes idle beyond
expiry, then sends another 200, the processor emits two counter lifetimes, each
with value 200. With an advancing clock, the lifetimes have different
`StartTimeUnix` values. If a clock correction makes those timestamps collide,
their clock generations distinguish them. A continuously active counter without
a clock discontinuity would instead emit 200 followed by 400. Both cases total
400 bytes.

Use [customer-usage.sql](customer-usage.sql) for customer usage and billing. Supply
`month` as a `YYYY-MM` string parameter. It selects cumulative points for that
month, enforces the metric contract, takes the highest value per
`(customer, signal, service.instance.id, everr.usage.clock.generation, StartTimeUnix)`, then sums across lifetimes. Retries and out-of-order delivery do
not inflate maxima. A collector restart creates a new instance identity, while
idle expiry starts a new lifetime. Clock corrections create a new generation,
so even lifetimes whose timestamps collide at storage's one-second
precision remain distinct. The exporter preserves these identities through
queue recovery. Do not sum raw samples or discard these identities in a rollup.

The month attribute controls billing, and sample timestamps constrain scans to
that same UTC month using half-open bounds. Finalize invoices only after pending
writes have settled because a delayed snapshot can still arrive after the month
ends. Only monotonic cumulative points with unit `By`, scope name
`github.com/everr-labs/everr/collector/usage`, and scope version `1` are included.
Changing the scope version requires an explicit billing-query update.
The invoice scheduler and customer usage UI must use this query contract; they
are outside these components.

The query requires the resource owner to equal the measured customer. Tenant
access remains enforced by row-level policy. Service, metric, and month-start
time filters constrain the scan.

The current tables store metric values as Float64. Values through `2^53` bytes
are exact. For larger cumulative values, the query subtracts 1024 bytes per
lifetime, the worst-case upward rounding bound for positive Int64 counters.
This conservatively undercounts instead of overbilling. Decimal summation keeps
monthly totals exact across individually representable counter values. Integer
overflow in an exceptionally large cumulative stream can undercount; negative
samples are excluded. Pending deltas are individually capped at `2^53` bytes.

### Deferred: dashboard rounding above 8 PiB per counter lifetime

The telemetry usage dashboard applies the 1024-byte rounding allowance only to
the first sample of a lifetime, while `customer-usage.sql` applies it to the
lifetime maximum. If a counter starts at or below `2^53` bytes (8 PiB) and later
crosses that threshold, all three dashboard query shapes omit the allowance.
The dashboard can then exceed both the actual admitted bytes and the canonical
billing total. The canonical billing query remains conservative.

A reproduced two-sample lifetime, with values `9007199254740992` followed by
`9007199254740995`, produces a dashboard total of `9007199254740996` and a
canonical billing total of `9007199254739972`. The dashboard is 1 byte above
actual usage and 1024 bytes above the billing query.

This threshold is per customer/signal/month/instance/clock-generation counter
lifetime, not combined usage across customers or lifetimes. The discrepancy is
accepted for now because it requires an exceptionally large individual counter.
Follow up by making dashboard totals and trends use the same conservative
rounding policy as the canonical query, with a regression fixture that crosses
the threshold during a lifetime. Exact accounting beyond the threshold would
require preserving integer values in storage; SQL cannot recover Float64
precision already lost.

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
immediate boundary and requires the matching usage connector beside that exporter.
It also checks the publication graph: one cumulative conversion before fanout,
no downstream metering or second conversion, and dedicated usage exporters with
persistent fsync-enabled queues, blocking admission, and unlimited retries.
Customer sources cannot feed those publication pipelines or exporters.
Upstream processors, connectors, and receiver fanout are
allowed: each resulting storage admission is metered. Stamp trusted tenant
attributes before any component that loses authentication context.

```yaml
processors:
  delta_to_cumulative/usage:
    max_stale: 5m
    max_streams: 60000
service:
  pipelines:
    metrics/usage:
      receivers: [everr_usage_connector]
      processors: [delta_to_cumulative/usage]
      exporters: [clickhouse/usage]
```

The usage exporter has a separate persistent queue, with `block_on_overflow: true`
and `wait_for_result: false`. A full queue waits for capacity within the publisher's
timeout. Customer telemetry retains the existing nonblocking exporter queue.
Both exporters can share file storage because their distinct IDs namespace the
queue files. This isolates capacity, not the underlying disk or database.

Convert once, before exporter retries. Do not replay a delta through the
converter; retries belong after conversion. The pinned v0.160.0
cumulative processor is alpha and keeps its state in memory. Its `max_streams`
limit drops new streams rather than evicting active ones; size it for active
customer/signal/month/generation combinations, including rollover overlap and
old generations awaiting expiry after clock corrections. Repeated or unstable
clocks can increase stream cardinality and exhaust this existing limit. The usage
extension separately bounds each pending flush with `max_series` (default 30000).

Reserve incoming `everr.*` metric names with the standard filter processor on
all incoming metrics pipelines, before metering. Generated usage bypasses both
that filter and metering. Never route generated usage back through public ingress.

Keep exporter ID and queue directory stable across restarts. Docker Compose
mounts a named volume; other deployments need persistent storage at
`EVERR_QUEUE_DIRECTORY` (default `/var/lib/everr/queue`). Each replica needs its
own volume. Unlimited retries do not imply unlimited queue or disk capacity.

## Failure modes and remaining gaps

This is the inventory of known failure modes for the connector and separate
exporters. "Covered" means the described failure has a protection under the
configured topology and lifecycle contract, not that billing is transactional.
Cumulative counters recover only bytes still retained in their current lifetime.
They cannot recover measurements lost before conversion, or an unpublished value
whose lifetime has expired or whose process has stopped.

### Covered failure modes

| Scenario | Protection and billing behavior | Verification |
| --- | --- | --- |
| Final source admissions during graceful shutdown | The connector waits for all connected input nodes to stop before flushing, while its cumulative processor and exporter remain running. | `TestRealCollectorShutdownGraph`, including source emission during shutdown. |
| A ready tick competes with shutdown cancellation | Stopping ticks does not cancel an in-flight publication. Shutdown waits for its bounded attempt before the final flush. | `TestShutdownDoesNotCancelPeriodicPublication` and `TestPeriodicPublicationRemainsBoundedDuringShutdown`. |
| First connector input stops while other signals still admit data | All signal nodes share one publisher; only the last node flushes. Repeated shutdown cannot decrement the count twice. | `TestLastInputFlushes`. |
| Unsafe publication configuration | Startup rejects missing/duplicate cumulative conversion, nonpersistent or nonblocking usage queues, finite retries, shared telemetry exporters, publication roots reused as downstream nodes, and invalid publication paths. Connector fanout and resource rewriting remain supported. | `TestPublicationTopology` and `TestPublicationFanout`. |
| Customer metrics fill their queue | Usage has a distinct exporter ID and persistent metrics queue. Customer metrics cannot consume usage queue capacity. | `TestDedicatedUsageQueueWaitsForCapacity`. |
| Exporter retries after a lost database acknowledgment, or recovers queued data after restart | Cumulative snapshot identities survive retries and recovery. Billing uses lifetime maxima, and replayed source queues bypass admission metering. These internal retries do not add charges. | `TestPersistentAdmissionRecovery` and the storage smoke test, which produces actual duplicate rows. |
| An already-persisted counter expires while the customer is idle | Returning traffic starts a new lifetime. Summing lifetime maxima preserves prior usage without synthetic idle points. | `TestNativeCumulativeMonthlyStreams` and the idle expiry/resumption smoke test. |
| Publication crosses a UTC month boundary | Admission assigns both the month and timestamp before publication. A delayed snapshot remains in its admission month. | UTC/month rollover tests and monthly query fixtures in the smoke test. |
| The clock repeats or moves backward, including across a UTC month boundary | A new clock generation preserves the actual admission timestamp and month while keeping counter lifetimes distinct, even when stored timestamps collide. This handles corrected clock readings; it cannot infer the true time while the host clock is wrong. | `TestClockCorrectionAcrossMonth` in [meter tests](usage_test.go); `TestClockGenerationsPreserveMonthlyTotals` and `TestRepeatedClockAfterIdleExpiryKeepsDistinctIdentity` in [cumulative tests](cumulative_test.go); `verify_clock_queries` in [query fixtures](../../test/smoke/usage.py). |
| Customer sends forged `everr.*` metrics, or usage feeds its own meter | The incoming reserved namespace filter drops forged metrics. The usage pipeline bypasses metering; startup validation rejects direct metering on that publication pipeline. | Namespace smoke test and topology tests. Trusted tenant stamping and correct downstream routing remain required. |

### Mitigated or open failure modes

| Scenario | Ingestion behavior | Billing impact and remaining gap |
| --- | --- | --- |
| Usage queue is full | Its independent publisher waits for capacity with `block_on_overflow: true`. The connector's input remains a no-op returning success, so ingestion does not synchronously wait for the usage queue. | Waiting is bounded by the publication timeout, currently 10 seconds. If capacity returns in time, publication succeeds. Otherwise this becomes a failed publication. |
| Publication fails after cumulative conversion | Source ingestion continues subject to its own queue and shared resource availability. The drained delta is never replayed through conversion. | A later snapshot in the same retained lifetime includes the failed amount. Traffic in a new month or clock generation cannot recover the previous stream's unqueued tail: October admissions do not recover an unpublished September value. If no further snapshot from the old lifetime reaches the queue before expiry or process shutdown, that tail is permanently lost. Shutdown does not re-emit the cumulative processor's cached state. |
| Conversion rejects a new stream, or the meter reaches its series/byte limit | Telemetry already admitted remains accepted. Accounting limits do not roll it back. | Measurements dropped before accumulation cannot converge later. Defaults are 30,000 pending series, 60,000 cumulative streams, and a `2^53` byte cap per pending delta. Capacity must include month rollover, idle lifetimes, and overlapping clock generations. Repeated or backward clock readings can increase stream counts across all customers and signals until older generations expire. |
| Crash between telemetry admission and usage persistence | Persisted telemetry survives if the queue volume survives. Pending accounting and cumulative state are in memory. | Permanent undercount is possible, including a crash before `Record`, after `Record`, or after draining but before usage persistence. Usually this concerns the unpublished interval; failures can extend it. The two queue writes are not atomic. |
| Forced termination or insufficient shutdown grace | The process may not finish upstream shutdown and final publication. | The connector closes orderly shutdown ordering, not `SIGKILL`, process crashes, or a failed final flush. Allow time for upstream shutdown, an in-flight publication, and the final attempt. |
| Source queue rejects or ambiguously acknowledges admission | The caller receives an error; no usage is added for that call. | If persistence actually succeeded despite the error, the admission is uncounted. This deliberately favors undercounting. Definite rejection is correctly unbilled. |
| Source queue itself fills | Customer ingestion can fail according to that queue's existing nonblocking behavior. | Separating usage cannot prevent telemetry queue exhaustion. Rejected calls add no usage. |
| Disk fills, queue volume is lost, or database delivery fails permanently | Both exporters depend on the same underlying disk and database. Queue separation does not provide resource or failure-domain isolation. | Lost usage can undercount. Already-accounted source admission remains billable even if that telemetry never reaches the database: the contract is admitted bytes, not successfully stored bytes. Unlimited retries do not cover permanent errors or missing storage. |
| Counter precision or integer range is exceeded | Ingestion is unaffected by query precision. | The canonical query's conservative rounding adjustment can undercount large lifetimes. The dashboard can instead overstate usage when a lifetime crosses 8 PiB; see the [deferred rounding discrepancy](#deferred-dashboard-rounding-above-8-pib-per-counter-lifetime). Exceptional cumulative integer overflow can also undercount. |

The full-queue test verifies both isolation and a deadline on blocked usage
publication, then verifies recovery through a fresh cumulative snapshot. The
rejected-final-snapshot test proves permanent loss after native idle expiry.
These are explicit failure-contract tests, not promises that later traffic always
repairs accounting.

### Operational gaps and intentional boundaries

- Client resubmissions are new admissions and are billed separately. They are not
  the same as internal exporter retries. Upstream fanout that creates multiple
  storage admissions also meters each admission.
- Only one publisher may claim a meter. Every metered pipeline must attach its
  matching connector. Startup also validates publication conversion, queue
  protection, and isolation along configured connector edges. It cannot prove
  arbitrary custom component behavior, attribute transformations, or storage
  availability. Exercise configuration changes with the ingestion smoke test.
- Source tenant identity must be stamped from trusted authentication before
  metering. Missing tenant identity cannot be charged. The collector's wall clock
  determines the UTC admission month and timestamp. A new counter generation
  handles repeated or backward readings, including corrections across month
  boundaries. An incorrectly configured host clock can still attribute usage
  to the wrong month until it is corrected.
- Monthly invoice settlement is still outside these components. Late queued
  snapshots can change a closed month's visible total. We need a defined
  finalization policy and treatment of late arrivals; a fixed delay alone cannot
  guarantee that an arbitrarily long backlog has drained.
- Accounting losses currently have error/warning logs, not dedicated accounting
  health metrics or an independent reconciliation ledger. We cannot precisely
  quantify all lost usage from the usage metric itself. Accounting alert rules
  remain a follow-up: the deployment scrapes collector metrics but needs a log
  forwarding path before alerts on publication errors and accumulator-limit
  warnings can work.
- Production-scale CPU, allocation, memory, and saturation testing remains open.
  The connector can trigger a full payload clone in exporter fanout; shared
  resource pressure can indirectly affect ingestion even though queue waits are
  independent. Limit-exhaustion and deployment termination-grace sizing must be
  verified for the intended load.
- Customer-visible usage is authoritative for billing. No administrative copy is
  published. The [future administrative-copy design](../../connector/everrusageconnector/README.md#future-administrative-copies)
  fans out after cumulative conversion, but delivery of the copies is not atomic.
  Missing publication on one branch can leave its stored total behind the other;
  an administrative copy must not authorize billing for customer-invisible usage.
- Usage retention is 365 days. Any invoice audit history required beyond that
  needs its own retention policy. Keep exporter IDs and persistent volumes stable
  so queued history remains recoverable during rollout.

## Validation

Run `go test -race ./...` in each usage component module and `make build` in
`collector`. Tests cover measurement, tenant isolation, admission errors, native
queue retries/recovery, bounds, UTC monthly attribution, clock generations,
restarts, and month rollover through the actual upstream cumulative
processor. Failure tests cover a full persistent metrics queue while logs still
admit successfully, recovery through a later cumulative snapshot, and permanent
loss of an unpublished final value after native idle expiry. The expiry test uses
Go virtual time with the real upstream cleanup ticker. Shutdown tests cover
admissions during graceful shutdown and the final flush.
Queue tests cover customer metrics saturation, isolated usage capacity, and
bounded waiting when the usage queue is full. The smoke test also sends SIGTERM
before the first 60-second publication tick, requires shutdown within the
60-second grace period, and verifies final usage after persistent queue recovery.
This checks healthy local shutdown, not a worst-case production load guarantee.

Run [the opt-in smoke test](../../test/smoke/usage.py) against the local database:

```sh
python3 collector/test/smoke/usage.py --everr-cli everr-dev
```

It uses the real collector and separate telemetry and usage exporters. It tests
storage outages, forced restart, successful writes with lost acknowledgments, idle
resumption, retention, reserved-name filtering, and lifetime-max totals. The
idle test accelerates `max_stale` to two seconds but waits for the upstream
one-minute cleanup ticker, without replacing its clock or expiry implementation.
It also runs the canonical query through local Everr after replaying the actual
stored usage rows, including duplicates.

Test sources: [connector publication](../../connector/everrusageconnector/connector_test.go),
[Collector shutdown graph](../../connector/everrusageconnector/shutdown_test.go),
[persistent admission and queue isolation](../../processor/everrusageprocessor/persistence_test.go),
[cumulative recovery and expiry](cumulative_test.go),
[meter limits and month attribution](usage_test.go), and
[startup topology validation](topology_test.go).
