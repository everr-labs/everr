# Replace DuckDB with Streaming OTLP Parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove DuckDB from the CLI and replace it with a direct streaming JSON parser for OTLP telemetry, plus a new tree view for traces.

**Architecture:** A new `otlp.rs` module defines serde structs matching the OTLP JSON Protobuf encoding. `query.rs` replaces SQL queries with a streaming line-by-line parser that filters and sorts in Rust. `commands.rs` gains a tree renderer for traces. DuckDB, its extension bootstrap binary, and all related test infrastructure are deleted. Row structs keep data in OTLP-native form (raw `KeyValue` vecs, numeric enums); string conversion happens only at render time.

**Tech Stack:** Rust, serde/serde_json (OTLP JSON deserialization), regex (log grep filter), chrono (timestamp formatting)

**Constraints:**
- **macOS only.** No cross-platform code paths — platform-specific paths and behaviors assume macOS.
- **No backward compatibility.** DuckDB code, error variants, and output shapes are deleted without shims or deprecation.

**Spec:** `docs/superpowers/specs/2026-04-12-replace-duckdb-streaming-parser-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/telemetry/otlp.rs` | Create | OTLP JSON struct definitions, envelope dispatch, timestamp helpers |
| `src/telemetry/store.rs` | Modify | Drop DuckDB `Connection`, simplify `StoreError`, add `otlp_files()` |
| `src/telemetry/query.rs` | Rewrite | Streaming parser, filters, `logs()`, `trace_trees()`, `ScanStats` |
| `src/telemetry/commands.rs` | Modify | Tree renderer, `ScanStats` stderr warnings, remove `ExtensionUnavailable` handling |
| `src/telemetry/mod.rs` | Modify | Add `pub mod otlp;` |
| `Cargo.toml` | Modify | Remove `duckdb`, add `regex` |
| `src/bin/warm_otlp_extension.rs` | Delete | DuckDB bootstrap binary |
| `tests/support/duckdb_cache.rs` | Delete | DuckDB test warm-cache |
| `tests/support/mod.rs` | Modify | Remove `duckdb_cache` usage |
| `tests/telemetry_store.rs` | Modify | Update for new return types and API |
| `tests/telemetry_commands.rs` | Modify | Update trace table assertion for tree view |
| `tests/telemetry_e2e.rs` | Modify | Simplify (no DuckDB bootstrap) |
| `tests/fixtures/telemetry/otlp.json` | Keep | Same fixture, now parsed directly |
| `tests/fixtures/telemetry_hydration/otlp.json` | Create | Fixture with old root + recent child for hydration test |
| `../../Makefile` (repo root) | Modify | Remove `prepare-test-fixtures` |
| `../../.github/workflows/build-everr-cli.yml` | Modify | Remove DuckDB cache step |

All paths below are relative to `packages/desktop-app/src-cli/` unless stated otherwise.

---

### Task 1: OTLP struct definitions (`otlp.rs`)

**Files:**
- Create: `src/telemetry/otlp.rs`
- Modify: `src/telemetry/mod.rs`

This module defines the serde structs for OTLP JSON and the envelope dispatch logic. Everything else builds on this.

- [ ] **Step 1: Write tests for the timestamp deserializer**

Add at the bottom of `src/telemetry/otlp.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn de_opt_u64_from_str_parses_nanosecond_string() {
        #[derive(Deserialize)]
        struct T {
            #[serde(default, deserialize_with = "de_opt_u64_from_str")]
            ts: Option<u64>,
        }
        let t: T = serde_json::from_str(r#"{"ts":"1700000000000000000"}"#).unwrap();
        assert_eq!(t.ts, Some(1700000000000000000));
    }

    #[test]
    fn de_opt_u64_from_str_returns_none_when_absent() {
        #[derive(Deserialize)]
        struct T {
            #[serde(default, deserialize_with = "de_opt_u64_from_str")]
            ts: Option<u64>,
        }
        let t: T = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(t.ts, None);
    }
}
```

- [ ] **Step 2: Write the timestamp deserializer and OTLP structs**

Create `src/telemetry/otlp.rs`:

```rust
use serde::Deserialize;

// --- Custom deserializer for string-encoded u64 timestamps ---

pub(crate) fn de_opt_u64_from_str<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<String>::deserialize(deserializer)?;
    raw.map(|s| s.parse::<u64>().map_err(serde::de::Error::custom))
        .transpose()
}

// --- Envelope dispatch ---

#[derive(Deserialize)]
pub(crate) struct RawEnvelope {
    #[serde(rename = "resourceSpans")]
    pub resource_spans: Option<serde_json::Value>,
    #[serde(rename = "resourceLogs")]
    pub resource_logs: Option<serde_json::Value>,
}

/// Result of dispatching a single JSON line.
pub(crate) enum OtlpSignal {
    Traces(ExportTraceServiceRequest),
    Logs(ExportLogsServiceRequest),
}

/// Parse a single line and dispatch to the correct signal type.
/// Returns `None` for malformed lines, unknown signals, or lines with
/// both resourceSpans and resourceLogs (which the collector never emits).
/// Deserializes the full struct from the `Value` already captured by
/// `RawEnvelope` to avoid parsing the JSON string twice.
pub(crate) fn dispatch_line(line: &str) -> Option<OtlpSignal> {
    let envelope: RawEnvelope = serde_json::from_str(line).ok()?;
    match (envelope.resource_spans, envelope.resource_logs) {
        (Some(spans_val), None) => {
            let mut top = serde_json::Map::new();
            top.insert("resourceSpans".into(), spans_val);
            let req: ExportTraceServiceRequest =
                serde_json::from_value(serde_json::Value::Object(top)).ok()?;
            Some(OtlpSignal::Traces(req))
        }
        (None, Some(logs_val)) => {
            let mut top = serde_json::Map::new();
            top.insert("resourceLogs".into(), logs_val);
            let req: ExportLogsServiceRequest =
                serde_json::from_value(serde_json::Value::Object(top)).ok()?;
            Some(OtlpSignal::Logs(req))
        }
        _ => None, // both present, neither present, or malformed
    }
}

// --- Trace structs ---

#[derive(Deserialize)]
pub(crate) struct ExportTraceServiceRequest {
    #[serde(rename = "resourceSpans")]
    pub resource_spans: Vec<ResourceSpans>,
}

#[derive(Deserialize)]
pub(crate) struct ResourceSpans {
    #[serde(default)]
    pub resource: Resource,
    #[serde(rename = "scopeSpans", default)]
    pub scope_spans: Vec<ScopeSpans>,
}

#[derive(Deserialize)]
pub(crate) struct ScopeSpans {
    #[serde(default)]
    pub scope: Scope,
    #[serde(default)]
    pub spans: Vec<Span>,
}

#[derive(Deserialize)]
pub(crate) struct Span {
    #[serde(rename = "traceId", default)]
    pub trace_id: String,
    #[serde(rename = "spanId", default)]
    pub span_id: String,
    #[serde(rename = "parentSpanId", default)]
    pub parent_span_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub kind: u8,
    #[serde(rename = "startTimeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub start_time_unix_nano: Option<u64>,
    #[serde(rename = "endTimeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub end_time_unix_nano: Option<u64>,
    #[serde(default)]
    pub status: SpanStatus,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Deserialize, Default)]
pub(crate) struct SpanStatus {
    #[serde(default)]
    pub code: u8,
}

// --- Log structs ---

#[derive(Deserialize)]
pub(crate) struct ExportLogsServiceRequest {
    #[serde(rename = "resourceLogs")]
    pub resource_logs: Vec<ResourceLogs>,
}

#[derive(Deserialize)]
pub(crate) struct ResourceLogs {
    #[serde(default)]
    pub resource: Resource,
    #[serde(rename = "scopeLogs", default)]
    pub scope_logs: Vec<ScopeLogs>,
}

#[derive(Deserialize)]
pub(crate) struct ScopeLogs {
    #[serde(default)]
    pub scope: Scope,
    #[serde(rename = "logRecords", default)]
    pub log_records: Vec<LogRecord>,
}

#[derive(Deserialize)]
pub(crate) struct LogRecord {
    #[serde(rename = "timeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub time_unix_nano: Option<u64>,
    #[serde(rename = "observedTimeUnixNano", default, deserialize_with = "de_opt_u64_from_str")]
    pub observed_time_unix_nano: Option<u64>,
    #[serde(rename = "severityText", default)]
    pub severity_text: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    #[serde(rename = "traceId", default)]
    pub trace_id: String,
    #[serde(rename = "spanId", default)]
    pub span_id: String,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

// --- Shared types ---

#[derive(Deserialize, Default, Clone)]
pub(crate) struct Resource {
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Deserialize, Default, Clone)]
pub(crate) struct Scope {
    #[serde(default)]
    pub name: String,
}

#[derive(Deserialize, Clone)]
pub(crate) struct KeyValue {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
}

// --- Helpers ---

pub(crate) fn resolve_log_timestamp(time: Option<u64>, observed: Option<u64>) -> u64 {
    match time {
        Some(t) if t > 0 => t,
        _ => observed.unwrap_or(0),
    }
}

/// Extract a string attribute value from a KeyValue list.
pub(crate) fn kv_str<'a>(kvs: &'a [KeyValue], key: &str) -> Option<&'a str> {
    kvs.iter()
        .find(|kv| kv.key == key)
        .and_then(|kv| kv.value.as_ref())
        .and_then(|v| v.get("stringValue"))
        .and_then(|v| v.as_str())
}

/// Extract the body string from an OTLP log record body value.
pub(crate) fn body_string(body: &Option<serde_json::Value>) -> String {
    match body {
        Some(v) => v
            .get("stringValue")
            .and_then(|s| s.as_str())
            .map(String::from)
            .unwrap_or_else(|| v.to_string()),
        None => String::new(),
    }
}
```

