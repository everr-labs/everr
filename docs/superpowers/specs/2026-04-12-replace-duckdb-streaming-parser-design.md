# Replace DuckDB with Streaming OTLP Parser

**Date:** 2026-04-12
**Goal:** Remove DuckDB from the CLI, replace it with a direct streaming JSON parser for telemetry logs and traces, and redesign the traces output as a tree view.

**Constraints:**
- **macOS only.** No cross-platform considerations — platform-specific paths and behaviors are assumed macOS.
- **No backward compatibility.** This is a clean replacement. The DuckDB code path, its error variants, and its output shapes are deleted without shims or deprecation periods.

## Motivation

DuckDB + its `otlp` community extension add significant startup latency to `everr telemetry` commands. The extension also requires network access on first use, caching infrastructure, and a warm-up binary for tests. The actual query workload — read JSON files, filter, sort, limit — doesn't need an embedded database.

## OTLP Streaming Parser

### Store changes (`store.rs`)

`TelemetryStore` drops the DuckDB `Connection`. It becomes a wrapper around the telemetry directory path, responsible for:

- Locating and listing `otlp*.json*` files sorted by mtime (newest first)
- Providing the directory path for header/banner logic

Existing helpers (`newest_otlp_mtime`, `count_otlp_files`) stay unchanged.

`StoreError` simplifies:
- Keep `DirMissing(PathBuf)`
- Replace `ExtensionUnavailable` and `Query(duckdb::Error)` with `Io(std::io::Error)` only for directory-level failures that prevent the scan from starting (for example, failing to enumerate the telemetry directory).

Per-file failures are not returned as `StoreError`. If opening or reading a specific `otlp*.json*` file fails, the query skips that file, increments a warning counter, and continues scanning the rest. `commands.rs` prints one stderr summary after rendering results, e.g. `warning: skipped 2 unreadable telemetry files`. The CLI should preserve partial results whenever at least one file was readable.

### OTLP struct definitions (`otlp.rs`)

New module with serde-deserializable structs matching the OTLP JSON Protobuf encoding:

- `ExportTraceServiceRequest` → `resourceSpans[]` → `scopeSpans[]` → `spans[]`
- `ExportLogsServiceRequest` → `resourceLogs[]` → `scopeLogs[]` → `logRecords[]`
- Shared types: `Resource`, `KeyValue`, `AnyValue`

Only the fields needed to produce `TraceRow`/`LogRow` are defined. Unknown fields are ignored via `#[serde(default)]` / `deny_unknown_fields` is NOT used.

Important constraint: the top-level signal arrays (`resourceSpans`, `resourceLogs`) must not default to empty collections on the concrete request structs. Their presence/absence is the discriminator between trace and log envelopes.

#### Mixed-signal file handling

The collector writes both trace and log envelopes into the same `otlp.json` file (one JSON object per line). A single file typically contains interleaved `ExportTraceServiceRequest` and `ExportLogsServiceRequest` lines. The parser uses explicit key-based dispatch, not `#[serde(untagged)]`, to discriminate. A naive untagged enum is unsafe here: with ignored unknown fields and defaulted collections, a log line can deserialize as an "empty traces" payload (or vice versa) and be silently misclassified.

```rust
#[derive(Deserialize)]
struct RawEnvelope {
    #[serde(rename = "resourceSpans")]
    resource_spans: Option<serde_json::Value>,
    #[serde(rename = "resourceLogs")]
    resource_logs: Option<serde_json::Value>,
}
```

Dispatch rule:

- `resourceSpans` present, `resourceLogs` absent → deserialize as `ExportTraceServiceRequest`
- `resourceLogs` present, `resourceSpans` absent → deserialize as `ExportLogsServiceRequest`
- neither present → skip as malformed / unknown future signal
- both present → skip as malformed (the collector does not emit mixed-signal objects)

The `traces()` method keeps only trace envelopes and ignores log envelopes; the `logs()` method does the inverse. This is not an error — a log line inside `traces()` is expected, not malformed. Truly malformed lines (partial writes, corrupt JSON) are skipped silently.

#### Timestamp resolution

