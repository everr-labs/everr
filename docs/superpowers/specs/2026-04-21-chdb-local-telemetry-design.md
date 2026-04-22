# chdb-backed local telemetry

**Status:** draft
**Date:** 2026-04-21
**Scope:** `collector/`, a new forked exporter repo, `packages/desktop-app/src-tauri/src/telemetry/`, `packages/desktop-app/src-cli/src/telemetry/`, `everr telemetry` CLI surface.

## Summary

Replace the file-backed local telemetry store with an embedded [chdb](https://github.com/chdb-io/chdb) (in-process ClickHouse). The Tauri sidecar `everr-local-collector` grows two new components — a ClickHouse-schema-compatible `chdbexporter` (forked from upstream `clickhouseexporter`) and a `sqlhttp` extension that serves `POST /sql` on localhost. The Rust CLI drops its OTLP-JSON parser and filter engine and becomes an HTTP client that executes SQL against the collector. Schema matches prod, so queries are portable.

## Goals

- Replace the Rust-side JSON parser + hand-written filter engine with SQL.
- Align the local telemetry schema with prod's ClickHouse OTel schema so SQL is portable between environments.
- Keep the collector's existing lifecycle (Tauri-managed sidecar) unchanged.
- Keep the AI-oriented CLI contract simple: one `query` command takes SQL, returns rows.

## Non-goals

- No Linux or Windows support for the desktop app or its telemetry (macOS-only per current product scope).
- No daemon / long-lived background service. Local telemetry is available only while the desktop app is running. This is a regression from today (file-based store worked with the app closed) and is accepted.
- No migration of existing `otlp*.json` data from previous Everr builds. Local debug data is ephemeral.
- No cluster / replicated ClickHouse engine features.
- No metrics retention policy beyond a time-based TTL (no size cap, no per-table quotas).

## Architecture

```
┌────────────────────────────────────────────┐
│ everr-local-collector (Tauri sidecar)      │
│                                            │
│ OTLP HTTP receiver ─▶ batch ─▶ chdbexporter│
│                                    │       │
│                                    ▼       │
│                              ┌──────────┐  │
│                              │   chdb   │  ← telemetry_dir/chdb/
│                              │  (lib)   │  
│                              └──────────┘  │
│                                    ▲       │
│                                    │       │
│    sqlhttp extension ◀── POST /sql ┘       │
│    health_check extension                  │
└────────────┬───────────────────────────────┘
             │ HTTP
             ▼
       everr telemetry CLI (Rust)
```

Three new pieces of code:

1. **`chdbexporter`** — a fork of upstream [`clickhouseexporter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/clickhouseexporter). The conversion logic (DDL, per-signal marshaling) is kept; the transport is replaced — `clickhouse-go` calls become `chdb-go` library calls. Lives in its own public-or-private repo, vendored into the collector via `collector/config/manifest.local.yaml`.
2. **`sqlhttp` extension** — a new OTel collector extension in `collector/extension/sqlhttp/`. Serves `POST /sql` on `127.0.0.1:{SQL_HTTP_PORT}`. Shares access to the chdb session with the exporter via a new internal package (see [Shared chdb handle](#shared-chdb-handle)).
3. **CLI rewrite** — `packages/desktop-app/src-cli/src/telemetry/` loses `otlp.rs`, `store.rs`, `query.rs`; gains `client.rs` (HTTP client).

Ports: `OTLP_HTTP_PORT` and `HEALTH_PORT` unchanged. New `SQL_HTTP_PORT` added to `packages/desktop-app/src-tauri/src/telemetry/ports.rs` and templated into `collector.yaml.tmpl`. Exposed to the CLI via `everr_core::build::sql_http_origin()`.

### Collector config (rendered)

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:{OTLP_PORT}

processors:
  batch:
    timeout: 1s
    send_batch_size: 512

exporters:
  chdb:
    path: "{TELEMETRY_DIR}/chdb"
    ttl: 48h

extensions:
  health_check:
    endpoint: 127.0.0.1:{HEALTH_PORT}
  sqlhttp:
    endpoint: 127.0.0.1:{SQL_HTTP_PORT}

service:
  extensions: [health_check, sqlhttp]
  pipelines:
    traces:  { receivers: [otlp], processors: [batch], exporters: [chdb] }
    logs:    { receivers: [otlp], processors: [batch], exporters: [chdb] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [chdb] }
  telemetry:
    metrics: { level: none }
    logs:    { level: warn }
```

### Discarded alternatives

Recorded for future readers so the rationale isn't lost:

- **File exporter on collector + chdb as a CLI-side query engine over JSON files.** Simpler on the write path, but keeps all schema logic in Rust and doesn't align with prod. Rejected in favor of a full chdb backend.
- **Ship `chdb-server` as a separate sidecar.** The `chdb-io/chdb-server` repo is a placeholder (README + LICENSE only) — vaporware. Rejected as infeasible.
- **Ship a custom Go chdb server binary** alongside the collector. More moving parts than folding everything into the existing collector. Rejected.
- **Embed chdb in the collector without a query endpoint; CLI reads files directly.** chdb's `NewSession` is a process-global singleton (`globalSession` in `chdb-go/chdb/session.go`); a second process opening the same path has no documented safety story. Rejected.

## `chdbexporter` fork

Strategy: vendor the upstream `clickhouseexporter` into a fresh repo as a one-time copy, then rewire the storage layer from `clickhouse-go` to `chdb-go`.

### What changes vs. upstream

| Upstream (`clickhouseexporter`) | Our fork (`chdbexporter`) |
|---|---|
| `clickhouse.Open(dsn)` → `*sql.DB` | `chdb.NewSession(path)` → `*chdb.Session` (via the shared handle — see below) |
| `db.ExecContext(ctx, ddl)` | `sess.Query(ddl, "")` at startup |
| Async INSERT via `clickhouse-go` | Batched INSERT via `sess.Query("INSERT … FORMAT JSONEachRow", …)`. Default format is JSONEachRow; switch to RowBinary if perf requires. |
| DSN (TCP/HTTP), TLS, auth | Filesystem `path` only. |
| `cluster`, `replication`, `compress` configs | Dropped. Config error if set. Keep `ttl`, `table_names`. |

### What stays identical

- Table DDL: `otel_traces`, `otel_logs`, `otel_metrics_sum`, `otel_metrics_gauge`, `otel_metrics_histogram`, `otel_metrics_exponential_histogram`, `otel_metrics_summary`, and the `otel_traces_trace_id_ts` / `otel_logs_trace_id_ts` materialized views.
- Column sets and per-signal row marshaling.
- Exporter batch + retry helpers from `exporterhelper`.

### Repo & vendoring

- Fork lives in a **separate repo** (name TBD, public or private — decide at step 1).
- Record the upstream SHA in `UPSTREAM.md` inside the fork.
- Sync cadence is manual. Expect low-to-moderate merge friction: the conversion logic is the stable part of upstream.
- Vendored into the collector build via `collector/config/manifest.local.yaml` like any other third-party OTel component.

### Risks

- **Insert format throughput.** JSONEachRow is simple but not cheap. Measure under realistic dev-session load; switch to RowBinary if needed.
- **DDL surface.** chdb is ClickHouse so MergeTree + TTL + MVs all work, but a few server-only knobs (cluster, replication, background merges tuning) are unavailable. Exporter errors on those config fields.
- **Upstream velocity.** Forking signs us up to periodically resync.

## `sqlhttp` extension

### Endpoint

- `POST /sql` — body: SQL text (content-type `text/plain`).
- **Response body is buffered, not streamed.** The handler runs the chdb query to completion (up to a result-size cap, below) before writing any bytes of the response. This gives us an honest error model: a chdb-side error becomes `500` with an `{"error":"…"}` envelope and zero body bytes before it, rather than an ambiguous trailing line in an already-200 ndjson stream.
- Content type: `application/x-ndjson` (chdb's `FORMAT JSONEachRow`, one JSON object per row).
- Status codes: `200` success, `400` SQL parse / read-only violation / malformed request, `413` result exceeds the buffer cap, `500` runtime chdb error, `503` when the collector is starting **or the chdb work queue is saturated** (see [Shared chdb handle](#shared-chdb-handle)). 503 responses include `Retry-After: 1`.
- Error payload: `{"error":"…"}`.
- Per-request timeout (SELECT): 5s server-side. Anything longer than that against local telemetry is a mis-query; the CLI retries with a smaller window.
- Queue-wait timeout (SELECT): 2s. If the request doesn't reach the chdb worker within 2s, return 503 instead of holding the connection open indefinitely.
- **Result-size cap:** 16 MiB of serialized JSONEachRow bytes. If exceeded, return `413 Payload Too Large` with `{"error":"result exceeded 16 MiB; add LIMIT or narrow the WHERE"}`. The CLI is expected to include `LIMIT`; this cap is a guard, not a pagination mechanism.

Health liveness is served by the existing `health_check` extension; no duplication.

### Read-only enforcement

Two-part check, both lexical. This is defense-in-depth, not a security boundary — the listener is localhost-only and the chdb session is writable (the exporter uses it).

1. **First-token allowlist.** After stripping leading whitespace, line/block comments, and any leading `(`, the first token must be one of `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `DESC`, `SHOW`. The leading-paren strip handles `(SELECT … UNION SELECT …)` and friends — valid ClickHouse top-level statements that a naive allowlist would reject.
2. **Multi-statement guard.** Reject any `;` that appears outside a string literal or comment. chdb's FFI `query_conn(conn, query, format)` takes a single SQL string; the upstream docs don't define multi-statement behavior. Rather than depend on undefined behavior, reject `;` so `SELECT 1; INSERT INTO otel_logs …` never reaches the session. Trailing `;` at end-of-input is a common habit; allow exactly one trailing `;` after stripping trailing whitespace/comments.

Implementation detail: both checks run on a single lexer pass that understands `'…'` and `"…"` string literals, `--` line comments, and `/* … */` block comments. Unit-test these explicitly (SQL injection canaries, UTF-8, escaped quotes).

### Shared chdb handle

chdb-go's `NewSession` is a process-global singleton:

```go
// chdb-go/chdb/session.go
var ( globalSession *Session )

func NewSession(paths ...string) (*Session, error) {
    if globalSession != nil { return globalSession, nil }
    ...
}
```

Three consequences:

1. **One session per process at a time.** A second `NewSession` call while a session already exists silently ignores its `path` argument and returns the first session. If the exporter and the extension open with different paths, the second caller gets the first's path — a silent footgun.
2. **`Session.Close()` resets the package-level `globalSession` to `nil`**, so the state *can* be re-opened at a new path within the same process — but `globalSession` is an unsynchronized package variable. Any `Close` → `NewSession(otherPath)` transition is only safe if no other goroutine in the process is touching the old session; otherwise you can get either stale reads/writes against a closed session or a split-brain where writes go to the old path and reads go to the new one. **This is not just a footgun — it's a silent-data-corruption hazard.**
3. **The underlying `chdbpurego.ChdbConn` is not documented as goroutine-safe.** Assume it isn't.

A naïve `sync.Mutex` around the session is insufficient. A long SELECT would hold the mutex and block ingest for its entire duration; during that window the exporter's batch queue fills and the retry path starts dropping spans under load (dev-time load tests are a realistic scenario). The mitigation is a **single worker goroutine** fed by a **bounded request channel** — requests fail fast with a clear signal when the pipeline is saturated, instead of piling up under an invisible lock.

#### Invariant: path is fixed for the process lifetime

**Once `chdbhandle.Open(path)` has succeeded, the collector process's chdb data path is fixed for the lifetime of that process.** Do not close and reopen the handle against a different path, even though chdb-go technically allows it after `Session.Close()`. The package-level `globalSession` variable is unsynchronized; any transition races with in-flight `Handle.Do` calls and can silently corrupt data (writes land at the old path, reads at the new one, or vice versa).

Enforced programmatically inside `chdbhandle`:

- `Open(path, opts)` returns an error if called a second time with a different path, regardless of whether a prior `Handle.Close` has run. First path wins for the process lifetime.
- `Handle.Close` is provided for clean shutdown of the worker + session at process exit, not for reconfiguration.
- No `Handle.Reopen` or path-change API.

Enforced operationally:

- **To change the chdb data path, kill the collector process and restart it with the new config.** Tauri's sidecar lifecycle already does this: spawning a fresh process on each app launch and SIGTERMing it on shutdown. The debug-vs-release build case (which switches between `telemetry-dev/` and `telemetry/`) is also fine because debug and release builds are distinct binaries running in distinct processes.
- Anyone running the collector standalone must not SIGHUP-reload with a new path. The collector does not implement SIGHUP today; the spec forbids adding that behavior for the path field specifically.

Introduce a new package `collector/internal/chdbhandle/`:

```go
// chdbhandle exposes a process-wide chdb session served by a single worker
// goroutine and a bounded request queue. Both the chdbexporter and the
// sqlhttp extension depend on it.
package chdbhandle

type Handle struct { /* session, worker, request chan, metrics */ }

// Open returns the process-wide Handle. The first caller's path wins;
// subsequent calls must pass the same path or receive an error.
// Starts the worker goroutine on first call.
func Open(path string, opts Options) (*Handle, error)

type Options struct {
    QueueDepth int           // default 128
    // DefaultTimeout is the upper bound for a single Do call when the caller's
    // context has no deadline. Default 30s (INSERT-friendly). Handlers that
    // serve SELECTs pass a shorter ctx deadline.
    DefaultTimeout time.Duration
}

// Do submits fn to the worker and blocks until it runs, ctx is cancelled, or
// the queue rejects the request. Returns ErrQueueFull immediately when the
// bounded channel cannot accept the request.
//
// fn runs on the worker goroutine with exclusive access to the session.
// fn MUST NOT retain the *chdb.Session after returning, and MUST NOT perform
// blocking I/O that isn't trivially bounded — the session lock is held for
// the entire duration of fn. For result streaming, fn should fully serialize
// results into a caller-owned buffer (or write to a provided io.Writer that
// the caller has already bounded) before returning.
func (h *Handle) Do(ctx context.Context, fn func(*chdb.Session) error) error
```

Concretely, the `sqlhttp` handler uses `Handle.Do` like this:

```go
var buf bytes.Buffer
err := handle.Do(ctx, func(s *chdb.Session) error {
    res, err := s.Query(sql, "JSONEachRow")
    if err != nil { return err }
    // Enforce the 16 MiB cap by refusing to copy beyond it.
    if len(res.Buf()) > maxResultBytes { return errResultTooBig }
    buf.Write(res.Buf())
    return nil
})
// buf is the full response body; write headers + body now.
```

The handler buffers inside `fn` and writes to the HTTP `ResponseWriter` outside the lock. This is why the response model is buffered — it's the shape that makes the lock-holding bound tight *and* lets us return clean error envelopes. Streaming via `QueryStream` would require holding the lock across network I/O, which negates the whole point of the bounded-queue design.

Behavior:

- **One worker goroutine** pulls requests off the channel and runs them against the session sequentially. No mutex, no read/write split.
- **Bounded channel depth:** default 128. Bursts buffer; sustained overload is rejected.
- **Non-blocking enqueue with timeout:** `Do` uses `select` on the queue with the caller's ctx deadline. If the queue is full and the deadline passes before space opens, return `ErrQueueFull`.
- **Worker-side timeout enforcement:** the worker checks `ctx.Err()` before starting the call; it does **not** interrupt an in-flight chdb query (chdb-go exposes no cancel API). A long in-flight query holds the worker — further requests either wait in the queue or get `ErrQueueFull`.
- **Metrics:** current queue depth, request wait-time histogram, per-request duration histogram, rejected count. Logged at warn level when wait-time p95 crosses a threshold (default 1s).

**Caller behavior:**

- **Exporter** (`chdbexporter`): calls `Handle.Do(ctx, insert)` per batch. On `ErrQueueFull`, returns an error from the exporter so the OTel retry queue handles it (retry/drop per `exporterhelper` policy). No special code path.
- **sqlhttp extension:** creates a ctx with a 5s per-request deadline and a 2s enqueue deadline, calls `Handle.Do`. On `ErrQueueFull` or `context.DeadlineExceeded` during enqueue → HTTP `503` with `Retry-After: 1`. On chdb-side error → `500` with the error envelope.

This is not the existing `sharedcomponent` pattern (which shares a `component.Component` across signal types within one receiver/exporter). It's a plain package-level singleton, which is appropriate since chdb-go itself enforces singleton semantics.

**Future optimization (out of scope for v1):** if the concurrency spike (see Rollout) shows chdb is safe for concurrent reads, the worker can grow into a small read pool fronted by a `sync.RWMutex`, with writes still serialized. Default is one worker until measurement justifies more.

A known flaky test in `chdb-go/chdb/session_test.go` (linked to [chdb PR #299](https://github.com/chdb-io/chdb/pull/299)) signals chdb's concurrency story is still maturing; the rollout's step 0 spike is the gate that validates this before sinking time into the fork.

## Storage, schema, retention

### On-disk layout

- chdb data: `{telemetry_dir}/chdb/` — e.g. `~/Library/Application Support/everr/telemetry-dev/chdb/` in debug, `telemetry/chdb/` in release.
- Rendered collector config: `{telemetry_dir}/.collector.yaml` (unchanged).
- Freshness sentinel: `{telemetry_dir}/chdb/.last_flush` — empty file, `touch`-ed by the exporter after each successful batch. Used by the CLI to drive the sibling-staleness banner without opening chdb.
- `otlp*.json` from previous builds: ignored. Optionally unlinked on first startup to reclaim disk; not required.

The `chdb/` directory is strictly owned by the collector process. No external consumer should read the raw files.

### Schema

Inherited from upstream `clickhouseexporter` unchanged. Tables:

- `otel_traces` — spans. Partitioned by day, ORDER BY `(ServiceName, toDateTime(Timestamp))`.
- `otel_logs` — log records, same key style.
- `otel_metrics_sum`, `otel_metrics_gauge`, `otel_metrics_histogram`, `otel_metrics_exponential_histogram`, `otel_metrics_summary`.
- `otel_traces_trace_id_ts`, `otel_logs_trace_id_ts` — materialized views indexing `(TraceId, min/max timestamp)` for cheap trace-id lookups.

Database: `default`.

### Retention

- Time TTL: **48 hours** on every table. Exporter config-driven; default `ttl: 48h`.
- ClickHouse TTL is enforced during background merges, not on a wall-clock timer. On a quiet dev machine with low ingest, merges fire infrequently and rows can survive past their TTL. Mitigations, in order of preference:
  1. Set `merge_with_ttl_timeout` in the MergeTree settings of each table's DDL (e.g. `3600` — at least one TTL-driven merge per hour regardless of incoming writes). Done once in the DDL, no runtime work.
  2. If (1) is insufficient in practice, add a periodic `OPTIMIZE TABLE … FINAL` driven by a goroutine inside the exporter on a long interval (e.g. 1h). Heavier, but effective.
- Default to (1). Revisit with (2) only if observed disk usage drifts past 48h-worth on quiet machines.
- No size cap initially. Dev-session volume is small enough (low-GB range) that a janitor isn't worth the complexity. Revisit only if disk usage becomes a complaint.

### Sibling-build detection

The existing CLI behavior ("this build's dir is empty but the other build has fresh data") still applies. Reimplement by `stat`-ing `{sibling_telemetry_dir}/chdb/.last_flush` rather than counting `otlp*.json` files. Same `STALE_SIBLING_THRESHOLD` (5 minutes).

**Inherited limitation:** the sentinel only advances on successful batches. If the collector is running but no telemetry is being emitted (app idle), the staleness banner can fire spuriously against the other build. Today's file-count check has the same property; we're not regressing, but this is a known false-positive source. Revisit together with an audit of the banner's signal-to-noise.

## CLI changes

### Removed files

- `packages/desktop-app/src-cli/src/telemetry/otlp.rs`
- `packages/desktop-app/src-cli/src/telemetry/store.rs`
- `packages/desktop-app/src-cli/src/telemetry/query.rs`

### Added files

- `packages/desktop-app/src-cli/src/telemetry/client.rs` — thin HTTP client. Exposes `query(sql: &str) -> Result<Vec<serde_json::Value>>`. Endpoint from `everr_core::build::sql_http_origin()`.

### Command surface

| Command | Behavior |
|---|---|
| `everr telemetry query "<SQL>"` | POSTs SQL to `/sql`, prints rows. `--format json\|ndjson\|table` — default `table` on TTY, `ndjson` otherwise. `--limit N` optional sugar that appends `LIMIT` if the SQL doesn't already have one. |
| `everr telemetry endpoint` | Prints OTLP ingest URL (line 1) and SQL endpoint URL (line 2). |
| `everr telemetry ai-instructions` | Canonical schema reference for the AI assistant: every table, column meanings, typical query shapes (last-N logs by service, trace-tree for a given `TraceId`, metrics over a window). |

**Removed:** `telemetry traces`, `telemetry logs`, all filter flags (`--service`, `--level`, `--trace-id`, `--from`, `--to`, `--attr`, `--name`, `--egrep`, `--target`), the Rust-side datemath integration, trace-tree hydration logic, scan-stats warnings.

### Table format

Dumb: render JSONEachRow rows as `column1 | column2 | …` with header from the first row's keys. No column-type awareness, no timestamp formatting. Humans running queries by hand can use `--format ndjson` for machine-friendly output.

### Error handling

- Collector down → exit code 2 with `"telemetry collector isn't running — start the Everr desktop app"`.
- SQL error → exit code 1, server's error envelope passed through to stderr verbatim.
- `503` response → retry once after the server's `Retry-After` (default 1s). If still `503`, surface `"telemetry collector is busy — try again in a moment"`.
- Sibling-staleness banner fires from the `.last_flush` sentinel check.

### Consequences

- The `ai-instructions` doc is load-bearing: it's now the only thing teaching the assistant the schema. Drift detection is covered in the testing section.
- Power users hand-writing SQL must know the schema. Acceptable; the target user is the AI assistant.
- No default substring / regex semantics — users write `ILIKE '%…%'` or `match(Body, '…')` explicitly.

## Lifecycle & failure modes

Lifecycle is **unchanged from today**: Tauri `setup()` spawns `everr-local-collector`; SIGTERM + 3s grace + hard-kill fallback on app shutdown; existing `kill_orphaned_collector` guard on start.

Internal startup order: `sqlhttp` extension and `chdbexporter` both call `chdbhandle.Open(path)`. First caller wins the path; if the second caller passes a different path, startup fails (both components resolve `path` from the same collector-config field, so the only way they'd disagree is a configuration bug the startup check surfaces immediately). Shutdown flushes the exporter, closes the HTTP listener, then closes the handle (which closes the underlying chdb session).

**Process-lifetime path invariant** (cross-reference to the Shared chdb handle section): the data path is fixed for the process's lifetime. Reconfiguring `TELEMETRY_DIR` requires a full process restart, not a config reload. This matches today's Tauri-driven sidecar lifecycle (kill + respawn on each app launch), so no new lifecycle work is needed — but the invariant is load-bearing and is documented here so it isn't accidentally broken by a future SIGHUP-style reload mechanism.

### Failure modes

- **Session open failure** (permissions, corrupt data dir). Collector transitions to `Disabled { reason }`, Tauri UI surfaces as today.
- **chdb work queue saturated** (bounded channel full). Exporter: `Handle.Do` returns `ErrQueueFull` → OTel retry queue handles it. Extension: `503 Retry-After: 1`. Queue-wait-time warning log when p95 exceeds 1s.
- **Long in-flight SELECT** (can't be cancelled — chdb-go's streaming API exposes `chdb_streaming_cancel_query`, but the blocking `query_conn` path used here does not). Worker is held for the query's duration; further requests queue up to `QueueDepth`, then reject. Ingest backpressure is therefore bounded at roughly 5s (the SELECT handler timeout); the 1s OTLP batch window + `exporterhelper` retry queue absorb that easily in normal operation. If p95 mutex-wait ever exceeds the 1s warn threshold, revisit with shorter timeouts or the future read-pool optimization.
- **`/sql` called during startup.** `503` with `Retry-After: 1`.
- **chdb FFI crash.** Kills the sidecar. Tauri detects via `monitor_readiness`; state → `Disabled`. In-flight batch lost (≤1s).
- **Disk full.** Exporter errors; retry queue drops on overflow. Logged, not otherwise handled.

## Platform & distribution

macOS-only (x86_64 + arm64). chdb publishes official prebuilts for both architectures; vendor via `chdb-go`'s `update_libchdb.sh`, pin a release tarball.

**Binary size impact:** `libchdb` adds roughly 60 MB stripped per arch. The collector sidecar grows from ~40 MB to ~100 MB. This ships inside the customer-facing desktop app installer (not a dev-internal build), so the installer grows by ~120 MB total across both architectures in a universal binary, or ~60 MB per arch-specific installer. Worth accepting for the schema-portability / SQL-query-surface benefit, but call it out in the PR that flips the default and in release notes.

## Testing

| Layer | What | How |
|---|---|---|
| `chdbexporter` | OTel → correct DDL + rows | Unit tests with a temp chdb session, fixtures pushed via the exporter, asserts on row counts and key columns. Lean on upstream's test corpus where reusable. |
| `sqlhttp` extension | `/sql` happy path, read-only filter, timeout, error envelope | Handler unit tests with a fake session. Integration test boots the collector and asserts round-trip. |
| Shared-component session | Exporter + extension see the same rows | Integration: send OTLP, `SELECT` immediately via `/sql`, expect rows. |
| CLI `client.rs` | HTTP client, error decoding, format flags | Unit tests with a `wiremock`-style fake. |
| CLI E2E | `everr telemetry query` against a real collector | Rewrite of `telemetry_e2e.rs`: spawn sidecar on a random port, send OTLP, query via CLI. |
| Concurrency (see Rollout step 0) | No deadlock, no FFI crash, bounded queue behavior under burst and sustained overload | Stress harness: INSERT at ~1k ops/s for 60s with a background SELECT loop at ~10 ops/s. Assert: zero FFI panics; queue-depth stays under cap during sustained load or rejects with `ErrQueueFull`; wait-time p95 < 1s at steady state; no incorrect results. A second run with a deliberate long-running SELECT validates that the exporter surfaces `ErrQueueFull` (not deadlock) and that the OTel retry path kicks in. |
| `ai-instructions` freshness | Doc's schema block stays in sync with the exporter's DDL | **Generate** the schema block of `ai-instructions` from the exporter's DDL at build time rather than hand-maintaining it and then diffing. The generator parses `SHOW CREATE TABLE` output into a normalized struct (table name → columns → types → comments), drops engine-specific bits the AI doesn't need (codecs, part-naming, settings), and emits a stable markdown section. Whitespace/codec/setting drift in upstream DDL is absorbed by the parser, not a CI failure. CI runs the generator and fails if the committed `ai-instructions` differs from freshly generated output. |

## Rollout

Step-wise; each step independently shippable. Step 4 and step 5 are **intentionally bundled into one merge** (see below).

0. **Concurrency spike (gating).** Build a throwaway `cmd/chdbstress` harness using `chdb-go` directly — no OTel, no exporter. Run the concurrency stress test described in the Testing table against a real `libchdb`. This proves out (a) no FFI panics under concurrent access through a single worker, (b) the queue-depth rejection semantics behave as designed, (c) INSERT throughput is adequate. **Must pass before step 1.** If this fails — e.g. chdb segfaults under the workload even with serialized access, or throughput is an order of magnitude off — stop and re-evaluate the approach before sinking time into the fork.
1. **Fork `clickhouseexporter`** into a new repo. Wire it to `chdb-go` via `chdbhandle`. Get the traces pipeline green end-to-end (unit tests only). No everr-repo changes. CI in this repo does not gate this step — it lives outside.
2. **Vendor the fork** via `collector/config/manifest.local.yaml`. Build the collector. Add a **smoke test in the everr repo** (integration-level, real sidecar + real OTLP push + chdb query) so that from this step onward, CI gates any regression in the fork's interaction with our collector. `file` exporter stays compiled in.
3. **Build the `sqlhttp` extension**. Wire `chdbhandle`. Land in the collector. `file` exporter still side-by-side.
4. **+5. Single merge: flip template AND rewrite the CLI.** Remove `file` from `collector.yaml.tmpl`; rewrite `src-cli/src/telemetry/*` to the HTTP client; ship both in one PR. Splitting them causes a window where `main` has the new template (no JSON files written) while the CLI still reads JSON files — `everr telemetry traces|logs` returns empty for everyone. Bundling keeps the CLI and its backing data coherent at every commit on `main`. `file` exporter stays compiled-in as a fallback but unused.
6. **Expand `ai-instructions`** with the generated schema reference. Land the build-time generator and the drift-detection CI step.
7. **Delete `file` exporter** from the collector build after a soak.

**Communicating the break.** Step 4/5 removes `everr telemetry traces|logs` and all filter flags (`--service`, `--level`, `--trace-id`, `--from`, `--to`, `--attr`, `--name`, `--egrep`, `--target`) from the CLI. This breaks any shell alias, script, or doc that referenced them. Include a CHANGELOG/release-notes entry with the migration: "every old invocation maps to a `telemetry query "SELECT … WHERE …"`; see `everr telemetry ai-instructions` for the schema."

## Open items

- Fork repo name and visibility (public vs. private).
- Confirmed `libchdb` prebuilt filename / SHA to pin on first vendoring.
- Whether to surface queue-saturation / wait-time warnings in Tauri's UI (eventing out of the sidecar) or only in collector logs.
- Queue depth default (currently 128), wait-time warning threshold (currently p95 > 1s), and result-size cap (currently 16 MiB) — tune with data from step 0's spike.
- The `.last_flush`-based staleness banner inherits a known false-positive when the app is up but emitting nothing; fold into a broader audit of the banner's signal-to-noise.