Note: `KeyValue.value` is kept as raw `serde_json::Value`. No custom `AnyValue` enum — the OTLP JSON `value` field is a JSON object with a oneOf key like `{"stringValue": "..."}` or `{"intValue": "..."}`. We extract what we need via `kv_str()` and leave the rest untouched.

- [ ] **Step 3: Update `mod.rs` — add `pub mod otlp;` and fix stale module doc**

Replace the contents of `src/telemetry/mod.rs`:

```rust
//! Local diagnostic telemetry read path for the Everr CLI.
//!
//! Opens the telemetry directory written by the Desktop app's Tauri
//! sidecar, streams OTLP JSON files, and exposes typed filters over
//! traces and logs. The CLI never writes to this directory and never
//! talks to the collector process — the filesystem is the whole interface.

pub mod commands;
pub mod otlp;
pub mod query;
pub mod store;
```

- [ ] **Step 4: Write tests for envelope dispatch and helpers**

Add to the `tests` module in `src/telemetry/otlp.rs`:

```rust
    #[test]
    fn dispatch_line_trace_envelope() {
        let line = r#"{"resourceSpans":[{"resource":{"attributes":[]},"scopeSpans":[]}]}"#;
        assert!(matches!(dispatch_line(line), Some(OtlpSignal::Traces(_))));
    }

    #[test]
    fn dispatch_line_log_envelope() {
        let line = r#"{"resourceLogs":[{"resource":{"attributes":[]},"scopeLogs":[]}]}"#;
        assert!(matches!(dispatch_line(line), Some(OtlpSignal::Logs(_))));
    }

    #[test]
    fn dispatch_line_unknown_signal_returns_none() {
        let line = r#"{"resourceMetrics":[{}]}"#;
        assert!(dispatch_line(line).is_none());
    }

    #[test]
    fn dispatch_line_both_signals_returns_none() {
        let line = r#"{"resourceSpans":[],"resourceLogs":[]}"#;
        assert!(dispatch_line(line).is_none(), "both present → skip as malformed");
    }

    #[test]
    fn dispatch_line_log_not_misclassified_as_traces() {
        let line = r#"{"resourceLogs":[{"resource":{"attributes":[]},"scopeLogs":[]}]}"#;
        assert!(matches!(dispatch_line(line), Some(OtlpSignal::Logs(_))));
    }

    #[test]
    fn resolve_log_timestamp_prefers_time_when_nonzero() {
        assert_eq!(resolve_log_timestamp(Some(100), Some(200)), 100);
    }

    #[test]
    fn resolve_log_timestamp_falls_back_to_observed() {
        assert_eq!(resolve_log_timestamp(None, Some(200)), 200);
        assert_eq!(resolve_log_timestamp(Some(0), Some(200)), 200);
    }

    #[test]
    fn resolve_log_timestamp_returns_zero_when_both_absent() {
        assert_eq!(resolve_log_timestamp(None, None), 0);
    }

    #[test]
    fn deserialize_real_trace_fixture_line() {
        let line = r#"{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test-service"}}]},"scopeSpans":[{"scope":{"name":"test-scope"},"spans":[{"traceId":"0102030405060708090a0b0c0d0e0f10","spanId":"1112131415161718","name":"test.span.ok","kind":1,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000001000000000","status":{"code":1}}]}]}]}"#;
        let req: ExportTraceServiceRequest = serde_json::from_str(line).unwrap();
        let span = &req.resource_spans[0].scope_spans[0].spans[0];
        assert_eq!(span.trace_id, "0102030405060708090a0b0c0d0e0f10");
        assert_eq!(span.start_time_unix_nano, Some(1700000000000000000));
        assert_eq!(span.end_time_unix_nano, Some(1700000001000000000));
        assert_eq!(span.kind, 1);
        assert_eq!(span.status.code, 1);
    }

    #[test]
    fn deserialize_real_log_fixture_line() {
        let line = r#"{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test-service"}}]},"scopeLogs":[{"scope":{"name":"test-scope"},"logRecords":[{"timeUnixNano":"1700000000000000000","severityNumber":9,"severityText":"INFO","body":{"stringValue":"test log message info"},"traceId":"0102030405060708090a0b0c0d0e0f10","spanId":"1112131415161718"}]}]}]}"#;
        let req: ExportLogsServiceRequest = serde_json::from_str(line).unwrap();
        let record = &req.resource_logs[0].scope_logs[0].log_records[0];
        assert_eq!(record.time_unix_nano, Some(1700000000000000000));
        assert_eq!(record.severity_text, "INFO");
        assert_eq!(body_string(&record.body), "test log message info");
        assert_eq!(record.trace_id, "0102030405060708090a0b0c0d0e0f10");
    }

    #[test]
    fn kv_str_extracts_string_attribute() {
        let kvs = vec![KeyValue {
            key: "service.name".into(),
            value: Some(serde_json::json!({"stringValue": "my-app"})),
        }];
        assert_eq!(kv_str(&kvs, "service.name"), Some("my-app"));
        assert_eq!(kv_str(&kvs, "missing"), None);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p everr-cli otlp::tests`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```
feat(telemetry): add OTLP JSON struct definitions and envelope dispatch
```