OTLP JSON encodes timestamps as string-encoded nanosecond integers (`timeUnixNano`, `startTimeUnixNano`, `endTimeUnixNano`, `observedTimeUnixNano`). These do **not** deserialize into `u64` automatically via plain serde. The OTLP structs must therefore parse them from strings explicitly, either with a small custom deserializer or a `String` intermediate:

```rust
fn de_opt_u64_from_str<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    raw.map(|s| s.parse::<u64>().map_err(serde::de::Error::custom))
        .transpose()
}
```

Fields such as `timeUnixNano`, `startTimeUnixNano`, `endTimeUnixNano`, and `observedTimeUnixNano` should use that helper (or equivalent) so the parser accepts the real JSON produced by the collector.

For **spans**, `duration_ns` is computed as `endTimeUnixNano - startTimeUnixNano`.

For **logs**, the Rust opentelemetry-appender-tracing bridge only sets `observedTimeUnixNano` (not `timeUnixNano`). The parser must replicate the current DuckDB COALESCE logic: prefer `timeUnixNano` if non-zero, fall back to `observedTimeUnixNano`. Both fields deserialize as `Option<u64>` (they may be absent or `"0"`). The resolution function:

```rust
fn resolve_log_timestamp(time: Option<u64>, observed: Option<u64>) -> u64 {
    match time {
        Some(t) if t > 0 => t,
        _ => observed.unwrap_or(0),
    }
}
```

This is load-bearing for real desktop app logs — without it, `--since` filtering and timestamp ordering break.

#### OTLP enum mapping

Span `kind` and `status.code` arrive as integers in the JSON encoding. The parser maps them to the same string values DuckDB's extension produces:

| Field | Value | String |
|-------|-------|--------|
| `kind` | 0 | `UNSPECIFIED` |
| `kind` | 1 | `INTERNAL` |
| `kind` | 2 | `SERVER` |
| `kind` | 3 | `CLIENT` |
| `kind` | 4 | `PRODUCER` |
| `kind` | 5 | `CONSUMER` |
| `status.code` | 0 | `UNSET` |
| `status.code` | 1 | `OK` |
| `status.code` | 2 | `ERROR` |

### Query replacement (`query.rs`)

`query.rs` exposes three public methods on `TelemetryStore`. The first two are the existing query entry points with updated return types; the third is new for tree mode.

#### `logs()` — flat log query

```rust
pub fn logs(&self, filter: LogFilter) -> Result<(Vec<LogRow>, ScanStats), StoreError>
```

Pipeline: glob files → read lines → dispatch envelopes → flatten log records → apply filters (`--since`, `--level`, `--grep`, `--trace-id`) → sort by timestamp descending → apply `--limit` → return.

#### `traces_flat()` — flat span query (JSON mode)

```rust
pub fn traces_flat(&self, filter: TraceFilter) -> Result<(Vec<TraceRow>, ScanStats), StoreError>
```

Same pipeline as `logs()` but for spans: glob → read → dispatch → flatten spans → apply filters (`--since`, `--name`, `--trace-id`) → sort by timestamp descending → apply `--limit` as a row cap → return.

This is used by `--format json` and is the direct replacement for the current `traces()`.

#### `trace_trees()` — grouped tree query (table mode)

```rust
pub struct TraceTree {
    pub trace_id: String,
    pub activity_timestamp_ns: u64,
    pub service_name: String,
    pub spans: Vec<TraceRow>,
}

pub fn trace_trees(&self, filter: TraceFilter) -> Result<(Vec<TraceTree>, ScanStats), StoreError>
```

Two-pass pipeline (see "Search-oriented workflow" below for details):

