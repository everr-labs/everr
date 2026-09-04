# Everr Changes To Upstream ClickHouse Exporter

This file records the meaningful differences from upstream `open-telemetry/opentelemetry-collector-contrib/exporter/clickhouseexporter` at `v0.160.0`, the version `collector/config/manifest.yaml` pins for the cloud collector.

## Initial copy

- Copied upstream `exporter/clickhouseexporter` from tag `v0.152.0`, then merged up to `v0.160.0`.
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

## Local additions and fixes

- Registers the `errorFingerprint` UDF when the logs exporter starts
  (`internal.CreateErrorFingerprintFunction`), so `everr local query` and the
  desktop app group Errors the way the cloud does. Kept in step with
  `clickhouse/init/04-create-error-fingerprint-function.sql`.
- Adopts legacy local table names at start (`legacy_cleanup.go`), so a store
  written by an older build keeps its rows when a table is renamed.
- Writes two placeholders, not three, for the JSON traces attribute-keys
  feature columns. Upstream writes two column names and three placeholders, so
  the insert list does not match the column list. Report this upstream.
- Keeps `tests.skip_lifecycle: true` in `metadata.yaml`, which upstream does not
  carry. The lifecycle test mdatagen generates starts an exporter built by
  `NewFactory()`, and those fail with `chdb handle is required` by design, so
  the test cannot pass here.
- Upstream switches the map skip indexes to `TYPE text(...)` on ClickHouse 26.2
  and later, and the local store runs chDB 26.5, so the local tables get text
  indexes. The cloud tables in `clickhouse/init/10-create-mvs.sql` keep
  `bloom_filter` on purpose; the note there carries the measurement. Index type
  changes cost and speed, not results, so the shared explorer queries still read
  both stores the same way.

## Metrics table schema

- The five metrics tables order by
  `(ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)`
  with `DateTime` time columns and a `minmax` index on `TimeUnix`. This was a
  local backport of upstream's `v0.160.0` key; upstream now carries it, so it is
  no longer a local difference. Kept here because it explains the cloud schema
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

## Merge to v0.160.0

- Adopted upstream's `xexporter` factory and the new **profiles** signal
  (`exporter_profiles.go` and its templates). Profiles are wired to the chDB
  handle like the other signals, so the component matches upstream, but nothing
  creates the profiles table until a pipeline uses it.
- Dropped the local `useJSON` helper and the `clickhouse.json` feature gate.
  Upstream registered that gate `WithRegisterToVersion("v0.149.0")` and removed
  it in `v0.160.0`; the call sites now read `c.JSON` as upstream does.
- Dropped the local `Delta(4)` codec on the metrics time columns. Upstream
  narrowed those columns to `DateTime` itself and writes `Delta`, which resolves
  to the same 4 bytes, so the local override bought nothing.
- Dropped `TimestampTime` from the logs tables, with the startup column
  migration that backfilled it. Upstream has no such column and asserts against
  it; the cloud read model now keys off `Timestamp` the same way, so the local
  templates are upstream's again. Existing local stores keep the column as an
  unused extra; nothing queries it.
- Kept the 7-day default TTL. Upstream's default is `0` (no TTL).

## Planned local changes

- Remove remote ClickHouse runtime options that do not apply to local chDB.
- Keep upstream table schema and OTLP row conversion behavior where chDB supports it.
- Keep the upstream `v0.160.0` table schemas unless chDB rejects a specific DDL feature.