---

### Task 2: Simplify `store.rs` — remove DuckDB

**Files:**
- Modify: `src/telemetry/store.rs`

- [ ] **Step 1: Write the test for `StoreError::Io`**

The existing test `open_on_missing_dir_returns_dir_missing` in `tests/telemetry_store.rs` already covers `DirMissing`. No new store-level test needed — but verify the existing tests still compile after the change.

- [ ] **Step 2: Rewrite `store.rs`**

Replace the full contents of `src/telemetry/store.rs` with:

```rust
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Staleness threshold for the sibling-directory mismatch banner.
#[allow(dead_code)]
pub const STALE_SIBLING_THRESHOLD: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub enum StoreError {
    DirMissing(PathBuf),
    Io(std::io::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DirMissing(path) => write!(f, "telemetry directory missing: {}", path.display()),
            Self::Io(err) => write!(f, "telemetry I/O error: {err}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

#[derive(Debug)]
pub struct TelemetryStore {
    dir: PathBuf,
}

impl TelemetryStore {
    pub fn open() -> Result<Self, StoreError> {
        let dir = everr_core::build::telemetry_dir()
            .map_err(|err| StoreError::Io(std::io::Error::new(std::io::ErrorKind::Other, err)))?;
        Self::open_at(&dir)
    }

    pub fn open_at(dir: &Path) -> Result<Self, StoreError> {
        if !dir.exists() {
            return Err(StoreError::DirMissing(dir.to_path_buf()));
        }
        Ok(Self {
            dir: dir.to_path_buf(),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// List `otlp*.json*` files sorted by mtime (newest first).
    /// Files whose metadata can't be read are still returned (with UNIX_EPOCH
    /// mtime) so the query layer can attempt to open them and report failures
    /// via `ScanStats`.
    pub fn otlp_files(&self) -> Result<Vec<PathBuf>, std::io::Error> {
        let mut entries: Vec<(PathBuf, SystemTime)> = Vec::new();
        for entry in std::fs::read_dir(&self.dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue, // directory-level read error, not a file
            };
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("otlp") || !name.contains(".json") {
                continue;
            }
            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            entries.push((entry.path(), mtime));
        }
        entries.sort_by(|a, b| b.1.cmp(&a.1)); // newest first
        Ok(entries.into_iter().map(|(p, _)| p).collect())
    }
}

/// Newest mtime across `otlp*.json*` files in a directory, or `None` if the
/// directory is missing or contains no matching files.
pub fn newest_otlp_mtime(dir: &Path) -> Option<SystemTime> {
    let entries = std::fs::read_dir(dir).ok()?;
    entries
        .filter_map(Result::ok)
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("otlp") && name.contains(".json")
        })
        .filter_map(|e| e.metadata().and_then(|m| m.modified()).ok())
        .max()
}

/// Count of `otlp*.json*` files in a directory. Returns 0 on missing dir.
pub fn count_otlp_files(dir: &Path) -> usize {
    match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter(|e| {
                let name = e.file_name();
                let name = name.to_string_lossy();
                name.starts_with("otlp") && name.contains(".json")
            })
            .count(),
        Err(_) => 0,
    }
}
```

- [ ] **Step 3: Verify existing store tests compile and pass**

Run: `cargo test -p everr-cli -- open_on_missing_dir_returns_dir_missing open_on_empty_dir_is_ok`
Expected: both pass. The rest of `telemetry_store.rs` tests will fail because `traces()`/`logs()` aren't rewritten yet — that's expected.

- [ ] **Step 4: Commit**

```
refactor(telemetry): remove DuckDB from TelemetryStore
```

---

### Task 3: Streaming query engine (`query.rs`) — logs

**Files:**
- Modify: `src/telemetry/query.rs`
- Modify: `Cargo.toml` (add `regex`)

Build the scan infrastructure and `logs()` first since it's the simpler single-pass pipeline.

- [ ] **Step 1: Add `regex` dependency**

In `Cargo.toml`, add under `[dependencies]`:

```toml
regex = "1"
```

- [ ] **Step 2: Write the failing test for `logs()` with the new return type**

In `tests/telemetry_store.rs`, update the `logs_returns_all_records_by_default` test to destructure the tuple:

```rust
#[test]
fn logs_returns_all_records_by_default() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter::default();
    let (rows, stats) = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 2, "fixture has two log records");
    assert_eq!(stats.skipped_unreadable_files, 0);
    assert_eq!(stats.skipped_malformed_lines, 0);
}
```

- [ ] **Step 3: Rewrite `query.rs` with new row types and `logs()` implementation**

Replace the full contents of `src/telemetry/query.rs`. Key design decisions:
- Row structs store OTLP-native data: `kind: u8`, `status_code: u8`, `resource_attrs: Vec<KeyValue>`, `attributes: Vec<KeyValue>`. No eager conversion to `serde_json::Value` or DuckDB-shaped strings.
- `system_time_ns()` is `pub(crate)` so `commands.rs` can reuse it.
- Only `logs()` is implemented here; `trace_trees()` is added in Task 4.

