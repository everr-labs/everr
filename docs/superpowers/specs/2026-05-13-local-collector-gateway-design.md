# Local collector gateway and chDB exporter reset

**Status:** approved design
**Date:** 2026-05-13
**Scope:** `collector/`, `crates/everr-core/`, `packages/desktop-app/src-cli/`, local telemetry smoke tests.

## Summary

Replace the current third-party `third_party/chdbexporter` with a fresh local exporter copied from OpenTelemetry Collector Contrib's `exporter/clickhouseexporter` at `v0.152.0`. The local collector binary becomes a hand-maintained gateway process that owns startup, initializes the shared chDB instance, starts the SQL HTTP API, generates the OTel Collector config internally, and then runs the Collector in-process.

The main CI/CD collector also upgrades to OTel Collector and Contrib `v0.152.0`. `spanmetrics` is dropped from the main collector build because Everr is not using it.

## Goals

- Start the local chDB exporter anew from upstream `clickhouseexporter` `v0.152.0`.
- Move `chdbexporter` into `collector/exporter/chdbexporter`.
- Remove `third_party/chdbexporter`.
- Make `everr-local-collector` a hand-maintained gateway binary instead of an OCB-generated entrypoint.
- Let the gateway initialize one shared chDB handle and pass it into both `sqlhttp` and `chdbexporter`.
- Move `sqlhttp` out of OTel extension land and into the gateway.
- Generate local Collector config inside the gateway. No local YAML config file for now.
- Upgrade both local and main collector dependencies to OTel `v0.152.0`.
- Keep a plain-language summary of all changes made to upstream `clickhouseexporter`.

## Non-goals

- No external Collector YAML support for the local gateway in this pass.
- No separate local collector child process. The gateway and Collector run in the same process.
- No remote ClickHouse support in `chdbexporter`.
- No `spanmetrics` in the main collector build unless a future feature needs it.
- No generated Drizzle or database migrations.

## Current State

Today the local collector is built by OCB from `collector/config/manifest.local.yaml`. The generated binary loads a runtime YAML config written by Rust code from `crates/everr-core/assets/collector.yaml.tmpl`.

The current local chDB path is passed into both:

- exporter `chdb`
- extension `sqlhttp`

Both components open the chDB handle by path. They share a process-wide singleton indirectly through the existing exporter package. This works, but the ownership boundary is backwards for the new architecture: the Collector owns component startup, while the desired system needs the gateway to own shared chDB initialization first.

## Architecture

The new local process is:

```text
everr-local-collector gateway
  ├─ shared chDB handle
  ├─ sqlhttp server
  │    └─ POST /sql -> shared chDB handle
  └─ embedded OTel Collector
       └─ OTLP HTTP receiver -> batch -> chdbexporter -> shared chDB handle
```

Startup order:

1. Parse gateway CLI options.
2. Initialize the shared chDB handle for the configured database path.
3. Start the gateway-owned health/readiness endpoint.
4. Start `sqlhttp` on the configured SQL HTTP endpoint.
5. Build the local OTel Collector config in memory.
6. Create Collector factories manually in Go.
7. Inject the shared chDB handle into `chdbexporter`.
8. Run the OTel Collector in the same process.

The gateway owns readiness. Local health should report ready only when chDB is initialized, `sqlhttp` is listening, and the embedded Collector is running.

## Gateway CLI

The gateway accepts URLs as its public CLI contract:

```text
everr-local-collector \
  --otlp-http-endpoint http://127.0.0.1:54318 \
  --health-http-endpoint http://127.0.0.1:54319 \
  --sql-http-endpoint http://127.0.0.1:54320 \
  --chdb-path "/path/to/telemetry/chdb" \
  --ttl 7d
```

`--ttl` defaults to `7d`.

`--health-http-endpoint` is gateway-owned, not Collector-owned. It is included so debug builds, release builds, and tests can choose different readiness ports without relying on hard-coded Go defaults.

Internally the gateway may parse URLs into listen addresses, because the OTel HTTP receiver and Go HTTP server listen on addresses like `127.0.0.1:54318`. The CLI should stay URL-based because the Rust callers already deal in origins.

## Generated Collector Config

The gateway generates the local Collector config in memory. The exporter config does not include a chDB path because the gateway owns that path and injects the shared handle.

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:54318
        cors:
          allowed_origins: ["*"]

processors:
  batch:
    timeout: 250ms
    send_batch_size: 512

exporters:
  chdb:
    ttl: 7d

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
  telemetry:
    metrics:
      level: none
    logs:
      level: warn
