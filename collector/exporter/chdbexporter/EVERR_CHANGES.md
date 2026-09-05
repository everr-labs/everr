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
- Rebuilds the local store when its schema version changes
  (`schema_version.go`). The store carries the version it was built at in an
  `_everr_schema` table; when that differs from `localSchemaVersion` in the
  binary, every table is dropped and recreated. `CREATE TABLE IF NOT EXISTS`
  is the only other schema step, so without this a table created by an older
  build kept its columns, types, sort key, partition key and indexes for ever,
  and ClickHouse can rewrite none of those. Local telemetry is a rolling cache
  bounded by `ttl` and never a system of record, so a rebuild costs at most one
  ttl window. This replaced the legacy table adoption, which renamed the
  pre-rename `otel_*` tables into place to carry their rows forward; a rebuild
  drops them instead. `TestSchemaTemplatesMatchVersion` fails when a table's
  DDL changes without a version bump, because a store is only rebuilt when the
  version differs.
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

- The chDB adapter writes every timestamp as an RFC 3339 string in UTC with
  nanoseconds. ClickHouse reads a bare JSON number as the column's own unit,
  so the earlier `UnixNano` integer was right only for `DateTime64(9)` and
  wrapped in the `DateTime` metric columns. The round-trip tests in
  `exporter_chdb_roundtrip_test.go` push one row per signal through the real
  exporter into the shipped tables and read the stored timestamps back.

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
  both needed, the key pruning to the hour and the index inside it. The
  attributes are hashed rather than dropped from the key because
  `cityHash64(Attributes)` groups without ordering: rows of one series stay
  adjacent inside the hour, so the Attributes column still compresses by run,
  while the primary index holds 8 bytes per granule instead of a whole map.
- An existing store picks this shape up on the first startup after the schema
  version is bumped, which drops and recreates its tables. The TTL does not do
  it: it ages out rows, and leaves the sort key, the partition key and the
  column types exactly as they were.

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