```rust
use std::io::BufRead;
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::telemetry::otlp::{self, KeyValue, OtlpSignal};
use crate::telemetry::store::{StoreError, TelemetryStore};

#[derive(Debug, Default, Clone)]
pub struct TraceFilter {
    pub since: Option<Duration>,
    pub name_like: Option<String>,
    pub trace_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Default, Clone)]
pub struct LogFilter {
    pub since: Option<Duration>,
    pub level: Option<String>,
    pub grep: Option<String>,
    pub trace_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraceRow {
    pub timestamp_ns: u64,
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub name: String,
    pub kind: u8,
    pub status_code: u8,
    pub duration_ns: u64,
    #[serde(skip)]
    pub resource_attrs: Vec<KeyValue>,
    #[serde(skip)]
    pub span_attrs: Vec<KeyValue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogRow {
    pub timestamp_ns: u64,
    pub level: String,
    pub target: String,
    pub message: String,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    #[serde(skip)]
    pub resource_attrs: Vec<KeyValue>,
    #[serde(skip)]
    pub log_attrs: Vec<KeyValue>,
}

#[derive(Debug, Default, Clone)]
pub struct ScanStats {
    pub skipped_unreadable_files: usize,
    pub skipped_malformed_lines: usize,
}

impl ScanStats {
    pub fn merge(&mut self, other: &ScanStats) {
        self.skipped_unreadable_files += other.skipped_unreadable_files;
        self.skipped_malformed_lines += other.skipped_malformed_lines;
    }
}

pub struct TraceTree {
    pub trace_id: String,
    pub activity_timestamp_ns: u64,
    pub service_name: String,
    pub spans: Vec<TraceRow>,
    /// Span IDs that matched the discovery-pass filters (for `← match` highlighting).
    pub matched_span_ids: std::collections::HashSet<String>,
}

pub(crate) fn system_time_ns(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        // as_nanos() returns u128; the cast is safe — u64 holds nanoseconds
        // up to year ~2554, well beyond any realistic timestamp.
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

impl TelemetryStore {
    pub fn logs(&self, filter: LogFilter) -> Result<(Vec<LogRow>, ScanStats), StoreError> {
        let files = self.otlp_files()?;
        if files.is_empty() {
            return Ok((Vec::new(), ScanStats::default()));
        }

        let cutoff_ns = filter.since.map(|dur| {
            system_time_ns(SystemTime::now()).saturating_sub(dur.as_nanos() as u64)
        });

        let grep_re = filter.grep.as_ref().map(|pat| {
            regex::Regex::new(pat).unwrap_or_else(|_| regex::Regex::new(&regex::escape(pat)).unwrap())
        });

        let mut rows = Vec::new();
        let mut stats = ScanStats::default();

        for path in &files {
            let file = match std::fs::File::open(path) {
                Ok(f) => f,
                Err(_) => {
                    stats.skipped_unreadable_files += 1;
                    continue;
                }
            };
            let reader = std::io::BufReader::new(file);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }

                let req = match otlp::dispatch_line(&line) {
                    Some(OtlpSignal::Logs(r)) => r,
                    Some(OtlpSignal::Traces(_)) => continue, // expected, not an error
                    None => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };

                for rl in &req.resource_logs {
                    for sl in &rl.scope_logs {
                        let target = if sl.scope.name.is_empty() {
                            String::new()
                        } else {
                            sl.scope.name.clone()
                        };
                        for record in &sl.log_records {
                            let ts = otlp::resolve_log_timestamp(
                                record.time_unix_nano,
                                record.observed_time_unix_nano,
                            );

                            if let Some(cutoff) = cutoff_ns {
                                if ts < cutoff {
                                    continue;
                                }
                            }

                            let level = &record.severity_text;
                            if let Some(ref lvl) = filter.level {
                                if !level.eq_ignore_ascii_case(lvl) {
                                    continue;
                                }
                            }

                            let message = otlp::body_string(&record.body);
                            if let Some(ref re) = grep_re {
                                if !re.is_match(&message) {
                                    continue;
                                }
                            }

                            let trace_id = if record.trace_id.is_empty() {
                                None
                            } else {
                                Some(record.trace_id.clone())
                            };

                            if let Some(ref filter_tid) = filter.trace_id {
                                match &trace_id {
                                    Some(tid) if tid.eq_ignore_ascii_case(filter_tid) => {}
                                    _ => continue,
                                }
                            }

                            let span_id = if record.span_id.is_empty() {
                                None
                            } else {
                                Some(record.span_id.clone())
                            };

                            rows.push(LogRow {
                                timestamp_ns: ts,
                                level: level.clone(),
                                target: target.clone(),
                                message,
                                trace_id,
                                span_id,
                                resource_attrs: rl.resource.attributes.clone(),
                                log_attrs: record.attributes.clone(),
                            });
                        }
                    }
                }
            }
        }

        rows.sort_by(|a, b| b.timestamp_ns.cmp(&a.timestamp_ns));
        if let Some(limit) = filter.limit {
            rows.truncate(limit);
        }

        Ok((rows, stats))
    }
}
```

- [ ] **Step 4: Update all log tests in `tests/telemetry_store.rs` for new return type and field names**

Update each log test to destructure `(rows, _stats)` and use the new field access pattern. `resource["service.name"]` becomes `otlp::kv_str(&row.resource_attrs, "service.name")`:

```rust
#[test]
fn logs_trace_id_filter_matches_fixture_row() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter {
        trace_id: Some("0102030405060708090a0b0c0d0e0f10".into()),
        ..LogFilter::default()
    };
    let (rows, _) = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].message, "test log message info");
    assert_eq!(
        rows[0].trace_id.as_deref(),
        Some("0102030405060708090a0b0c0d0e0f10")
    );
    assert_eq!(
        everr_cli::telemetry::otlp::kv_str(&rows[0].resource_attrs, "service.name"),
        Some("test-service")
    );
}

#[test]
fn logs_level_filter_matches_severity() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter {
        level: Some("WARN".into()),
        ..LogFilter::default()
    };
    let (rows, _) = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].level, "WARN");
}

#[test]
fn logs_since_filter_excludes_older_rows() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter {
        since: Some(Duration::from_secs(1)),
        ..LogFilter::default()
    };
    let (rows, _) = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 0);
}
```

- [ ] **Step 5: Add a test for log `target` populated from scope name**

Add to `tests/telemetry_store.rs`:

```rust
#[test]
fn logs_target_populated_from_scope_name() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let (rows, _) = store.logs(LogFilter::default()).expect("query logs");
    assert!(rows.iter().all(|r| r.target == "test-scope"),
        "target should come from InstrumentationScope.name");
}
```

- [ ] **Step 6: Run log tests**

Run: `cargo test -p everr-cli -- logs_`
Expected: all pass.

- [ ] **Step 7: Commit**

```
feat(telemetry): implement streaming log query replacing DuckDB SQL
```

---

### Task 4: Streaming query engine — `trace_trees()`

**Files:**
- Modify: `src/telemetry/query.rs`
- Create: `tests/fixtures/telemetry_hydration/otlp.json`

No separate `traces_flat()` method. `trace_trees()` is the single trace query path. JSON mode flattens from the tree at the output edge in `commands.rs`.

- [ ] **Step 1: Write tests for `trace_trees()`**

Add to `tests/telemetry_store.rs`:

```rust
use everr_cli::telemetry::query::TraceFilter;

#[test]
fn trace_trees_groups_spans_by_trace_id() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = TraceFilter::default();
    let (trees, stats) = store.trace_trees(filter).expect("query trace trees");
    assert_eq!(stats.skipped_unreadable_files, 0);
    // Fixture has 2 spans with the same trace_id → 1 tree
    assert_eq!(trees.len(), 1);
    assert_eq!(trees[0].trace_id, "0102030405060708090a0b0c0d0e0f10");
    assert_eq!(trees[0].spans.len(), 2);
    assert_eq!(trees[0].service_name, "test-service");
}

#[test]
fn trace_trees_name_filter_finds_matching_trace() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = TraceFilter {
        name_like: Some("err".into()),
        ..TraceFilter::default()
    };
    let (trees, _) = store.trace_trees(filter).expect("query");
    assert_eq!(trees.len(), 1, "trace has a matching span");
    // Hydration loads ALL spans for the trace, not just the matching one
    assert_eq!(trees[0].spans.len(), 2);
    // The matching span should be in matched_span_ids
    assert!(trees[0].matched_span_ids.iter().any(|id| {
        trees[0].spans.iter().any(|s| s.span_id == *id && s.name == "test.span.err")
    }));
}

#[test]
fn trace_trees_preserves_raw_ids() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let (trees, _) = store.trace_trees(TraceFilter::default()).expect("query");
    let span = trees[0].spans.iter().find(|s| s.span_id == "1112131415161718").expect("find span");
    assert_eq!(span.trace_id, "0102030405060708090a0b0c0d0e0f10");
    assert_eq!(span.kind, 1); // INTERNAL as raw u8
    assert_eq!(span.status_code, 1); // OK as raw u8
}
```

