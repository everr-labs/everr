# Usage connector

The connector publishes the usage extension's pending measurements every minute.
The admission processor records bytes only after the customer telemetry exporter
accepts them into its persistent queue. Standard `delta_to_cumulative` conversion
then produces monthly cumulative usage for a dedicated usage exporter.

```text
source -> usage processor -> fan-out -> clickhouse telemetry queue
                              |
                              +-> usage connector (no-op input)
                                       |
                                delta_to_cumulative
                                       |
                                clickhouse/usage queue
```

Both exporters are unmodified ClickHouse exporters writing to the same database
and tables. Customer telemetry is exported once. Usage is customer-owned; no
administrative copy is enabled.

## Lifecycle and shutdown

The connector creates graph dependencies between metered ingestion pipelines and
usage publication. Its final flush runs after source admissions finish and before
the downstream cumulative processor and usage exporter stop.

Its input methods accept logs, traces, and metrics, return success, and neither
record nor forward source payloads. Collector creates one node per input signal,
sharing one publisher. Each node stops after its upstream processors; only the
last node stops periodic publication and flushes. The downstream cumulative
processor and usage exporter are still running then. Components must honor the
Collector lifecycle contract and finish in-flight consumption before stopping.

Stopping ticks does not cancel a publication already in flight. Each attempt is
bounded by `timeout`; shutdown waits for it before the final flush. Deployment
termination grace must allow upstream shutdown and these bounded attempts.

The extra read-only fan-out branch can cause Collector to clone customer payloads
for the mutable exporter branch. High-cardinality CPU and memory load testing
remains necessary.

## Configuration

[config.example.yml](../../config.example.yml) contains the complete configuration.
Every pipeline using a usage extension must export to its matching connector
alongside its telemetry exporter. Startup validation checks those connections.
The connector accepts `extension` (default `everr_usage`), `interval` (default
`1m`), and `timeout` (default `10s`). Only one publisher may claim an extension.

The usage pipeline bypasses admission metering and namespace filtering, converts
deltas once, and exports to `clickhouse/usage`. This exporter has its own persistent
metrics queue with `block_on_overflow: true` and `wait_for_result: false`. It waits
for queue space, within the connector's publication timeout, then acknowledges
persistence without waiting for a database write. Customer telemetry uses
a nonblocking queue. The publisher runs independently of
source consumption: a blocked usage queue does not directly block or fail customer
ingestion. Ingestion can still fail when its own queue fills or shared disk,
database, CPU, or memory pressure affects it.

See the [failure-mode inventory](../../extension/everrusageextension/README.md#failure-modes-and-remaining-gaps)
for covered gaps, remaining loss scenarios, billing consequences, and test evidence.

Exporter IDs namespace the queue files, so both exporters can share the same
fsync-enabled file storage extension and directory. Customer metrics cannot use
usage queue capacity, although disk and database failures still affect both.
Keep exporter IDs and the queue volume stable across restarts so queued requests
remain recoverable. Customer telemetry uses `clickhouse`; usage uses
`clickhouse/usage`.

The queues are not an atomic transaction. A crash between telemetry admission and
usage persistence can still undercount. A full usage queue can still exceed the
publication timeout. Never retry a drained delta through cumulative conversion;
exporter retries operate on the already-converted cumulative snapshot.

## Future administrative copies

Administrative copies are not currently enabled. To add them, use a standard
forward connector after cumulative conversion to feed customer and administrative
metrics pipelines. Rewrite only the administrative resource's `everr.tenant.id`
to the internal tenant. Preserve the measured customer attribute, month, signal,
counter start, instance identity, and cumulative value. Route both pipelines to
`clickhouse/usage`, bypassing admission metering.

This duplicates usage metrics only. The customer telemetry path and its exporter
remain unchanged. The [shutdown graph test](shutdown_test.go) already covers this
fanout arrangement with a rewritten administrative owner.

Delivery of the two copies is not atomic. A failed or timed-out publication to one
branch can leave stored copies different, even though both originate from the
same cumulative snapshot. A later snapshot can recover a missing value while the
counter lifetime survives; an unpublished final value can still be lost.
Customer-visible usage remains authoritative for billing.

## Validation

Run `go test -race ./...` in the connector, processor, and extension modules, then
`make build` in `collector`. Tests cover the real Collector shutdown graph with
native persistent queue batching and recovery.
They also cover publication cancellation, timeouts, full customer metrics queue
isolation, and bounded waiting on a full usage queue.

Run the end-to-end local storage check with:

```sh
python3 collector/test/smoke/usage.py --everr-cli everr-dev
```

It checks all signals, namespace filtering, retention, ownership, separate queue
recovery after a crash, ambiguous write retries, and idle expiry/resumption. It
also replays stored usage rows into local Everr and verifies the customer-visible
monthly totals there. See the [shared billing contract](../../extension/everrusageextension/README.md)
for measurement and query details.
