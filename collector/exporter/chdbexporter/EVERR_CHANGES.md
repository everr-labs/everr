# Everr Changes To Upstream ClickHouse Exporter

This file records the meaningful differences from upstream `open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter` at `v0.152.0`.

## Initial copy

- Copied upstream `exporter/clickhouseexporter` from tag `v0.152.0`.
- Changed the Go module path to `github.com/everr-labs/everr/collector/exporter/chdbexporter`.
- Removed upstream local-monorepo `replace` directives from `go.mod` so this repo resolves published OTel Contrib packages.
- Added a local `internal/traceutil` helper because Go does not allow this package to import upstream's `internal/coreinternal/traceutil`.

## Planned local changes

- Inject a gateway-owned chDB handle instead of opening a ClickHouse network connection.
- Remove remote ClickHouse runtime options that do not apply to local chDB.
- Keep upstream table schema and OTLP row conversion behavior where chDB supports it.
- Use `7d` as the local default TTL.
- Keep the `v0.151.0` upstream logs table schema update unless chDB rejects a specific DDL feature.