- [ ] **Step 2: Create hydration test fixture and write test**

Add `SystemTime` to the test file imports: `use std::time::{Duration, SystemTime};`

Create `tests/fixtures/telemetry_hydration/otlp.json` — a trace where the root span is old (Sept 2020) and the child span is recent (Nov 2023). A `--since` window that includes the child but not the root must still hydrate the root:

```json
{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"hydration-test"}}]},"scopeSpans":[{"scope":{"name":"test"},"spans":[{"traceId":"aabbccddeeff00112233445566778899","spanId":"0000000000000001","name":"root.span","kind":1,"startTimeUnixNano":"1600000000000000000","endTimeUnixNano":"1600000001000000000","status":{"code":1}},{"traceId":"aabbccddeeff00112233445566778899","spanId":"0000000000000002","parentSpanId":"0000000000000001","name":"child.span","kind":1,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000001000000000","status":{"code":1}}]}]}]}
```

Add to `tests/telemetry_store.rs`:

```rust
fn hydration_fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/telemetry_hydration")
}

#[test]
fn trace_trees_hydration_loads_parent_outside_since_window() {
    // Root span: Sept 2020 (1600000000000000000ns = epoch 1600000000s)
    // Child span: Nov 2023 (1700000000000000000ns = epoch 1700000000s)
    // --since window covers child but NOT root.
    // Discovery should find the trace via the child, hydration should
    // load the root even though it's outside --since.
    let store = TelemetryStore::open_at(&hydration_fixture_dir()).expect("open fixture");

    // Compute --since dynamically: midpoint between root and child epochs.
    // This always includes the child (1700000000s) and excludes the root (1600000000s).
    let midpoint_epoch_secs: u64 = (1_600_000_000 + 1_700_000_000) / 2; // 1650000000
    let now_secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let since_secs = now_secs - midpoint_epoch_secs;

    let filter = TraceFilter {
        since: Some(Duration::from_secs(since_secs)),
        ..TraceFilter::default()
    };
    let (trees, _) = store.trace_trees(filter).expect("query");
    assert_eq!(trees.len(), 1, "should find 1 trace via child span");
    assert_eq!(
        trees[0].spans.len(),
        2,
        "hydration must include root span even though it's outside --since"
    );
    let names: Vec<_> = trees[0].spans.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"root.span"), "root must be hydrated");
    assert!(names.contains(&"child.span"), "child must be present");
}
```

- [ ] **Step 3: Implement `trace_trees()`**

Add to the `impl TelemetryStore` block in `src/telemetry/query.rs`:

```rust
    /// Two-pass query: discovery finds matching trace IDs, hydration loads
    /// all spans for those traces. This reads files twice — an explicit
    /// tradeoff: acceptable for local telemetry volumes (typically <100 files),
    /// avoids unbounded memory from loading all spans in a single pass before
    /// knowing which traces survive filtering. Could be collapsed to a single
    /// pass with a HashMap<trace_id, Vec<TraceRow>> if volumes grow.
    pub fn trace_trees(&self, filter: TraceFilter) -> Result<(Vec<TraceTree>, ScanStats), StoreError> {
        let files = self.otlp_files()?;
        if files.is_empty() {
            return Ok((Vec::new(), ScanStats::default()));
        }

        // When --trace-id is set, skip the --since cutoff during discovery
        // so any known trace can be found regardless of age.
        let cutoff_ns = if filter.trace_id.is_some() {
            None
        } else {
            filter.since.map(|dur| {
                system_time_ns(SystemTime::now()).saturating_sub(dur.as_nanos() as u64)
            })
        };

        // --- Discovery pass: find candidate trace IDs and record matched span IDs ---
        let mut candidates: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        let mut matched_spans: std::collections::HashMap<String, std::collections::HashSet<String>> =
            std::collections::HashMap::new();
        let mut stats = ScanStats::default();

        for path in &files {
            let file = match std::fs::File::open(path) {
                Ok(f) => f,
                Err(_) => {
                    stats.skipped_unreadable_files += 1;
                    continue;
                }
            };
            let reader = std::io::BufReader::new(file);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }

                let req = match otlp::dispatch_line(&line) {
                    Some(OtlpSignal::Traces(r)) => r,
                    Some(OtlpSignal::Logs(_)) => continue,
                    None => {
                        stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };

                for rs in &req.resource_spans {
                    for ss in &rs.scope_spans {
                        for span in &ss.spans {
                            let ts = span.start_time_unix_nano.unwrap_or(0);

                            if let Some(cutoff) = cutoff_ns {
                                if ts < cutoff {
                                    continue;
                                }
                            }

                            if let Some(ref name_sub) = filter.name_like {
                                if !span.name.contains(name_sub.as_str()) {
                                    continue;
                                }
                            }

                            if let Some(ref filter_tid) = filter.trace_id {
                                if !span.trace_id.eq_ignore_ascii_case(filter_tid) {
                                    continue;
                                }
                            }

                            let entry = candidates
                                .entry(span.trace_id.clone())
                                .or_insert(0);
                            if ts > *entry {
                                *entry = ts;
                            }
                            matched_spans
                                .entry(span.trace_id.clone())
                                .or_default()
                                .insert(span.span_id.clone());
                        }
                    }
                }
            }
        }

        if candidates.is_empty() {
            return Ok((Vec::new(), stats));
        }

        // Sort by activity_timestamp descending, apply limit
        let mut sorted: Vec<(String, u64)> = candidates.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        if let Some(limit) = filter.limit {
            sorted.truncate(limit);
        }

        let selected_ids: std::collections::HashSet<String> =
            sorted.iter().map(|(id, _)| id.clone()).collect();
        let activity_timestamps: std::collections::HashMap<String, u64> =
            sorted.into_iter().collect();

        // --- Hydration pass: load all spans for selected traces ---
        let mut all_spans: Vec<TraceRow> = Vec::new();
        let mut hydrate_stats = ScanStats::default();

        for path in &files {
            let file = match std::fs::File::open(path) {
                Ok(f) => f,
                Err(_) => {
                    hydrate_stats.skipped_unreadable_files += 1;
                    continue;
                }
            };
            let reader = std::io::BufReader::new(file);

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => {
                        hydrate_stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }

                let req = match otlp::dispatch_line(&line) {
                    Some(OtlpSignal::Traces(r)) => r,
                    Some(OtlpSignal::Logs(_)) => continue,
                    None => {
                        hydrate_stats.skipped_malformed_lines += 1;
                        continue;
                    }
                };

                // Only collect spans for selected trace IDs
                for rs in &req.resource_spans {
                    for ss in &rs.scope_spans {
                        for span in &ss.spans {
                            if !selected_ids.contains(&span.trace_id) {
                                continue;
                            }
                            let start = span.start_time_unix_nano.unwrap_or(0);
                            let end = span.end_time_unix_nano.unwrap_or(0);
                            let parent = if span.parent_span_id.is_empty() {
                                None
                            } else {
                                Some(span.parent_span_id.clone())
                            };

                            all_spans.push(TraceRow {
                                timestamp_ns: start,
                                trace_id: span.trace_id.clone(),
                                span_id: span.span_id.clone(),
                                parent_span_id: parent,
                                name: span.name.clone(),
                                kind: span.kind,
                                status_code: span.status.code,
                                duration_ns: end.saturating_sub(start),
                                resource_attrs: rs.resource.attributes.clone(),
                                span_attrs: span.attributes.clone(),
                            });
                        }
                    }
                }
            }
        }

        stats.merge(&hydrate_stats);

        // Group spans into TraceTree structs
        let mut tree_map: std::collections::HashMap<String, Vec<TraceRow>> =
            std::collections::HashMap::new();
        for span in all_spans {
            tree_map.entry(span.trace_id.clone()).or_default().push(span);
        }

        let mut trees: Vec<TraceTree> = tree_map
            .into_iter()
            .map(|(trace_id, spans)| {
                let activity_ts = activity_timestamps.get(&trace_id).copied().unwrap_or(0);
                let service_name = spans
                    .first()
                    .and_then(|s| otlp::kv_str(&s.resource_attrs, "service.name"))
                    .unwrap_or("")
                    .to_string();
                let matched = matched_spans.remove(&trace_id).unwrap_or_default();
                TraceTree {
                    trace_id,
                    activity_timestamp_ns: activity_ts,
                    service_name,
                    spans,
                    matched_span_ids: matched,
                }
            })
            .collect();

        trees.sort_by(|a, b| b.activity_timestamp_ns.cmp(&a.activity_timestamp_ns));

        Ok((trees, stats))
    }
```

