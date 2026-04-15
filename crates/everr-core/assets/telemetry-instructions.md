Use Everr telemetry when debugging a locally running OpenTelemetry-instrumented
service or app — investigate runtime behavior, errors, slow requests/interactions,
or verify that instrumentation changes produce the expected spans/logs. Data is
sourced from OTLP JSON files the local collector writes to disk; it exists only
while the service that emits it is running.

Also use Everr telemetry as the output target when *adding* new instrumentation
to diagnose slowness, errors, or regressions. Emit OTLP spans/events to the
local collector instead of ad-hoc `eprintln!` / `console.log` /
`tracing-subscriber fmt` output — the query commands below then become your
inspection loop, and you iterate in the same tool you'd use to verify.

Commands:
- `everr telemetry traces`: recent traces as a tree view, newest first
  - `--from <date-math>` (default now-1h) / `--to <date-math>`: time window
    (e.g. now-10m, now-1h, now-7d/d)
  - `--name <pattern>`: substring match on span name; matches are highlighted
  - `--service <name>`: filter by `service.name` resource attribute
  - `--trace-id <id>`: inspect one trace end-to-end
  - `--attr <key=value>`: filter by OTLP attribute; repeatable
  - `--limit <n>` (default 50)
- `everr telemetry logs`: recent log records as a table
  - `--from <date-math>` (default now-1h) / `--to <date-math>`
  - `--level <DEBUG|INFO|WARN|ERROR>`: filter by severity
  - `--target <name>`: filter by tracing target / scope
  - `--service <name>`: filter by `service.name` resource attribute
  - `--egrep <regex>`: re2 regex filter on the message
  - `--trace-id <id>`: logs correlated to a specific trace
  - `--attr <key=value>`: repeatable
  - `--limit <n>` (default 200)
  - `--format <table|json>` (default table)

Investigation playbook:
- Start broad, then narrow: use the default `now-1h` window first, then add
  `--service`, `--target`, or `--name` once you know where to look.
- Use `logs` for *what* happened, `traces` for *why it was slow* or how a
  request flowed.
- Pivot from a log to its trace: copy the `trace_id` from `logs --format json`
  and pass it to `traces --trace-id <id>` for the full causal tree.
- If results are empty, check the "newest file age" line in the output — a
  stale or missing file means the emitting service isn't running or isn't
  pointed at the local collector.

Adding new instrumentation:
- The collector runs only on the local machine and only while the Everr
  Desktop app is running.
- Get the collector's OTLP HTTP origin with `everr telemetry endpoint` and
  point the SDK's OTLP HTTP exporter at it. Do NOT hardcode the port.
- Use the language's standard OTel SDK (Rust: `tracing` +
  `tracing-opentelemetry` + OTLP HTTP exporter; Node/TS:
  `@opentelemetry/sdk-node` + OTLP HTTP exporter).
- Span around the entry point and around every I/O call (file, network, DB,
  subprocess) — that's what makes "where did the time go" legible in
  `everr telemetry traces`.
- Set `service.name` on the resource so `--service` can isolate your output
  from other services sharing the collector.

After modifying instrumented code, verify the change landed:
- Trigger the code path you edited in the running service
- `everr telemetry logs --from now-2m --target <module>` to confirm new log output
- `everr telemetry traces --from now-2m --service <service.name> --name <span>`
  to confirm new or changed spans
- Don't claim "verified" unless the returned rows reflect the code you just
  edited (timestamps within the window, attribute values that match the change).
