## Unreleased

### Breaking changes - `everr telemetry`

- Removed `everr telemetry traces` and `everr telemetry logs`, along with the filter flags `--service`, `--level`, `--trace-id`, `--from`, `--to`, `--attr`, `--name`, `--egrep`, and `--target`.
- New `everr telemetry query "<SQL>"` passes SQL to the collector's `/sql` endpoint. Use `everr telemetry ai-instructions` for the schema.
- Migration: previous invocations map to SQL queries. Example:
  - `telemetry logs --level ERROR --from now-1h` -> `telemetry query "SELECT Timestamp, ServiceName, SeverityText, Body FROM otel_logs WHERE SeverityNumber >= 17 AND Timestamp > now() - INTERVAL 1 HOUR ORDER BY Timestamp DESC LIMIT 200"`
  - `telemetry traces --service X --trace-id abc` -> `telemetry query "SELECT * FROM otel_traces WHERE ServiceName='X' AND TraceId='abc' LIMIT 50"`
- Existing shell aliases and scripts must be updated. The local telemetry directory's on-disk format has changed; previous `otlp-*.json` files are ignored.
- `--telemetry-dir` was removed. The CLI now targets its own build's collector sidecar by HTTP, so a path on disk is no longer meaningful.
- Installer size increases by about 120 MB for the shipped universal macOS collector binary because of the bundled `libchdb`.