- [ ] **Step 4: Run all query tests**

Run: `cargo test -p everr-cli -- trace_trees_ logs_`
Expected: all pass.

- [ ] **Step 5: Commit**

```
feat(telemetry): implement two-pass trace tree query
```

---

### Task 5: Update `commands.rs` — tree renderer and `ScanStats` warnings

**Files:**
- Modify: `src/telemetry/commands.rs`

Note: The existing `format_duration_ns` function (currently at `commands.rs:321`) is kept as-is — it's not being rewritten. The existing `truncate` helper is also kept.

- [ ] **Step 1: Update imports at the top of `commands.rs`**

Replace the imports:

```rust
use std::io::{self, IsTerminal};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;

use crate::cli::{
    TelemetryArgs, TelemetryFormat, TelemetryLogsArgs, TelemetryPathArgs, TelemetryQueryArgs,
    TelemetrySubcommand,
};
use crate::telemetry::otlp::{self, KeyValue};
use crate::telemetry::query::{LogFilter, LogRow, ScanStats, TraceFilter, TraceRow, TraceTree, system_time_ns};
use crate::telemetry::store::{
    STALE_SIBLING_THRESHOLD, StoreError, TelemetryStore, count_otlp_files, newest_otlp_mtime,
};
```

- [ ] **Step 2: Replace `run_traces` — call `trace_trees()` for both modes**

```rust
fn run_traces(args: TelemetryQueryArgs) -> Result<()> {
    let since = parse_duration(&args.since)?;
    let format = resolve_format(args.format);
    let resolved_dir = resolved_dir(args.telemetry_dir.as_deref())?;

    match TelemetryStore::open_at(&resolved_dir) {
        Err(StoreError::DirMissing(path)) => {
            emit_missing_or_sibling_hint(&path)?;
            Ok(())
        }
        Err(StoreError::Io(err)) => {
            eprintln!("telemetry store error: {err}");
            Err(anyhow::anyhow!("telemetry store error"))
        }
        Ok(store) => {
            maybe_stale_sibling_banner(store.dir());
            let header = Header::compute(store.dir());
            let filter = TraceFilter {
                since: Some(since),
                name_like: args.name.clone(),
                trace_id: args.trace_id.clone(),
                limit: Some(args.limit),
            };
            let (trees, stats) = store
                .trace_trees(filter)
                .context("query failed")?;
            match format {
                TelemetryFormat::Json => render_traces_json(&header, &trees, args.limit),
                TelemetryFormat::Table => render_trace_trees(&header, &trees),
            }
            print_scan_warnings(&stats);
            Ok(())
        }
    }
}
```

- [ ] **Step 3: Replace `run_logs` for new return type**

```rust
fn run_logs(args: TelemetryLogsArgs) -> Result<()> {
    let since = parse_duration(&args.since)?;
    let format = resolve_format(args.format);
    let resolved_dir = resolved_dir(args.telemetry_dir.as_deref())?;

    match TelemetryStore::open_at(&resolved_dir) {
        Err(StoreError::DirMissing(path)) => {
            emit_missing_or_sibling_hint(&path)?;
            Ok(())
        }
        Err(StoreError::Io(err)) => {
            eprintln!("telemetry store error: {err}");
            Err(anyhow::anyhow!("telemetry store error"))
        }
        Ok(store) => {
            maybe_stale_sibling_banner(store.dir());
            let header = Header::compute(store.dir());
            let filter = LogFilter {
                since: Some(since),
                level: args.level.clone(),
                grep: args.grep.clone(),
                trace_id: args.trace_id.clone(),
                limit: Some(args.limit),
            };
            let (rows, stats) = store
                .logs(filter)
                .context("query failed")?;
            render_logs(&header, &rows, format);
            print_scan_warnings(&stats);
            Ok(())
        }
    }
}
```

- [ ] **Step 4: Replace `render_traces` with `render_traces_json` and `render_trace_trees`**

Remove the old `render_traces` function and `render_store_error` function. Add:

```rust
fn kvs_to_json(kvs: &[KeyValue]) -> Value {
    let mut map = serde_json::Map::new();
    for kv in kvs {
        map.insert(kv.key.clone(), kv.value.clone());
    }
    Value::Object(map)
}

fn render_traces_json(header: &Header, trees: &[TraceTree], limit: usize) {
    // Flatten trees into a flat span array, sorted by timestamp descending,
    // capped at `limit` spans (not traces — JSON mode is flat).
    #[derive(Serialize)]
    struct JsonSpan<'a> {
        timestamp_ns: u64,
        trace_id: &'a str,
        span_id: &'a str,
        parent_span_id: &'a Option<String>,
        name: &'a str,
        kind: &'static str,
        status: &'static str,
        duration_ns: u64,
        attributes: Value,
        resource: Value,
    }
    let mut rows: Vec<JsonSpan> = trees
        .iter()
        .flat_map(|t| &t.spans)
        .map(|s| JsonSpan {
            timestamp_ns: s.timestamp_ns,
            trace_id: &s.trace_id,
            span_id: &s.span_id,
            parent_span_id: &s.parent_span_id,
            name: &s.name,
            kind: span_kind_str(s.kind),
            status: status_code_str(s.status_code),
            duration_ns: s.duration_ns,
            attributes: kvs_to_json(&s.span_attrs),
            resource: kvs_to_json(&s.resource_attrs),
        })
        .collect();
    rows.sort_by(|a, b| b.timestamp_ns.cmp(&a.timestamp_ns));
    rows.truncate(limit);
    let payload = serde_json::json!({
        "meta": header.as_meta(),
        "rows": rows,
    });
    println!("{}", serde_json::to_string_pretty(&payload).unwrap());
}

fn render_trace_trees(header: &Header, trees: &[TraceTree]) {
    header.print_text();
    if trees.is_empty() {
        println!("No matches. Try a wider --since, or drop filters.");
        return;
    }
    for (i, tree) in trees.iter().enumerate() {
        if i > 0 {
            println!();
        }
        let trace_short = tree.trace_id.get(..8).unwrap_or(&tree.trace_id);
        let age = format_age_ns(tree.activity_timestamp_ns);
        let service = if tree.service_name.is_empty() {
            String::new()
        } else {
            format!("  service: {}", tree.service_name)
        };
        println!("TRACE {trace_short}  {age}{service}");

        // Build parent→children map and collect all known span IDs
        let mut children: std::collections::HashMap<Option<&str>, Vec<&TraceRow>> =
            std::collections::HashMap::new();
        let known_ids: std::collections::HashSet<&str> =
            tree.spans.iter().map(|s| s.span_id.as_str()).collect();
        for span in &tree.spans {
            // Orphan check: if parent_span_id points to a missing parent,
            // promote this span to root level instead of dropping it.
            let parent_key = match span.parent_span_id.as_deref() {
                Some(pid) if known_ids.contains(pid) => Some(pid),
                _ => None,
            };
            children.entry(parent_key).or_default().push(span);
        }

        // Sort children by timestamp ascending (earliest first within each group)
        for group in children.values_mut() {
            group.sort_by_key(|s| s.timestamp_ns);
        }

        // Render from root spans (no parent, or orphans promoted to root)
        let roots = children.get(&None).cloned().unwrap_or_default();
        render_span_children(&roots, &children, &tree.matched_span_ids, "");
    }
}

fn render_span_children(
    spans: &[&TraceRow],
    children: &std::collections::HashMap<Option<&str>, Vec<&TraceRow>>,
    matched: &std::collections::HashSet<String>,
    prefix: &str,
) {
    for (i, span) in spans.iter().enumerate() {
        let is_last = i == spans.len() - 1;
        let connector = if is_last { "└─ " } else { "├─ " };
        let duration = format_duration_ns(span.duration_ns);
        let status = status_code_str(span.status_code);
        let is_match = matched.contains(&span.span_id);
        let marker = if is_match { "  \u{2190} match" } else { "" };
        let name_display = if is_match {
            format!("\x1b[1m{}\x1b[0m", truncate(&span.name, 29))
        } else {
            truncate(&span.name, 29)
        };
        println!(
            "{prefix}{connector}{:<30} {:<8} {}{}",
            name_display,
            duration,
            status,
            marker
        );

        let child_prefix = if is_last {
            format!("{prefix}   ")
        } else {
            format!("{prefix}│  ")
        };
        if let Some(kids) = children.get(&Some(span.span_id.as_str())) {
            render_span_children(kids, children, matched, &child_prefix);
        }
    }
}

fn span_kind_str(kind: u8) -> &'static str {
    match kind {
        0 => "UNSPECIFIED",
        1 => "INTERNAL",
        2 => "SERVER",
        3 => "CLIENT",
        4 => "PRODUCER",
        5 => "CONSUMER",
        _ => "UNSPECIFIED",
    }
}

fn status_code_str(code: u8) -> &'static str {
    match code {
        0 => "UNSET",
        1 => "OK",
        2 => "ERROR",
        _ => "UNSET",
    }
}

fn format_age_ns(timestamp_ns: u64) -> String {
    let now_ns = system_time_ns(SystemTime::now());
    if timestamp_ns == 0 || timestamp_ns > now_ns {
        return "just now".to_string();
    }
    let diff_secs = (now_ns - timestamp_ns) / 1_000_000_000;
    if diff_secs < 60 {
        format!("{diff_secs}s ago")
    } else if diff_secs < 3600 {
        format!("{}m ago", diff_secs / 60)
    } else if diff_secs < 86400 {
        format!("{}h ago", diff_secs / 3600)
    } else {
        format!("{}d ago", diff_secs / 86400)
    }
}

fn print_scan_warnings(stats: &ScanStats) {
    if stats.skipped_unreadable_files > 0 {
        eprintln!(
            "warning: skipped {} unreadable telemetry file(s)",
            stats.skipped_unreadable_files
        );
    }
    if stats.skipped_malformed_lines > 0 {
        eprintln!(
            "warning: skipped {} malformed line(s)",
            stats.skipped_malformed_lines
        );
    }
}
```

- [ ] **Step 5: Rewrite `render_logs` for both modes**

The old `render_logs` serialized `LogRow` directly for JSON mode, but `resource_attrs` and `log_attrs` are `#[serde(skip)]` so attributes would be dropped. Split into table and JSON paths. Also switch from `format_timestamp_ms` to `format_timestamp_ns` (DuckDB distortion no longer applies). Then delete the `format_timestamp_ms` function.

```rust
fn render_logs(header: &Header, rows: &[LogRow], format: TelemetryFormat) {
    match format {
        TelemetryFormat::Table => {
            header.print_text();
            println!("{:<22}{:<7}{:<22}{}", "TIME", "LEVEL", "TARGET", "MESSAGE");
            for row in rows {
                let time = format_timestamp_ns(row.timestamp_ns);
                println!(
                    "{:<22}{:<7}{:<22}{}",
                    time,
                    &row.level,
                    truncate(&row.target, 21),
                    &row.message
                );
            }
            if rows.is_empty() {
                println!("No matches. Try a wider --since, or drop filters.");
            }
        }
        TelemetryFormat::Json => {
            #[derive(Serialize)]
            struct JsonLog<'a> {
                timestamp_ns: u64,
                level: &'a str,
                target: &'a str,
                message: &'a str,
                trace_id: &'a Option<String>,
                span_id: &'a Option<String>,
                attributes: Value,
                resource: Value,
            }
            let json_rows: Vec<JsonLog> = rows
                .iter()
                .map(|r| JsonLog {
                    timestamp_ns: r.timestamp_ns,
                    level: &r.level,
                    target: &r.target,
                    message: &r.message,
                    trace_id: &r.trace_id,
                    span_id: &r.span_id,
                    attributes: kvs_to_json(&r.log_attrs),
                    resource: kvs_to_json(&r.resource_attrs),
                })
                .collect();
            let payload = serde_json::json!({
                "meta": header.as_meta(),
                "rows": json_rows,
            });
            println!("{}", serde_json::to_string_pretty(&payload).unwrap());
        }
    }
}
```

- [ ] **Step 6: Remove the old `system_time_ns` from `commands.rs` if present**

The helper now lives in `query.rs` as `pub(crate)` and is imported. Delete any local copy.

- [ ] **Step 7: Verify it compiles**

Run: `cargo check -p everr-cli`
Expected: no errors.

- [ ] **Step 8: Commit**

```
feat(telemetry): add trace tree renderer and scan warnings to commands
```

---

### Task 6: Update tests

**Files:**
- Modify: `tests/telemetry_commands.rs`
- Modify: `tests/telemetry_e2e.rs`
- Modify: `tests/support/mod.rs`
- Delete: `tests/support/duckdb_cache.rs`

- [ ] **Step 1: Remove DuckDB cache from test support**