1. **Discovery pass:** scan files with filters, collect candidate `trace_id`s and per-trace `activity_timestamp`
2. Sort candidates by `activity_timestamp` descending, apply `--limit` at the trace-group level
3. **Hydration pass:** rescan files without `--since`, collecting all spans for the selected `trace_id`s only
4. Return one `TraceTree` per trace, spans unsorted (tree building is the renderer's job)

Both passes share the same file-scanning and envelope-dispatch code. The hydration pass produces its own `ScanStats`; the returned `ScanStats` is the merged total of both passes.

`commands.rs` calls `trace_trees()` for table mode and `traces_flat()` for JSON mode. Tree building (parent/child ordering, box-drawing) lives in `commands.rs` — it receives `Vec<TraceTree>` and renders.

#### Shared scan internals

All three methods share the same core loop:

1. Glob `otlp*.json*` files, sorted newest-first by mtime
2. Read each file line-by-line via `BufReader`
3. Dispatch each line by top-level OTLP signal key, then deserialize the relevant request struct
4. Flatten nested spans/logs into `TraceRow`/`LogRow`
5. Apply per-row filters in Rust

`ScanStats` tracks partial failures across the scan:

```rust
pub struct ScanStats {
    pub skipped_unreadable_files: usize,
    pub skipped_malformed_lines: usize,
}
```

`commands.rs` uses these stats for stderr summaries, but successful partial reads still exit 0.

### Filter implementation

`--since` always has a value (CLI default: `1h`), so the discovery pass always has a time cutoff. This bounds candidate selection work and memory during the first scan. The later hydration pass may still load older spans for the already-selected traces so tree rendering can stay complete.

All existing per-row filters are preserved with the same semantics:

| Filter | Traces | Logs | Implementation |
|--------|--------|------|----------------|
| `--since` | yes | yes | Compare timestamp against cutoff, skip early |
| `--name` | yes | — | Substring match on span name (`%name%` semantics) |
| `--trace-id` | yes | yes | Case-insensitive string compare |
| `--level` | — | yes | Case-insensitive match on severity text |
| `--grep` | — | yes | `regex::Regex` match on log body |

#### Limit semantics

`--limit` behaves differently depending on context — this is an intentional change from the flat view:

| Context | `--limit N` means |
|---------|-------------------|
| **Logs** (table or JSON) | Cap at N rows (unchanged) |
| **Traces — `--format json`** | Cap at N spans (unchanged, flat output) |
| **Traces — table (tree view)** | Cap at N **traces** (groups), each rendered as a complete tree |

The pipeline is: discovery pass identifies candidate traces and records each trace's newest matching/in-window `activity_timestamp` → sort candidate traces by `activity_timestamp` descending → take first N trace IDs → hydration pass loads all spans for only those selected traces → build trees. Limit is applied after grouping but **before hydration** so that trees are never truncated mid-trace and the expensive second pass only runs for traces that will actually be rendered.

### Error handling

A line that fails key-based dispatch or full request deserialization is skipped silently and counted in `ScanStats.skipped_malformed_lines`. The parser continues to the next line. This covers partial writes at rotation boundaries and any future signal types. Lines that dispatch successfully but are the wrong signal for the current query (e.g. a log envelope during `traces()`) are also silently skipped — this is normal, not an error.

## Trace Tree View

### Search-oriented workflow

Tree mode uses the `trace_trees()` two-pass query (see "Query replacement" above). The discovery pass decides *which* traces are relevant to the requested time window, while the hydration pass ensures each `TraceTree` contains all spans so the rendered tree is complete instead of a truncated within-window subtree.

`commands.rs` receives `Vec<TraceTree>` from `trace_trees()` and for each tree:

1. Builds a tree structure from the spans using `parent_span_id` relationships
2. Renders with box-drawing characters and matching-span highlighting

### Rendering format (table mode)

```
TRACE 00112233  2m ago  service: my-app
├─ http.request GET /api/foo     120ms  OK
│  ├─ db.query SELECT ...         45ms  OK      ← match
│  └─ cache.get foo               2ms   OK
└─ http.request GET /api/bar      80ms  OK
   └─ db.query SELECT ...         30ms  OK      ← match
```

- Each trace group gets a header: short trace ID, age, service name from resource attributes
- Spans are tree-indented with box-drawing characters (`├─`, `└─`, `│`)
- Matching spans get a `← match` marker and bold/colored name
- Orphan spans (parent not in data) render at root level

### Behavior by mode

| Scenario | Behavior |
|----------|----------|
| `--name`/`--since` (no trace-id) | Discovery pass finds traces with matching spans in the window; hydration pass renders each selected trace as a full tree, matches highlighted. `--limit` caps number of **traces** (not spans — this is a behavior change from the flat view where `--limit` capped rows). |
| `--trace-id` | If the trace has at least one span matching the filtered window (or no `--since` was supplied beyond the default), render one full hydrated tree, no highlighting. |
| No filters, just `--since` | Show full trees for traces that had at least one span in the window, ordered by newest in-window activity timestamp (not root timestamp). |
| `--format json` | `commands.rs` calls `traces_flat()` — flat array of `TraceRow` objects (unchanged — no tree grouping) |

### Logs output

The table shape stays the same (`TIME`, `LEVEL`, `TARGET`, `MESSAGE`), but `TARGET` gains real data.

`LogRow.target` is currently hardcoded to `""` in the DuckDB query. The new parser changes this behavior: `target` is set to OTLP `InstrumentationScope.name` if present, otherwise `""`. This is an intentional semantic improvement, so logs tests should cover both the populated and empty-target cases.

## Removal Scope

### Deleted

- `duckdb = "1.1"` dependency from `Cargo.toml`
- `src/bin/warm_otlp_extension.rs` — DuckDB extension bootstrap binary
- `tests/support/duckdb_cache.rs` — test warm-cache module
- `EVERR_DUCKDB_EXT_DIR` env var and `duckdb_cache::warm_otlp_extension()` call from `tests/support/mod.rs`
- `mod duckdb_cache;` import from `tests/support/mod.rs`
- DuckDB extension cache step and `make prepare-test-fixtures` step from `.github/workflows/build-everr-cli.yml`
- `prepare-test-fixtures` target from `Makefile` (and its use as a dependency of the `test` target)

### Added

- `regex` crate (for `--grep` filter — add as direct dependency in `Cargo.toml`)
- `src/telemetry/otlp.rs` — OTLP JSON struct definitions
- `ScanStats` / warning-summary plumbing so partial reads can succeed with explicit stderr warnings

### Modified

- `store.rs` — drop DuckDB connection, simplify error types
- `query.rs` — replace SQL with streaming parser + Rust filters
- `commands.rs` — remove `ExtensionUnavailable` error handling, replace `render_traces` with tree renderer, and print aggregated warning summaries for skipped unreadable files / malformed lines
- `tests/support/mod.rs` — remove `mod duckdb_cache`, remove `EVERR_DUCKDB_EXT_DIR` from `command()`, simplify `CliTestEnv` (no DuckDB bootstrap)
- `Makefile` — remove `prepare-test-fixtures` target, simplify `test` target to just `cargo test --workspace`

### Unchanged

- `collector.yaml.tmpl` — still writes OTLP JSON
- CLI arg definitions — same flags (see "Limit semantics" for the one behavioral change)
- `newest_otlp_mtime`, `count_otlp_files` helpers
- `render_logs` — same format
- JSON output mode for traces — flat `TraceRow` array

## Testing

- **Unit tests for parser:** Feed sample OTLP JSON lines, verify `TraceRow`/`LogRow` output. Test filter combinations. Test malformed-line skipping. Test mixed-signal files (interleaved trace and log lines) — `traces()` must ignore log lines and vice versa. Test `observedTimeUnixNano` fallback when `timeUnixNano` is absent or zero. Test that key-based dispatch does not misclassify a log line as traces or vice versa.
- **Unit tests for tree builder:** Verify parent/child ordering, orphan handling, multi-trace grouping.
- **Unit tests for hydration:** Verify that a trace with a matching child span inside `--since` still renders its older parent/root after the hydration pass.
- **Unit tests for warnings:** Verify unreadable files increment `skipped_unreadable_files`, malformed lines increment `skipped_malformed_lines`, and successful partial reads still return rows.
- **Existing test updates:**
  - `telemetry_commands.rs` — `telemetry_traces_table_renders_span_rows` must update its stdout assertion from the `"NAME"` column header to the new `"TRACE"` tree header format. JSON-mode tests (`telemetry_traces_json_format_contains_meta_and_rows`) are unchanged.
  - `telemetry_store.rs` — unit tests against `TelemetryStore::open_at()` and `traces()`/`logs()` stay structurally identical but become simpler (no DuckDB bootstrap). Assertions on row counts and field values remain valid.
- **E2E test (`telemetry_e2e.rs`):** Same structure — collector writes OTLP JSON, CLI queries it. Simpler without DuckDB warm-up.