```

## Proposed Package Layout

```text
collector/
  cmd/
    everr-local-collector/
      main.go
  exporter/
    chdbexporter/
      UPSTREAM.md
      EVERR_CHANGES.md
      ...
  internal/
    localgateway/
      chdb/
      sqlhttp/
      config/
```

`collector/cmd/everr-local-collector` is the hand-maintained gateway binary.

`collector/exporter/chdbexporter` is the fresh copy of upstream `clickhouseexporter` changed for local chDB.

`collector/internal/localgateway/sqlhttp` reuses the existing SQL validation, parameter substitution, and HTTP handler behavior from `collector/extension/sqlhttp`, but it is no longer an OTel extension.

`collector/internal/localgateway/chdb` owns the shared handle abstraction. It should keep the important invariant from the current code: one chDB path is fixed for the process lifetime.

## chDB Exporter Reset

Source baseline:

- Upstream repo: `open-telemetry/opentelemetry-collector-contrib`
- Upstream package: `exporter/clickhouseexporter`
- Upstream tag: `v0.152.0`

`collector/exporter/chdbexporter/UPSTREAM.md` records the exact source tag and commit used for the copy.

`collector/exporter/chdbexporter/EVERR_CHANGES.md` records every meaningful change from upstream in simple language. Initial expected entries:

- Component renamed from ClickHouse exporter to chDB exporter.
- Remote ClickHouse client setup removed from the runtime path.
- Exporter receives a gateway-owned shared chDB handle instead of opening a connection from DSN/path config.
- Remote-only options removed or rejected, including DSN, auth, TLS, cluster, and replication options.
- Upstream table schemas and row conversion logic kept where they still fit local chDB.
- Default local TTL set to `7d`.
- `v0.152.0` ClickHouse exporter behavior reviewed and noted, including the `v0.151.0` logs table schema update.

The exporter should keep the upstream conversion and table-shaping code as close as practical. The main fork point is storage execution: SQL should go through the injected chDB handle.

## Main Collector Upgrade

`collector/config/manifest.yaml` upgrades OTel Collector and Contrib components to `v0.152.0`.

The main collector keeps only components that are actually used. `spanmetricsconnector` is removed from the build because Everr is not using it.

The main collector can continue to use OCB. Builder-generated relative replace paths introduced around OTel `v0.151.0` are acceptable.

## Rust Integration

The Rust local collector startup no longer writes a YAML file for local telemetry.

The CLI sidecar startup still extracts embedded assets, including the local collector binary and `libchdb.so`, then spawns the collector with explicit flags:

- `--otlp-http-endpoint` from `everr_core::build::otlp_http_origin()`
- `--health-http-endpoint` from `everr_core::build::healthcheck_origin()`
- `--sql-http-endpoint` from `everr_core::build::sql_http_origin()`
- `--chdb-path` from `everr_core::build::telemetry_dir().join("chdb")`
- `--ttl 7d`

Existing origin helpers remain useful. `write_config()` and the collector YAML template become local-startup dead code and should be removed or narrowed once no callers need them.

## Error Handling

Gateway startup should fail fast when:

- endpoint URLs cannot be parsed
- endpoint URLs are not local HTTP URLs
- chDB path is empty
- chDB cannot initialize
- `sqlhttp` cannot bind
- the embedded Collector cannot start

`sqlhttp` should preserve the current behavior:

- only read-only SQL is allowed
- multi-statement SQL is rejected
- request body size is capped
- result size is capped
- saturated chDB queue returns `503` with `Retry-After: 1`
- startup/not-ready returns `503`

The shared chDB handle should keep bounded queue behavior so long queries do not create unbounded memory growth.

## Testing

Go checks:

- `go test` for the gateway packages.
- `go test` for `collector/exporter/chdbexporter`.
- `make -C collector build` for the main collector.
- local gateway build.

Smoke checks:

- start the local gateway with test ports and temp chDB path
- send OTLP logs to the OTLP HTTP endpoint
- query them through `POST /sql`
- reject write SQL through `POST /sql`
- verify `--ttl 7d` renders into exporter config
- verify batch timeout is `250ms`

Rust checks:

- update local-start tests to assert gateway flags instead of `--config`.
- update CLI sidecar tests that expected `.collector.yaml`.
- keep health/status tests against the local health endpoint.

## Rollout Notes

This is a local telemetry architecture change, not a data migration. Existing local chDB data is debug data and can be treated as ephemeral.

The main risk is losing parity with upstream `clickhouseexporter` while replacing its storage layer. `EVERR_CHANGES.md` is part of the mitigation: it gives future maintainers a clear list of what changed and why.