Delete `tests/support/duckdb_cache.rs`.

Replace `tests/support/mod.rs` contents:

```rust
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;

use assert_cmd::Command;
use everr_core::build;
use mockito::{Server, ServerGuard};
use serde_json::Value;
use tempfile::TempDir;

const API_BASE_URL_OVERRIDE_ENV: &str = "EVERR_API_BASE_URL_FOR_TESTS";

pub struct CliTestEnv {
    _temp_dir: TempDir,
    pub home_dir: PathBuf,
    pub config_dir: PathBuf,
}

impl CliTestEnv {
    pub fn new() -> Self {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let home_dir = temp_dir.path().join("home");
        fs::create_dir_all(&home_dir).expect("create home dir");
        let config_dir = platform_config_dir(&home_dir);
        fs::create_dir_all(&config_dir).expect("create config dir");

        Self {
            _temp_dir: temp_dir,
            home_dir,
            config_dir,
        }
    }

    pub fn command(&self) -> Command {
        let mut cmd = Command::new(assert_cmd::cargo::cargo_bin!("everr"));
        cmd.env("HOME", &self.home_dir);
        cmd.env("XDG_CONFIG_HOME", &self.config_dir);
        cmd.env("XDG_DATA_HOME", self.home_dir.join(".local").join("share"));
        cmd
    }

    pub fn command_with_api_base_url(&self, api_base_url: &str) -> Command {
        let mut cmd = self.command();
        cmd.env(API_BASE_URL_OVERRIDE_ENV, api_base_url);
        cmd
    }

    pub fn session_path(&self) -> PathBuf {
        self.config_dir
            .join(build::session_namespace())
            .join(build::default_session_file_name())
    }

    pub fn telemetry_dir(&self) -> PathBuf {
        self.home_dir
            .join("Library")
            .join("Application Support")
            .join("everr")
            .join("telemetry-dev")
    }

    pub fn write_session(&self, api_base_url: &str, token: &str) {
        let session_path = self.session_path();
        if let Some(parent) = session_path.parent() {
            fs::create_dir_all(parent).expect("create session parent dir");
        }

        let body = serde_json::json!({
            "session": {
                "api_base_url": api_base_url,
                "token": token,
            },
            "settings": {
                "completed_base_url": null,
                "wizard_completed": false,
            },
        });
        fs::write(
            session_path,
            serde_json::to_string_pretty(&body).expect("serialize session"),
        )
        .expect("write session file");
    }

    pub fn init_git_repo(&self, relative_dir: &str, branch: &str, remote: &str) -> PathBuf {
        let repo_dir = self.home_dir.join(relative_dir);
        fs::create_dir_all(&repo_dir).expect("create repo dir");

        run_git(&repo_dir, ["init"]);
        run_git(&repo_dir, ["config", "user.email", "tests@example.com"]);
        run_git(&repo_dir, ["config", "user.name", "Test User"]);

        fs::write(repo_dir.join("README.md"), "# test repo\n").expect("write readme");
        run_git(&repo_dir, ["add", "README.md"]);
        run_git(&repo_dir, ["commit", "-m", "init"]);
        run_git(&repo_dir, ["checkout", "-b", branch]);
        run_git(&repo_dir, ["remote", "add", "origin", remote]);

        repo_dir
    }
}

pub fn mock_api_server() -> ServerGuard {
    Server::new()
}

fn platform_config_dir(home_dir: &Path) -> PathBuf {
    home_dir.join("Library").join("Application Support")
}

pub fn parse_stdout_json(output: &[u8]) -> Value {
    let body = std::str::from_utf8(output).expect("stdout should be utf8");
    serde_json::from_str(body).expect("stdout should contain valid JSON")
}

fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
    let status = ProcessCommand::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .expect("run git command");
    assert!(status.success(), "git command failed");
}
```

- [ ] **Step 2: Update `telemetry_commands.rs` trace table test for tree view output**

Replace the `telemetry_traces_table_renders_span_rows` test:

```rust
#[test]
fn telemetry_traces_table_renders_span_rows() {
    let env = support::CliTestEnv::new();
    env.command()
        .args([
            "telemetry",
            "traces",
            "--telemetry-dir",
            fixture_arg().to_str().unwrap(),
            "--since",
            "1000d",
            "--format",
            "table",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("TRACE"))
        .stdout(predicate::str::contains("test.span.ok"));
}
```

- [ ] **Step 3: Verify E2E test compiles with updated support**

The E2E test already uses `support::CliTestEnv` which no longer references DuckDB. No code change needed in the test logic — just verify it compiles.

- [ ] **Step 4: Run all telemetry tests**

Run: `cargo test -p everr-cli -- telemetry`
Expected: all pass.

- [ ] **Step 5: Commit**

```
test(telemetry): update tests for streaming parser and tree view
```

---

### Task 7: Remove DuckDB dependency and build infrastructure

**Files:**
- Modify: `Cargo.toml` (in `packages/desktop-app/src-cli/`)
- Delete: `src/bin/warm_otlp_extension.rs`
- Modify: `Makefile` (repo root)
- Modify: `.github/workflows/build-everr-cli.yml`

- [ ] **Step 1: Remove DuckDB from `Cargo.toml`**

Remove the `[[bin]]` block for `warm_otlp_extension`:
```toml
[[bin]]
name = "warm_otlp_extension"
path = "src/bin/warm_otlp_extension.rs"
```

Remove the `duckdb` dependency:
```toml
duckdb = { version = "1.1", features = ["bundled"] }
```

Remove the `fd-lock` dev-dependency (only used by `duckdb_cache.rs`):
```toml
fd-lock = "4"
```

- [ ] **Step 2: Delete `src/bin/warm_otlp_extension.rs`**

Delete the file.

- [ ] **Step 3: Simplify `Makefile`**

Replace `Makefile` contents:

```makefile
.PHONY: test
test:
	cargo test --workspace
```

- [ ] **Step 4: Remove DuckDB cache step from CI**

In `.github/workflows/build-everr-cli.yml`, remove these two steps (lines ~55-61):

```yaml
      - name: Cache DuckDB extension fixture
        uses: actions/cache@v4
        with:
          path: target/test-fixtures/duckdb
          key: duckdb-otlp-${{ hashFiles('**/Cargo.lock') }}

      - name: Prepare test fixtures
        run: make prepare-test-fixtures
```

- [ ] **Step 5: Verify everything compiles and tests pass**

Run: `cargo test -p everr-cli`
Expected: all pass, no DuckDB-related compilation.

- [ ] **Step 6: Commit**

```
chore(telemetry): remove DuckDB dependency and build infrastructure
```

---

### Task 8: Final verification

- [ ] **Step 1: Full workspace build**

Run: `cargo build --workspace`
Expected: clean build, no warnings about unused imports.

- [ ] **Step 2: Full workspace tests**

Run: `cargo test --workspace`
Expected: all pass.

- [ ] **Step 3: Verify no DuckDB references remain**

Run: `grep -ri duckdb packages/desktop-app/src-cli/src/ packages/desktop-app/src-cli/tests/`
Expected: no matches.

- [ ] **Step 4: Verify the CLI binary runs**

Run: `cargo run -p everr-cli -- telemetry path`
Expected: prints the telemetry directory path.
