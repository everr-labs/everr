## Unreleased

### Breaking changes - CLI command groups

- Moved commands under grouped namespaces: `everr cloud login/logout`, `everr ci status/watch/runs/show/logs/grep`, and `everr local start/status/query/endpoint`.
- Removed the retired CLI commands `everr test-history`, `everr slowest-tests`, `everr slowest-jobs`, and `everr workflows`, along with their `/api/cli/*` backend routes.

### Breaking changes - `everr local`

- Removed `everr local traces` and `everr local logs`, along with the filter flags `--service`, `--level`, `--trace-id`, `--from`, `--to`, `--attr`, `--name`, `--egrep`, and `--target`.
- New `everr local query "<SQL>"` passes SQL to the collector's `/sql` endpoint.
- Migration: previous invocations map to SQL queries. Example:
  - `local logs --level ERROR --from now-1h` -> `local query "SELECT Timestamp, ServiceName, SeverityText, Body FROM otel_logs WHERE SeverityNumber >= 17 AND Timestamp > now() - INTERVAL 1 HOUR ORDER BY Timestamp DESC LIMIT 200"`
  - `local traces --service X --trace-id abc` -> `local query "SELECT * FROM otel_traces WHERE ServiceName='X' AND TraceId='abc' LIMIT 50"`
- Existing shell aliases and scripts must be updated. The local telemetry directory's on-disk format has changed; previous `otlp-*.json` files are ignored.
- `--telemetry-dir` was removed. The CLI now targets its own build's collector sidecar by HTTP, so a path on disk is no longer meaningful.
- Installer size increases by about 120 MB for the shipped universal macOS collector binary because of the bundled `libchdb`.
