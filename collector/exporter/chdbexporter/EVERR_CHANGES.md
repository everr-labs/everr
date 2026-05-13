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
- Insert sends update the local `.last_flush` sentinel used by sibling-build detection.
- Default TTL is now `7d`.
- Validation no longer requires a ClickHouse endpoint; endpoint/DSN helpers remain only for compatibility with upstream config tests and table-name/database helpers.
- The test Makefile now prepares `libchdb.so` before running tests.

## Planned local changes

- Remove remote ClickHouse runtime options that do not apply to local chDB.
- Keep upstream table schema and OTLP row conversion behavior where chDB supports it.
- Keep the `v0.151.0` upstream logs table schema update unless chDB rejects a specific DDL feature.
