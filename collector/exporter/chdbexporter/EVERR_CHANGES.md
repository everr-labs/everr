# Everr Changes To Upstream ClickHouse Exporter

This file records the meaningful differences from upstream `open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter` at `v0.152.0`.

## Initial copy

- Copied upstream `exporter/clickhouseexporter` from tag `v0.152.0`.
- Changed the Go module path to `github.com/everr-labs/everr/collector/exporter/chdbexporter`.
- Renamed the Go package to `chdbexporter` so OTel `mdatagen` output matches this repository's directory/module name.
- Changed the local `go:generate` directive to call this repository's checked-in `collector/.tools/mdatagen` binary.
- Removed upstream local-monorepo `replace` directives from `go.mod` so this repo resolves published OTel Contrib packages.
- Added a local `internal/traceutil` helper because Go does not allow this package to import upstream's `internal/coreinternal/traceutil`.

## Local chDB runtime

- Added `NewFactoryWithHandle(handle)` so the gateway can inject the shared process-wide chDB handle.
- Changed the local component type from upstream `clickhouse` to `chdb`.
- Kept `NewFactory()` for normal component factory shape, but exporters started from it now fail clearly with `chdb handle is required`.
- Replaced runtime ClickHouse network connections with a local `internal.ChDBConn` adapter.
- The adapter runs DDL and queries through the shared chDB handle, and converts upstream prepared-batch inserts into `JSONEachRow` inserts for chDB.
- Insert sends update the local `.last_flush` sentinel.
- Default TTL is now `7d`.
- Validation no longer requires a ClickHouse endpoint; endpoint/DSN helpers remain only for compatibility with upstream config tests and table-name/database helpers.
- The test Makefile now prepares `libchdb.so` before running tests.

## Metrics table schema

- The five metrics tables order by
  `(ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)`,
  which is upstream's key from `v0.160.0`. `TimeUnix` and `StartTimeUnix` are
  `DateTime`, and a `minmax` index on `TimeUnix` sits with the skip indexes.
  This keeps the local tables in step with the cloud schema
  (`clickhouse/init/10-create-mvs.sql`), which the shared explorer queries read
  the same way.
- With the attributes ahead of the time column, every granule of a metric held
  points from the whole day, so a time filter pruned nothing and a 15-minute
  panel read as much as a 24-hour one. Measured on the cloud schema, 864k rows
  over a day: 864,000 rows read before, 40,960 after. The key and the index are
  both needed, the key pruning to the hour and the index inside it. See
  `docs/clickhouse-retention-rollout.md`, "Metrics sort key", for why the
  attributes are hashed rather than dropped from the key.
- `CREATE TABLE IF NOT EXISTS` leaves an existing local database on the old
  shape. A local store picks the new one up when it is recreated, or as the
  7-day TTL ages the old parts out and the store is next rebuilt.

## Planned local changes

- Remove remote ClickHouse runtime options that do not apply to local chDB.
- Keep upstream table schema and OTLP row conversion behavior where chDB supports it.
- Keep the `v0.151.0` upstream logs table schema update unless chDB rejects a specific DDL feature.
