# chDB exporter

Writes OTLP logs, traces and metrics into the local Everr store, the chDB that `everr local start` embeds. It has no other use.

The exporter creates no table. `collector/localcollector` builds the store from the migrations in `packages/app/clickhouse` and hands the exporter its chDB handle through `NewFactory`. Each push is one `INSERT ... FORMAT JSONEachRow` per landing table: `otel.otel_logs`, `otel.otel_traces` and the five `otel.otel_metrics_*` tables. The views from the migrations copy the rows into `app.*`, where queries read them.

The table names and their columns live in `internal/landing`. A test in `collector/localcollector` compares them with the migrated tables.

## Configuration

- `retention_days` (required): the number of days the store keeps a row. The exporter writes it on every resource as `everr.retention.days` and replaces a value the client sent.
- `timeout`, `retry_on_failure`, `sending_queue`: the standard exporter settings.

## Provenance

Derived from the upstream ClickHouse exporter, `exporter/clickhouseexporter` v0.165.1 in `open-telemetry/opentelemetry-collector-contrib`, under the Apache-2.0 license (see `LICENSE`). The conversion of logs, traces and metrics into rows keeps the upstream order of values.
