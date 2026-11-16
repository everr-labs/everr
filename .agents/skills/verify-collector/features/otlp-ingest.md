# Authenticated OTLP ingest

A sender with an ingest key exports logs, traces and metrics to the public OTLP listeners (HTTP and gRPC) with `Authorization: Bearer <key>`. The collector asks the verifier about the key and writes the telemetry to ClickHouse with the key's tenant and the per-signal retention it returned, whatever tenant or retention the sender wrote into the payload. Metrics in the reserved `everr.*` namespace are dropped.

## Sub-features

- `ingest-http-logs`, `ingest-http-traces`, `ingest-http-metrics`: OTLP/HTTP JSON on `/v1/<signal>` returns `200` and the record lands in `app.logs`, `app.traces`, `app.metrics_sum`.
- `ingest-grpc-logs`: OTLP/gRPC `LogsService/Export` returns grpc-status `0` and the record lands in `app.logs`.
- `ingest-tenant`: `tenant_id` is the key's tenant, not the `everr.tenant.id` the sender forged on the resource and the record (Cloud and `app` profiles). With `--profile deploy` there is no tenant: `tenant_id` is empty and the forged value is gone.
- `ingest-retention`: `retention_days` is the key's value for that signal (`secret`: logs 7, traces 14, metrics 30), not the forged `everr.retention.days=3650`.
- `ingest-tenant-isolation`: two keys in a row produce rows for two tenants, each with its own retention.
- `ingest-reserved-metrics`: the forged `everr.verify.forged` gauge sent next to `verify.collector.requests` never reaches `app.metrics_gauge`.

## How to get to it (user POV)

- An OTLP SDK or exporter pointed at `<collector>/v1/logs`, `/v1/traces`, `/v1/metrics` with a Bearer key header.
- An OTLP/gRPC exporter pointed at the gRPC listener with an `authorization` metadata entry.
- A raw HTTP client posting OTLP JSON (what `$V otlp` does).

## Driving it with verify-collector

Preconditions:

- `$V doctor` prints `COLLECTOR DOCTOR OK`.
- No earlier label in this run uses the labels below.

- **HTTP logs.** Run `$V otlp ingest-http-logs logs`. Prints `--- HTTP 200 {"partialSuccess":{}}` and `marker: <RUN_ID>-ingest-http-logs`.
- **HTTP traces and metrics.** Run `$V otlp ingest-http-traces traces` and `$V otlp ingest-http-metrics metrics`. Both `--- HTTP 200`.
- **gRPC logs.** Run `$V grpc ingest-grpc-logs`. Prints `--- grpc-status 0`.
- **Second tenant.** Run `$V otlp ingest-tenant-other logs --key other`. `--- HTTP 200`.
- **Proof, logs.** Run `$V ch-until ingest-rows-logs ingest-grpc-logs "SELECT Body, tenant_id, retention_days, toString(ResourceAttributes) AS res, toString(LogAttributes) AS attrs FROM app.logs ORDER BY Body"`. Prints `found` and three rows. The `ingest-http-logs` and `ingest-grpc-logs` rows have `tenant_id` `verify-<RUN_ID>-a` and `retention_days` `7`; the `ingest-tenant-other` row has `verify-<RUN_ID>-b` and `90`. `res` shows `everr.tenant.id` equal to `tenant_id` and no `forged-by-client`; `attrs` holds only `everr.verify.marker`.
- **Proof, traces.** Run `$V ch-until ingest-rows-traces ingest-http-traces "SELECT SpanName, tenant_id, retention_days, toString(SpanAttributes) AS attrs FROM app.traces"`. One row, `retention_days` `14`, no forged attributes.
- **Proof, metrics.** Run `$V ch-until ingest-rows-metrics verify.collector.requests "SELECT MetricName, tenant_id, retention_days FROM app.metrics_sum WHERE MetricName = 'verify.collector.requests'"`, then `$V ch ingest-reserved "SELECT count() AS n FROM app.metrics_gauge WHERE MetricName LIKE 'everr.%'"`. The first shows `retention_days` `30`; the second prints `{"n":0}`.
- **Self-hosted shape.** In a run launched with `--profile deploy`, repeat **HTTP logs** and run `$V ch-until ingest-deploy-rows ingest-http-logs "SELECT Body, tenant_id, retention_days, toString(ResourceAttributes) AS res FROM app.logs"`. `tenant_id` is `""`, `retention_days` is `7`, and `res` has no `everr.tenant.id`.

## Gotchas

- `200` with `{"partialSuccess":{}}` only means the collector accepted the request. The exporter writes asynchronously with a 1s batch timeout, so always read the rows with `ch-until`.
- `app.*` tables have a retention TTL. A record with a timestamp older than its retention is accepted and then dropped at insert. `$V otlp` stamps records with the current time; a hand-written `--body` must too.
- JSON attribute columns print nested (`{"everr":{"tenant":{"id":...}}}`). Read a single path with `getSubcolumn(ResourceAttributes, 'everr.tenant.id')`.
- The verifier's answer is cached per key and origin for 30s (failures for 5s). A later stub decision for the same key does not show in `verify.log` within that window.
