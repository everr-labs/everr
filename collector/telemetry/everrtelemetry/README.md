# Native receiver metric enrichment

This telemetry factory delegates configuration, resource creation, logging,
tracing, metric export, and shutdown to the standard Collector telemetry
factory. It decorates only the native receiver-helper accepted, refused, and
failed item counters for traces, metrics, and logs.

Each measurement gets `everr.ingestion.tenant.id` from `client.Info.Auth`'s
`tenant_id`. The adapter preserves the native names, units, values, receiver,
and transport labels. It neither counts customer payloads nor changes pipeline
admission or billing. Measurements without trusted tenant identity keep their
native attributes. Customer attributes cannot supply the measured tenant.

The distribution selects this factory through the builder manifest's
`telemetry` entry. There is no additional receiver or processor to configure.
Keep its dependency versions aligned with the distribution when upgrading.

## Process identity and fleet rates

The standard telemetry factory generates a `service.instance.id` UUID for each
process lifetime. Configure the Prometheus exporter with
`with_resource_constant_labels.included: [service.instance.id]` to carry that
identity on every scrape sample. The scraper must discover each replica,
rather than load-balance scrapes through a shared Service.

Prometheus exposes the tenant and instance as `everr_ingestion_tenant_id` and
`service_instance_id`. The Prometheus receiver can restore the dotted OTel
attribute names using the exporter's metadata. Promote the resulting instance
attribute to resource `service.instance.id` on the internal metrics pipeline,
preserving both forms when processing older collectors.

Compute counter deltas independently for each metric, tenant, transport, and
process before summing rates. Use elapsed sample time, exclude stale points
(`Flags & 1`), and do not compare a restarted process with its predecessor.
The first sample of a new stream is a baseline, not a rate. These operational
counters are not a replacement for durable customer billing metrics.

The native SDK cardinality limit still applies per instrument. A saturated
instrument produces an `otel.metric.overflow` series with no tenant identity;
keep that series visible as `overflow` in operational breakdowns.

## Validation

```sh
cd collector/telemetry/everrtelemetry
go test -race ./...
go vet ./...
cd ../..
make build
python3 test/smoke/receiver_metrics.py
```

To validate the scrape into local Everr, obtain the local OTLP endpoint from
`everr local status`, then run:

```sh
python3 test/smoke/receiver_metrics.py --otlp-endpoint <local-otlp-url> --everr-cli everr
```

The smoke test uses synthetic authentication, two real collector processes,
the deployed internal collector image, and a process restart. It verifies all
three signals, accepted/refused counts, forged customer routing attributes,
separate process UUIDs, and a known fleet-wide increase in locally stored data.
It uses no production credentials and cleans up its temporary collectors.
