# Local Trace Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a local trace viewer (search + timeline + stats + critical path + spans + JSON) as a new top-level page in the Everr desktop app, reading OTLP JSON files the collector writes on disk.

**Architecture:** New Rust workspace crate `everr-telemetry-dto` holds shared DTOs and aggregation helpers. The desktop app's `src-tauri` exposes three new commands (`telemetry_search_traces`, `telemetry_get_trace`, `telemetry_list_services`) that call into reused CLI telemetry modules plus new aggregation code. The desktop React app adds `features/traces/` with TanStack Router routes `/traces` and `/traces/$traceId`, using Shadcn/BaseUI + Tailwind + TanStack Query. URL search params are the single source of truth for filters; raw datemath strings stay in query keys, resolution happens inside fetchers.

**Tech Stack:** Rust (workspace member crate, serde, blake3), Tauri v2, React 19, TanStack Query + Router, Shadcn/BaseUI, Tailwind, `@tanstack/react-virtual`, `@everr/ui` (`RefreshPicker`, `TimeRangePicker`), `@everr/datemath`.

**Spec:** `docs/superpowers/specs/2026-04-15-local-trace-viewer-design.md`

---

## Phase 1 — Rust foundation

### Task 1: Create `everr-telemetry-dto` crate

**Files:**
- Create: `crates/everr-telemetry-dto/Cargo.toml`
- Create: `crates/everr-telemetry-dto/src/lib.rs`
- Modify: `Cargo.toml` (workspace members)

- [ ] **Step 1: Add the crate to the workspace**

Edit `Cargo.toml`:

```toml
[workspace]
members = [
    "crates/everr-core",
    "crates/everr-telemetry-dto",
    "packages/desktop-app/src-cli",
    "packages/desktop-app/src-tauri",
]
resolver = "2"
```

- [ ] **Step 2: Create the crate manifest**

Create `crates/everr-telemetry-dto/Cargo.toml`:

```toml
[package]
name = "everr-telemetry-dto"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
blake3 = "1"

[dev-dependencies]
```

- [ ] **Step 3: Write failing tests for DTO serialization**

Create `crates/everr-telemetry-dto/src/lib.rs`:

```rust
pub mod filter;
pub mod trace;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filter::{SpanStatusFilter, TraceFilter};
    use crate::trace::{Process, ProcessId, Span, SpanKind, SpanStatus, Trace};

    #[test]
    fn trace_filter_defaults_serialize_round_trip() {
        let f = TraceFilter::default();
        let j = serde_json::to_string(&f).unwrap();
        let back: TraceFilter = serde_json::from_str(&j).unwrap();
        assert_eq!(f, back);
    }

    #[test]
    fn trace_filter_service_is_vec() {
        let f = TraceFilter {
            service: vec!["api".into(), "worker".into()],
            ..Default::default()
        };
        assert_eq!(f.service.len(), 2);
    }

    #[test]
    fn process_id_is_stable_for_same_attrs() {
        let attrs_a = vec![
            ("service.name".into(), "api".into()),
            ("host.name".into(), "pod-1".into()),
        ];
        let attrs_b = vec![
            ("host.name".into(), "pod-1".into()),   // different order
            ("service.name".into(), "api".into()),
        ];
        assert_eq!(ProcessId::from_attrs(&attrs_a), ProcessId::from_attrs(&attrs_b));
    }

    #[test]
    fn process_id_differs_across_instances() {
        let a = vec![
            ("service.name".into(), "api".into()),
            ("host.name".into(), "pod-1".into()),
        ];
        let b = vec![
            ("service.name".into(), "api".into()),
            ("host.name".into(), "pod-2".into()),
        ];
        assert_ne!(ProcessId::from_attrs(&a), ProcessId::from_attrs(&b));
    }

    #[test]
    fn span_status_filter_parses() {
        for (s, v) in [
            ("all", SpanStatusFilter::All),
            ("ok", SpanStatusFilter::Ok),
            ("error", SpanStatusFilter::Error),
        ] {
            let j = serde_json::to_string(&v).unwrap();
            assert_eq!(j, format!("\"{s}\""));
            let back: SpanStatusFilter = serde_json::from_str(&j).unwrap();
            assert_eq!(back, v);
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cargo test -p everr-telemetry-dto`
Expected: FAIL with "module `filter` not found" / "module `trace` not found".

- [ ] **Step 5: Implement `filter` module**

Create `crates/everr-telemetry-dto/src/filter.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceFilter {
    /// Minimum timestamp (epoch nanoseconds, inclusive). None = no lower bound.
    pub from_ns: Option<u64>,
    /// Maximum timestamp (epoch nanoseconds, inclusive). None = no upper bound.
    pub to_ns: Option<u64>,
    /// Substring match on span name.
    pub name_like: Option<String>,
    /// Multi-select service filter. Empty = all services.
    #[serde(default)]
    pub service: Vec<String>,
    /// Inspect exactly one trace.
    pub trace_id: Option<String>,
    /// Attribute filters: (key, value) pairs.
    #[serde(default)]
    pub attrs: Vec<(String, String)>,
    /// Trace-level minimum wall-clock duration, in nanoseconds.
    pub min_duration_ns: Option<u64>,
    /// Trace-level maximum wall-clock duration, in nanoseconds.
    pub max_duration_ns: Option<u64>,
    /// Root-span status filter. None = All.
    #[serde(default)]
    pub status: SpanStatusFilter,
    /// Max number of traces to return.
    pub limit: Option<usize>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpanStatusFilter {
    #[default]
    All,
    Ok,
    Error,
}
```

- [ ] **Step 6: Implement `trace` module**

Create `crates/everr-telemetry-dto/src/trace.rs`:

```rust
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProcessId(pub String);

impl ProcessId {
    /// Stable hash across identical attribute sets regardless of input ordering.
    /// Uses blake3 over a canonical, sorted representation of the attributes.
    pub fn from_attrs(attrs: &[(String, String)]) -> Self {
        let mut sorted: BTreeMap<&str, &str> = BTreeMap::new();
        for (k, v) in attrs {
            sorted.insert(k.as_str(), v.as_str());
        }
        let mut hasher = blake3::Hasher::new();
        for (k, v) in &sorted {
            hasher.update(k.as_bytes());
            hasher.update(b"=");
            hasher.update(v.as_bytes());
            hasher.update(b"\n");
        }
        let hex = hasher.finalize().to_hex();
        Self(hex[..16].to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpanStatus {
    Unset,
    Ok,
    Error,
}

impl SpanStatus {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Ok,
            2 => Self::Error,
            _ => Self::Unset,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpanKind {
    Unspecified,
    Internal,
    Server,
    Client,
    Producer,
    Consumer,
}

impl SpanKind {
    pub fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Internal,
            2 => Self::Server,
            3 => Self::Client,
            4 => Self::Producer,
            5 => Self::Consumer,
            _ => Self::Unspecified,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanEvent {
    pub timestamp_ns: u64,
    pub name: String,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanLink {
    pub trace_id: String,
    pub span_id: String,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub trace_id: String,
    pub operation_name: String,
    pub service_name: String,
    pub process_id: ProcessId,
    pub start_ns: u64,
    pub duration_ns: u64,
    pub status: SpanStatus,
    pub kind: SpanKind,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
    #[serde(default)]
    pub events: Vec<SpanEvent>,
    #[serde(default)]
    pub links: Vec<SpanLink>,
    #[serde(default)]
    pub flags: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub process_id: ProcessId,
    pub service_name: String,
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub trace_id: String,
    pub spans: Vec<Span>,
    pub processes: Vec<Process>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSummary {
    pub trace_id: String,
    pub root_service: String,
    pub root_name: String,
    pub root_status: SpanStatus,
    pub start_ns: u64,
    pub duration_ns: u64,
    pub span_count: u32,
    pub error_count: u32,
    pub services: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSummaryPage {
    pub items: Vec<TraceSummary>,
    pub total_scanned: u32,
    pub newest_file_age_ms: Option<u64>,
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test -p everr-telemetry-dto`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml crates/everr-telemetry-dto
git commit -m "feat(telemetry): add shared DTO crate for trace viewer"
```

---

### Task 2: Extend `TraceFilter` in CLI telemetry with new fields (backwards-compatible)

**Files:**
- Modify: `packages/desktop-app/src-cli/src/telemetry/query.rs`
- Modify: `packages/desktop-app/src-cli/src/telemetry/commands.rs` (map `--service` CLI flag)
- Modify: `packages/desktop-app/src-cli/Cargo.toml` (dep on `everr-telemetry-dto`)

- [ ] **Step 1: Add `everr-telemetry-dto` as a CLI dependency**

Edit `packages/desktop-app/src-cli/Cargo.toml` — under `[dependencies]`, add:

```toml
everr-telemetry-dto = { path = "../../../crates/everr-telemetry-dto" }
```

- [ ] **Step 2: Replace local `TraceFilter` with the shared one**

In `packages/desktop-app/src-cli/src/telemetry/query.rs`, remove the existing `TraceFilter` struct (lines 8-19). Replace with a re-export and a compatibility view:

```rust
// near the top of query.rs, after existing `use` lines
pub use everr_telemetry_dto::filter::{SpanStatusFilter, TraceFilter};
```

- [ ] **Step 3: Update all existing `TraceFilter` field accesses**

In the same file, search for uses of `filter.service.as_ref()` / similar and adapt:
- `filter.service` is now `Vec<String>` (was `Option<String>`).
- Span-level filtering replaces `is_none_or(|s| rs.resource.service_name == s.as_str())` with `filter.service.is_empty() || filter.service.iter().any(|s| s == &rs.resource.service_name)`.

Concretely, find the block that filters `ResourceSpans` by service (around the `attrs_match` call site) and change:

```rust
// Before:
if let Some(svc) = filter.service.as_ref() {
    if rs.resource.service_name() != svc.as_str() { continue; }
}

// After:
if !filter.service.is_empty()
    && !filter.service.iter().any(|s| s == &rs.resource.service_name())
{
    continue;
}
```

- [ ] **Step 4: Update CLI `--service` flag to produce `Vec<String>`**

In `packages/desktop-app/src-cli/src/telemetry/commands.rs`, find where `TraceFilter` is constructed from CLI args and change:

```rust
// Before:
service: args.service.clone(),

// After:
service: args.service.iter().cloned().collect(),
```

If `args.service` is a single `Option<String>` today, leave the flag shape alone and convert:

```rust
service: args.service.as_ref().map(|s| vec![s.clone()]).unwrap_or_default(),
```

- [ ] **Step 5: Run all CLI tests**

Run: `cargo test -p everr-desktop-cli`
Expected: PASS. Existing tests that construct `TraceFilter` must keep working with the new `service: Vec<String>` field.

- [ ] **Step 6: Add tests for new fields**

In `packages/desktop-app/src-cli/src/telemetry/query.rs` (or a sibling test file), add:

```rust
#[cfg(test)]
mod new_filter_fields {
    use super::*;

    #[test]
    fn empty_service_vec_means_no_service_filter() {
        let f = TraceFilter::default();
        assert!(f.service.is_empty());
    }

    #[test]
    fn multi_service_filter_matches_any() {
        let f = TraceFilter {
            service: vec!["a".into(), "b".into()],
            ..Default::default()
        };
        assert!(f.service.iter().any(|s| s == "a"));
        assert!(f.service.iter().any(|s| s == "b"));
        assert!(!f.service.iter().any(|s| s == "c"));
    }
}
```

- [ ] **Step 7: Run the new tests**

Run: `cargo test -p everr-desktop-cli new_filter_fields`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop-app/src-cli
git commit -m "refactor(telemetry): switch TraceFilter to shared DTO and multi-service"
```

---

### Task 3: Add trace-summary aggregation and root election

**Files:**
- Create: `crates/everr-telemetry-dto/src/aggregate.rs`
- Modify: `crates/everr-telemetry-dto/src/lib.rs` (expose module)

- [ ] **Step 1: Write failing tests for root election**

Append to `crates/everr-telemetry-dto/src/lib.rs`:

```rust
pub mod aggregate;
```

Create `crates/everr-telemetry-dto/src/aggregate.rs`:

```rust
use std::collections::{BTreeMap, HashMap};

use crate::filter::{SpanStatusFilter, TraceFilter};
use crate::trace::{Process, ProcessId, Span, SpanStatus, Trace, TraceSummary};

/// A flat span row, sufficient for summary aggregation.
/// The CLI's `TraceRow` can be converted into this on the fly.
#[derive(Debug, Clone)]
pub struct RawSpan {
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub name: String,
    pub service_name: String,
    pub start_ns: u64,
    pub duration_ns: u64,
    pub status: SpanStatus,
    pub resource_attrs: Vec<(String, String)>,
}

/// Group rows by trace id and compute one `TraceSummary` per trace.
/// Applies trace-level filters (`min_duration_ns` / `max_duration_ns`, `status`, `service`).
/// `limit` is applied last, after sorting by `start_ns` descending (newest first).
pub fn aggregate_summaries(rows: Vec<RawSpan>, filter: &TraceFilter) -> Vec<TraceSummary> {
    let mut by_trace: HashMap<String, Vec<RawSpan>> = HashMap::new();
    for row in rows {
        by_trace.entry(row.trace_id.clone()).or_default().push(row);
    }

    let mut out: Vec<TraceSummary> = Vec::new();
    for (trace_id, spans) in by_trace {
        if spans.is_empty() { continue; }

        let root = elect_root(&spans);
        let start_ns = spans.iter().map(|s| s.start_ns).min().unwrap_or(0);
        let end_ns = spans
            .iter()
            .map(|s| s.start_ns.saturating_add(s.duration_ns))
            .max()
            .unwrap_or(start_ns);
        let duration_ns = end_ns.saturating_sub(start_ns);
        let span_count = spans.len() as u32;
        let error_count = spans
            .iter()
            .filter(|s| matches!(s.status, SpanStatus::Error))
            .count() as u32;
        let mut services: Vec<String> =
            spans.iter().map(|s| s.service_name.clone()).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
        services.sort();

        let summary = TraceSummary {
            trace_id,
            root_service: root.service_name.clone(),
            root_name: root.name.clone(),
            root_status: root.status,
            start_ns,
            duration_ns,
            span_count,
            error_count,
            services,
        };

        if !passes_trace_filter(&summary, filter) { continue; }
        out.push(summary);
    }

    out.sort_by(|a, b| b.start_ns.cmp(&a.start_ns));
    if let Some(limit) = filter.limit {
        out.truncate(limit);
    }
    out
}

/// Deterministic root election per the spec's numbered rule.
pub fn elect_root(spans: &[RawSpan]) -> &RawSpan {
    let ids: std::collections::HashSet<&str> =
        spans.iter().map(|s| s.span_id.as_str()).collect();

    let parentless: Vec<&RawSpan> =
        spans.iter().filter(|s| s.parent_span_id.is_none()).collect();

    if parentless.len() == 1 {
        return parentless[0];
    }

    if parentless.len() > 1 {
        return *parentless
            .iter()
            .min_by(|a, b| {
                a.start_ns
                    .cmp(&b.start_ns)
                    .then_with(|| a.span_id.cmp(&b.span_id))
            })
            .expect("non-empty");
    }

    // All parents present in the data set, but some reference spans outside:
    // pick the earliest span whose parent is NOT in `ids`.
    let orphans: Vec<&RawSpan> = spans
        .iter()
        .filter(|s| match &s.parent_span_id {
            Some(p) => !ids.contains(p.as_str()),
            None => false,
        })
        .collect();
    if !orphans.is_empty() {
        return *orphans
            .iter()
            .min_by(|a, b| {
                a.start_ns
                    .cmp(&b.start_ns)
                    .then_with(|| a.span_id.cmp(&b.span_id))
            })
            .expect("non-empty");
    }

    // Pathological: every span's parent is known but no span is root.
    // Pick the earliest span to keep the result deterministic.
    spans
        .iter()
        .min_by(|a, b| a.start_ns.cmp(&b.start_ns).then_with(|| a.span_id.cmp(&b.span_id)))
        .expect("non-empty")
}

fn passes_trace_filter(s: &TraceSummary, f: &TraceFilter) -> bool {
    if let Some(min) = f.min_duration_ns {
        if s.duration_ns < min { return false; }
    }
    if let Some(max) = f.max_duration_ns {
        if s.duration_ns > max { return false; }
    }
    if !f.service.is_empty() {
        let matches = s.services.iter().any(|svc| f.service.iter().any(|w| w == svc));
        if !matches { return false; }
    }
    match f.status {
        SpanStatusFilter::All => {}
        SpanStatusFilter::Ok => {
            if !matches!(s.root_status, SpanStatus::Ok | SpanStatus::Unset) { return false; }
        }
        SpanStatusFilter::Error => {
            if !matches!(s.root_status, SpanStatus::Error) { return false; }
        }
    }
    true
}

/// Build per-trace `Process` entries from raw spans' resource attributes.
/// Emits one `Process` per distinct resource-attribute set. Returns the
/// process ID per span in the same order as input.
pub fn derive_processes(spans: &[RawSpan]) -> (Vec<ProcessId>, Vec<Process>) {
    let mut ids: Vec<ProcessId> = Vec::with_capacity(spans.len());
    let mut processes_by_id: BTreeMap<ProcessId, Process> = BTreeMap::new();
    for s in spans {
        let id = ProcessId::from_attrs(&s.resource_attrs);
        ids.push(id.clone());
        processes_by_id.entry(id.clone()).or_insert_with(|| Process {
            process_id: id,
            service_name: s.service_name.clone(),
            attributes: s
                .resource_attrs
                .iter()
                .map(|(k, v)| crate::trace::KeyValue { key: k.clone(), value: v.clone() })
                .collect(),
        });
    }
    (ids, processes_by_id.into_values().collect())
}

/// Assemble a full `Trace` from raw rows. `warnings` is populated for
/// missing-parent orphans.
pub fn assemble_trace(trace_id: &str, rows: Vec<RawSpan>) -> Trace {
    let (process_ids, processes) = derive_processes(&rows);
    let id_set: std::collections::HashSet<&str> =
        rows.iter().map(|r| r.span_id.as_str()).collect();

    let mut warnings: Vec<String> = Vec::new();
    let mut spans: Vec<Span> = Vec::with_capacity(rows.len());
    for (i, r) in rows.iter().enumerate() {
        if let Some(p) = &r.parent_span_id {
            if !id_set.contains(p.as_str()) {
                warnings.push(format!("missing parent span {p} for span {}", r.span_id));
            }
        }
        spans.push(Span {
            span_id: r.span_id.clone(),
            parent_span_id: r.parent_span_id.clone(),
            trace_id: r.trace_id.clone(),
            operation_name: r.name.clone(),
            service_name: r.service_name.clone(),
            process_id: process_ids[i].clone(),
            start_ns: r.start_ns,
            duration_ns: r.duration_ns,
            status: r.status,
            kind: crate::trace::SpanKind::Unspecified,
            attributes: Vec::new(),
            events: Vec::new(),
            links: Vec::new(),
            flags: 0,
        });
    }
    Trace {
        trace_id: trace_id.to_string(),
        spans,
        processes,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(trace: &str, id: &str, parent: Option<&str>, start: u64, dur: u64) -> RawSpan {
        RawSpan {
            trace_id: trace.into(),
            span_id: id.into(),
            parent_span_id: parent.map(|s| s.into()),
            name: format!("op-{id}"),
            service_name: "svc".into(),
            start_ns: start,
            duration_ns: dur,
            status: SpanStatus::Ok,
            resource_attrs: vec![("service.name".into(), "svc".into())],
        }
    }

    #[test]
    fn elects_single_root() {
        let rows = vec![row("t", "r", None, 0, 100), row("t", "c", Some("r"), 10, 50)];
        assert_eq!(elect_root(&rows).span_id, "r");
    }

    #[test]
    fn picks_earliest_on_multi_root() {
        let rows = vec![row("t", "b", None, 20, 10), row("t", "a", None, 10, 10)];
        assert_eq!(elect_root(&rows).span_id, "a");
    }

    #[test]
    fn breaks_tie_lexicographically() {
        let rows = vec![row("t", "b", None, 10, 10), row("t", "a", None, 10, 10)];
        assert_eq!(elect_root(&rows).span_id, "a");
    }

    #[test]
    fn picks_orphan_when_no_parentless() {
        let rows = vec![
            row("t", "a", Some("missing"), 10, 10),
            row("t", "b", Some("a"), 20, 5),
        ];
        assert_eq!(elect_root(&rows).span_id, "a");
    }

    #[test]
    fn aggregates_duration_and_counts() {
        let rows = vec![row("t", "r", None, 0, 100), row("t", "c", Some("r"), 10, 50)];
        let f = TraceFilter::default();
        let out = aggregate_summaries(rows, &f);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].trace_id, "t");
        assert_eq!(out[0].span_count, 2);
        assert_eq!(out[0].root_name, "op-r");
        assert_eq!(out[0].duration_ns, 100);
    }

    #[test]
    fn status_filter_keeps_only_errors() {
        let mut r = row("t", "r", None, 0, 100);
        r.status = SpanStatus::Error;
        let rows = vec![r, row("u", "r", None, 0, 100)];
        let f = TraceFilter {
            status: SpanStatusFilter::Error,
            ..Default::default()
        };
        let out = aggregate_summaries(rows, &f);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].trace_id, "t");
    }

    #[test]
    fn duration_filter_bounds() {
        let rows = vec![row("t", "r", None, 0, 100), row("u", "r", None, 0, 500)];
        let f = TraceFilter {
            min_duration_ns: Some(200),
            ..Default::default()
        };
        let out = aggregate_summaries(rows, &f);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].trace_id, "u");
    }

    #[test]
    fn derive_processes_collapses_identical_and_keeps_distinct() {
        let a = RawSpan {
            resource_attrs: vec![
                ("service.name".into(), "api".into()),
                ("host.name".into(), "pod-1".into()),
            ],
            ..row("t", "a", None, 0, 10)
        };
        let b = RawSpan {
            resource_attrs: vec![
                ("service.name".into(), "api".into()),
                ("host.name".into(), "pod-2".into()),
            ],
            ..row("t", "b", None, 0, 10)
        };
        let c = RawSpan {
            resource_attrs: vec![
                ("host.name".into(), "pod-1".into()),
                ("service.name".into(), "api".into()),
            ],
            ..row("t", "c", None, 0, 10)
        };
        let (_, processes) = derive_processes(&[a, b, c]);
        assert_eq!(processes.len(), 2);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p everr-telemetry-dto aggregate::tests`
Expected: PASS (8 tests).

- [ ] **Step 3: Commit**

```bash
git add crates/everr-telemetry-dto
git commit -m "feat(telemetry): add trace-summary aggregation and root election"
```

---

### Task 4: Add `list_services` helper in CLI telemetry

**Files:**
- Create: `packages/desktop-app/src-cli/src/telemetry/services.rs`
- Modify: `packages/desktop-app/src-cli/src/telemetry/mod.rs`

- [ ] **Step 1: Wire the new module**

Edit `packages/desktop-app/src-cli/src/telemetry/mod.rs`, add:

```rust
pub mod services;
```

- [ ] **Step 2: Write failing test**

Create `packages/desktop-app/src-cli/src/telemetry/services.rs`:

```rust
use std::collections::BTreeSet;
use std::io::BufRead;

use crate::telemetry::otlp::{self, OtlpSignal};
use crate::telemetry::store::{StoreError, TelemetryStore};

/// Walk OTLP files in `store` between `from_ns` and `to_ns` and collect distinct
/// `service.name` resource attribute values. Returns a sorted, deduplicated list.
pub fn list_services(
    store: &TelemetryStore,
    from_ns: u64,
    to_ns: u64,
) -> Result<Vec<String>, StoreError> {
    let mut found: BTreeSet<String> = BTreeSet::new();
    for file in store.files()? {
        if let Some(rot) = file.rotation_time_ns {
            if rot < from_ns { continue; }
        }
        let reader = std::io::BufReader::new(std::fs::File::open(&file.path)?);
        for line in reader.lines() {
            let Ok(line) = line else { continue; };
            if line.trim().is_empty() { continue; }
            let Ok(signal) = serde_json::from_str::<OtlpSignal>(&line) else { continue; };
            if let OtlpSignal::Traces(traces) = signal {
                for rs in &traces.resource_spans {
                    let svc = rs.resource.service_name().to_string();
                    // Cheap window filter: any span in the window → include the service.
                    let any_in_window = rs.scope_spans.iter().any(|ss| {
                        ss.spans.iter().any(|s| {
                            let start = s.start_time_unix_nano.unwrap_or(0);
                            start >= from_ns && start <= to_ns
                        })
                    });
                    if any_in_window { found.insert(svc); }
                }
            }
        }
    }
    Ok(found.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_otlp(dir: &std::path::Path, name: &str, contents: &str) {
        std::fs::write(dir.join(name), contents).unwrap();
    }

    #[test]
    fn returns_sorted_distinct_services() {
        let tmp = TempDir::new().unwrap();
        // Minimal OTLP traces payload with two services.
        let line1 = r#"{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"api"}}]},"scopeSpans":[{"spans":[{"traceId":"01","spanId":"a1","name":"op","startTimeUnixNano":"100","endTimeUnixNano":"200"}]}]}]}"#;
        let line2 = r#"{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"worker"}}]},"scopeSpans":[{"spans":[{"traceId":"02","spanId":"b1","name":"op","startTimeUnixNano":"150","endTimeUnixNano":"250"}]}]}]}"#;
        write_otlp(tmp.path(), "otlp.json", &format!("{line1}\n{line2}\n"));
        let store = TelemetryStore::open_at(tmp.path()).unwrap();
        let out = list_services(&store, 0, u64::MAX).unwrap();
        assert_eq!(out, vec!["api".to_string(), "worker".to_string()]);
    }
}
```

If `TelemetryStore::files()` does not yet exist, add it to `store.rs`:

```rust
pub fn files(&self) -> Result<Vec<OtlpFile>, StoreError> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&self.dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !is_otlp_file(&name) { continue; }
        out.push(OtlpFile {
            path: entry.path(),
            rotation_time_ns: parse_rotation_ns(&name),
        });
    }
    Ok(out)
}
```

Also ensure `tempfile` is in `[dev-dependencies]` of `packages/desktop-app/src-cli/Cargo.toml`.

- [ ] **Step 3: Run test**

Run: `cargo test -p everr-desktop-cli services::tests`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src-cli
git commit -m "feat(telemetry): list distinct services in a time window"
```

---

### Task 5: Wire Tauri commands for telemetry

**Files:**
- Create: `packages/desktop-app/src-tauri/src/telemetry/commands.rs`
- Modify: `packages/desktop-app/src-tauri/src/telemetry/mod.rs`
- Modify: `packages/desktop-app/src-tauri/Cargo.toml` (deps)
- Modify: `packages/desktop-app/src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Add dependencies**

In `packages/desktop-app/src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
everr-telemetry-dto = { path = "../../../crates/everr-telemetry-dto" }
everr-desktop-cli = { path = "../src-cli" }
```

If the CLI crate is not currently a library, turn it into one by adding `[lib]` with `path = "src/lib.rs"` in `src-cli/Cargo.toml` and ensuring `lib.rs` re-exports `pub mod telemetry;`.

- [ ] **Step 2: Wire the new module**

Edit `packages/desktop-app/src-tauri/src/telemetry/mod.rs`:

```rust
#[cfg(debug_assertions)]
pub mod bridge;
pub mod commands;
pub mod ports;
pub mod sidecar;
```

- [ ] **Step 3: Write failing tests**

Create `packages/desktop-app/src-tauri/src/telemetry/commands.rs`:

```rust
use std::time::{SystemTime, UNIX_EPOCH};

use everr_telemetry_dto::filter::TraceFilter;
use everr_telemetry_dto::trace::{Trace, TraceSummaryPage};
use serde::Serialize;

use crate::CommandResult;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum TelemetryError {
    CollectorNotRunning,
    DirMissing,
    TraceNotFound { trace_id: String },
    Io { message: String },
}

impl std::fmt::Display for TelemetryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CollectorNotRunning => write!(f, "collector_not_running"),
            Self::DirMissing => write!(f, "dir_missing"),
            Self::TraceNotFound { trace_id } => write!(f, "trace_not_found:{trace_id}"),
            Self::Io { message } => write!(f, "io: {message}"),
        }
    }
}

fn telemetry_dir() -> Result<std::path::PathBuf, TelemetryError> {
    everr_core::build::telemetry_dir()
        .map_err(|e| TelemetryError::Io { message: e.to_string() })
}

fn newest_file_age_ms(dir: &std::path::Path) -> Option<u64> {
    let now = SystemTime::now();
    let mut newest: Option<SystemTime> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("otlp") || !name.contains(".json") { continue; }
        if let Ok(meta) = entry.metadata() {
            if let Ok(mt) = meta.modified() {
                if newest.map_or(true, |n| mt > n) { newest = Some(mt); }
            }
        }
    }
    let mt = newest?;
    let ms = now.duration_since(mt).ok()?.as_millis();
    u64::try_from(ms).ok()
}

#[tauri::command]
pub async fn telemetry_search_traces(
    filter: TraceFilter,
) -> CommandResult<TraceSummaryPage> {
    // Runs on the Tauri async runtime; the work itself is blocking I/O.
    tauri::async_runtime::spawn_blocking(move || {
        let dir = telemetry_dir().map_err(|e| e.to_string())?;
        if !dir.exists() {
            return Err(TelemetryError::DirMissing.to_string());
        }
        let store = everr_desktop_cli::telemetry::store::TelemetryStore::open_at(&dir)
            .map_err(|e| TelemetryError::Io { message: e.to_string() }.to_string())?;

        let rows = everr_desktop_cli::telemetry::query::scan_trace_rows(&store, &filter)
            .map_err(|e| TelemetryError::Io { message: e.to_string() }.to_string())?;
        let raw: Vec<everr_telemetry_dto::aggregate::RawSpan> =
            rows.into_iter().map(row_to_raw).collect();
        let items = everr_telemetry_dto::aggregate::aggregate_summaries(raw, &filter);
        Ok(TraceSummaryPage {
            total_scanned: items.len() as u32,
            newest_file_age_ms: newest_file_age_ms(&dir),
            items,
        })
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

#[tauri::command]
pub async fn telemetry_get_trace(trace_id: String) -> CommandResult<Trace> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = telemetry_dir().map_err(|e| e.to_string())?;
        if !dir.exists() { return Err(TelemetryError::DirMissing.to_string()); }
        let store = everr_desktop_cli::telemetry::store::TelemetryStore::open_at(&dir)
            .map_err(|e| TelemetryError::Io { message: e.to_string() }.to_string())?;
        let filter = TraceFilter {
            trace_id: Some(trace_id.clone()),
            ..Default::default()
        };
        let rows = everr_desktop_cli::telemetry::query::scan_trace_rows(&store, &filter)
            .map_err(|e| TelemetryError::Io { message: e.to_string() }.to_string())?;
        if rows.is_empty() {
            return Err(TelemetryError::TraceNotFound { trace_id }.to_string());
        }
        let raw: Vec<everr_telemetry_dto::aggregate::RawSpan> =
            rows.into_iter().map(row_to_raw).collect();
        Ok(everr_telemetry_dto::aggregate::assemble_trace(&trace_id, raw))
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

#[tauri::command]
pub async fn telemetry_list_services(
    from_ns: u64,
    to_ns: u64,
) -> CommandResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = telemetry_dir().map_err(|e| e.to_string())?;
        if !dir.exists() { return Err(TelemetryError::DirMissing.to_string()); }
        let store = everr_desktop_cli::telemetry::store::TelemetryStore::open_at(&dir)
            .map_err(|e| TelemetryError::Io { message: e.to_string() }.to_string())?;
        everr_desktop_cli::telemetry::services::list_services(&store, from_ns, to_ns)
            .map_err(|e| TelemetryError::Io { message: e.to_string() }.to_string())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

fn row_to_raw(
    r: everr_desktop_cli::telemetry::query::TraceRow,
) -> everr_telemetry_dto::aggregate::RawSpan {
    everr_telemetry_dto::aggregate::RawSpan {
        trace_id: r.trace_id,
        span_id: r.span_id,
        parent_span_id: r.parent_span_id,
        name: r.name,
        service_name: r
            .resource_attrs
            .iter()
            .find(|kv| kv.key == "service.name")
            .map(|kv| kv.value_as_string())
            .unwrap_or_default(),
        start_ns: r.timestamp_ns,
        duration_ns: r.duration_ns,
        status: everr_telemetry_dto::trace::SpanStatus::from_code(r.status_code),
        resource_attrs: r
            .resource_attrs
            .into_iter()
            .map(|kv| (kv.key, kv.value_as_string()))
            .collect(),
    }
}
```

This requires exposing a reusable `scan_trace_rows(&store, &filter)` in `packages/desktop-app/src-cli/src/telemetry/query.rs`. If the existing `search_traces`/`build_trace_tree` entrypoints don't match, extract a pub fn that returns `Vec<TraceRow>` given a `TraceFilter`. Wrap the existing span-row scan logic.

Also: `KeyValue::value_as_string()` is a helper — add it to `otlp.rs` if it doesn't exist:

```rust
impl KeyValue {
    pub fn value_as_string(&self) -> String {
        match &self.value {
            AttributeValue::StringValue(s) => s.clone(),
            AttributeValue::BoolValue(b) => b.to_string(),
            AttributeValue::IntValue(n) => n.to_string(),
            AttributeValue::DoubleValue(d) => d.to_string(),
            _ => String::new(),
        }
    }
}
```

- [ ] **Step 4: Register commands in Tauri handler**

Edit `packages/desktop-app/src-tauri/src/lib.rs`. At the top:

```rust
use telemetry::commands::{
    telemetry_get_trace, telemetry_list_services, telemetry_search_traces,
};
```

In the `tauri::generate_handler!` macro, add:

```rust
telemetry_search_traces,
telemetry_get_trace,
telemetry_list_services,
```

- [ ] **Step 5: Write an integration test for the command happy path**

Create `packages/desktop-app/src-tauri/src/telemetry/commands_test.rs` (or extend `src/tests.rs` depending on existing conventions):

```rust
#[cfg(test)]
mod command_tests {
    use super::commands::*;
    // The commands do real filesystem work; use a temp telemetry dir
    // via EVERR_TELEMETRY_DIR env override if `build::telemetry_dir` supports it.
    // If not, extract the inner non-`#[tauri::command]` helpers (e.g. `do_search`)
    // and test those directly without going through the Tauri runtime.
    // ...
}
```

If `build::telemetry_dir()` is not overridable in tests, refactor it to accept an optional override via env var `EVERR_TELEMETRY_DIR_OVERRIDE`, set the env in the test, and assert the Tauri-wrapped commands return the expected shape.

- [ ] **Step 6: Run tests**

Run: `cargo test -p everr-desktop-tauri`
Expected: PASS.

- [ ] **Step 7: Verify Tauri still builds**

Run: `cargo build -p everr-desktop-tauri`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop-app/src-cli packages/desktop-app/src-tauri
git commit -m "feat(telemetry): add Tauri commands for trace search and fetch"
```

---

## Phase 2 — Shared UI refactor

### Task 6: Refactor `useAutoRefresh` to be route-agnostic

**Files:**
- Create: `packages/ui/src/hooks/use-auto-refresh.ts`
- Modify: `packages/app/src/hooks/use-auto-refresh.ts` (becomes a thin wrapper)
- Modify: `packages/ui/src/components/refresh-picker.tsx` (if needed)

- [ ] **Step 1: Write failing test for the lifted hook**

Create `packages/ui/src/hooks/use-auto-refresh.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoRefresh } from "./use-auto-refresh";

describe("useAutoRefresh", () => {
  it("invokes onTick on the given interval", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    renderHook(() => useAutoRefresh({ refresh: "10s", onTick }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onTick).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not tick when refresh is off", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    renderHook(() => useAutoRefresh({ refresh: "off", onTick }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onTick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @everr/ui test use-auto-refresh`
Expected: FAIL ("module not found").

- [ ] **Step 3: Implement the lifted hook**

Create `packages/ui/src/hooks/use-auto-refresh.ts`:

```ts
import { useEffect, useRef } from "react";
import { getRefreshIntervalMs, type RefreshInterval } from "../lib/refresh-interval";

export interface UseAutoRefreshArgs {
  refresh: RefreshInterval;
  onTick: () => void;
}

export function useAutoRefresh({ refresh, onTick }: UseAutoRefreshArgs): void {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    const ms = getRefreshIntervalMs(refresh);
    if (!ms) return;
    const handle = setInterval(() => {
      onTickRef.current();
    }, ms);
    return () => clearInterval(handle);
  }, [refresh]);
}
```

Create `packages/ui/src/lib/refresh-interval.ts` with the same type and helper the web app uses today. Copy from `packages/app/src/lib/time-range.ts` the minimal `RefreshInterval` type and `getRefreshIntervalMs()` function.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @everr/ui test use-auto-refresh`
Expected: PASS (2 tests).

- [ ] **Step 5: Rewrite the web app's hook as a wrapper**

Replace `packages/app/src/hooks/use-auto-refresh.ts`:

```ts
import { useAutoRefresh as useAutoRefreshBase } from "@everr/ui/hooks/use-auto-refresh";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  type RefreshInterval,
  ResolvedTimeRangeSearchSchema,
} from "@/lib/time-range";

export function useAutoRefresh() {
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const { refresh } = ResolvedTimeRangeSearchSchema.parse(search);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useAutoRefreshBase({
    refresh,
    onTick: () => {
      void queryClient.invalidateQueries();
    },
  });

  const setRefreshInterval = (value: RefreshInterval) => {
    void navigate({
      // @ts-expect-error -- route-agnostic navigation
      search: (prev) => ({ ...prev, refresh: value || undefined }),
      replace: true,
    });
  };

  const refreshNow = () => {
    void queryClient.invalidateQueries();
  };

  return { refreshInterval: refresh, setRefreshInterval, refreshNow };
}
```

- [ ] **Step 6: Run the web app's tests**

Run: `pnpm --filter @everr/app test`
Expected: PASS (the wrapper preserves the same return shape, so existing callers are unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/ui packages/app
git commit -m "refactor(ui): lift useAutoRefresh into @everr/ui"
```

---

### Task 7: Add `@tanstack/react-virtual` to the desktop app

**Files:**
- Modify: `packages/desktop-app/package.json`

- [ ] **Step 1: Add the dependency**

Run:

```bash
pnpm --filter @everr/desktop-app add @tanstack/react-virtual
```

- [ ] **Step 2: Verify it installed**

Run: `pnpm --filter @everr/desktop-app list @tanstack/react-virtual`
Expected: shows a version.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-app/package.json pnpm-lock.yaml
git commit -m "chore(desktop-app): add react-virtual for virtualized lists"
```

---

## Phase 3 — Desktop traces feature (frontend)

### Task 8: Set up feature folder, types, and URL schemas

**Files:**
- Create: `packages/desktop-app/src/features/traces/shared/types.ts`
- Create: `packages/desktop-app/src/features/traces/shared/url-schemas.ts`
- Create: `packages/desktop-app/src/features/traces/shared/format-duration.ts`
- Create: `packages/desktop-app/src/features/traces/shared/format-duration.test.ts`
- Create: `packages/desktop-app/src/features/traces/shared/service-color.ts`
- Create: `packages/desktop-app/src/features/traces/shared/service-color.test.ts`

- [ ] **Step 1: Mirror Rust DTOs as TS types**

Create `packages/desktop-app/src/features/traces/shared/types.ts`:

```ts
export type SpanStatus = "unset" | "ok" | "error";
export type SpanKind =
  | "unspecified" | "internal" | "server" | "client" | "producer" | "consumer";
export type SpanStatusFilter = "all" | "ok" | "error";
export type ProcessId = string;

export interface KeyValue { key: string; value: string; }

export interface SpanEvent {
  timestampNs: number;
  name: string;
  attributes: KeyValue[];
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes: KeyValue[];
}

export interface Span {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  operationName: string;
  serviceName: string;
  processId: ProcessId;
  startNs: number;
  durationNs: number;
  status: SpanStatus;
  kind: SpanKind;
  attributes: KeyValue[];
  events: SpanEvent[];
  links: SpanLink[];
  flags: number;
}

export interface Process {
  processId: ProcessId;
  serviceName: string;
  attributes: KeyValue[];
}

export interface Trace {
  traceId: string;
  spans: Span[];
  processes: Process[];
  warnings: string[];
}

export interface TraceSummary {
  traceId: string;
  rootService: string;
  rootName: string;
  rootStatus: SpanStatus;
  startNs: number;
  durationNs: number;
  spanCount: number;
  errorCount: number;
  services: string[];
}

export interface TraceSummaryPage {
  items: TraceSummary[];
  totalScanned: number;
  newestFileAgeMs: number | null;
}

export interface TraceFilter {
  fromNs: number | null;
  toNs: number | null;
  nameLike: string | null;
  service: string[];
  traceId: string | null;
  attrs: [string, string][];
  minDurationNs: number | null;
  maxDurationNs: number | null;
  status: SpanStatusFilter;
  limit: number | null;
}
```

> Because `js-numbers` cannot represent `u64` losslessly, values up to ~2^53 work fine for millisecond/second timestamps and durations in dev. If durations ever exceed that, revisit using `string` on the wire — out of scope for MVP.

- [ ] **Step 2: Define URL schemas**

Create `packages/desktop-app/src/features/traces/shared/url-schemas.ts`:

```ts
import { z } from "zod";

const datemath = z.string().min(1);

export const SearchTracesUrlSchema = z.object({
  from: datemath.default("now-1h"),
  to: datemath.default("now"),
  refresh: z.string().default("off"),
  service: z.array(z.string()).default([]),
  name: z.string().default(""),
  attr: z.array(z.string()).default([]),    // "k=v" strings, parsed in the fetcher
  minMs: z.coerce.number().int().nonnegative().optional(),
  maxMs: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().default(50),
  status: z.enum(["all", "ok", "error"]).default("all"),
});

export type SearchTracesSearch = z.infer<typeof SearchTracesUrlSchema>;

export const TraceDetailUrlSchema = z.object({
  tab: z
    .enum(["timeline", "stats", "critical-path", "spans", "json"])
    .default("timeline"),
  span: z.string().optional(),
  group: z.enum(["operation", "service", "tag"]).default("operation"),
  groupBy: z.string().optional(),
});

export type TraceDetailSearch = z.infer<typeof TraceDetailUrlSchema>;
```

- [ ] **Step 3: Write tests for `formatDuration`**

Create `packages/desktop-app/src/features/traces/shared/format-duration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it.each([
    [0, "0 ns"],
    [999, "999 ns"],
    [1_000, "1.0 µs"],
    [12_345, "12.3 µs"],
    [1_000_000, "1.0 ms"],
    [12_345_000, "12.3 ms"],
    [1_000_000_000, "1.00 s"],
    [61_000_000_000, "1 m 1.0 s"],
    [3_661_000_000_000, "1 h 1 m 1.0 s"],
  ])("formats %i ns as %s", (ns, expected) => {
    expect(formatDuration(ns)).toBe(expected);
  });
});
```

- [ ] **Step 4: Implement `formatDuration`**

Create `packages/desktop-app/src/features/traces/shared/format-duration.ts`:

```ts
export function formatDuration(ns: number): string {
  if (ns < 1_000) return `${ns} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)} ms`;
  const seconds = ns / 1_000_000_000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rem = seconds - minutes * 60;
    return `${minutes} m ${rem.toFixed(1)} s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes - hours * 60;
  const remSec = seconds - hours * 3600 - remMin * 60;
  return `${hours} h ${remMin} m ${remSec.toFixed(1)} s`;
}
```

- [ ] **Step 5: Write tests for `serviceColor`**

Create `packages/desktop-app/src/features/traces/shared/service-color.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serviceColor } from "./service-color";

describe("serviceColor", () => {
  it("returns the same CSS variable for the same service across calls", () => {
    expect(serviceColor("api")).toBe(serviceColor("api"));
  });

  it("returns different variables for different services", () => {
    expect(serviceColor("api")).not.toBe(serviceColor("worker"));
  });

  it("always returns a CSS var reference (not a hex literal)", () => {
    expect(serviceColor("api").startsWith("var(--")).toBe(true);
  });
});
```

- [ ] **Step 6: Implement `serviceColor`**

Create `packages/desktop-app/src/features/traces/shared/service-color.ts`:

```ts
const SERVICE_COLOR_VARS = [
  "--trace-color-1",
  "--trace-color-2",
  "--trace-color-3",
  "--trace-color-4",
  "--trace-color-5",
  "--trace-color-6",
  "--trace-color-7",
  "--trace-color-8",
] as const;

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

export function serviceColor(serviceName: string): string {
  const idx = hash(serviceName) % SERVICE_COLOR_VARS.length;
  return `var(${SERVICE_COLOR_VARS[idx]})`;
}
```

Then, add the actual CSS variable definitions in `packages/desktop-app/src/styles/desktop-app.css` — append near the existing `@theme inline` block:

```css
@theme inline {
  --trace-color-1: #60a5fa;
  --trace-color-2: #34d399;
  --trace-color-3: #fbbf24;
  --trace-color-4: #f87171;
  --trace-color-5: #a78bfa;
  --trace-color-6: #f472b6;
  --trace-color-7: #22d3ee;
  --trace-color-8: #facc15;
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @everr/desktop-app test -- features/traces/shared`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop-app/src/features/traces packages/desktop-app/src/styles/desktop-app.css
git commit -m "feat(traces): add types, url schemas, format-duration, service-color"
```

---

### Task 9: Search page query + TanStack Query setup

**Files:**
- Create: `packages/desktop-app/src/features/traces/search/use-search-traces.ts`
- Create: `packages/desktop-app/src/features/traces/search/use-services.ts`
- Create: `packages/desktop-app/src/features/traces/trace/use-get-trace.ts`
- Create: `packages/desktop-app/src/features/traces/shared/query-keys.ts`

- [ ] **Step 1: Define query keys**

Create `packages/desktop-app/src/features/traces/shared/query-keys.ts`:

```ts
import type { SearchTracesSearch } from "./url-schemas";

export const tracesQueryKeys = {
  all: ["traces"] as const,
  search: (s: SearchTracesSearch) =>
    [
      "traces",
      "search",
      s.from,
      s.to,
      s.service.join(","),
      s.name,
      s.attr.join(","),
      s.minMs ?? null,
      s.maxMs ?? null,
      s.status,
      s.limit,
    ] as const,
  trace: (id: string) => ["traces", "trace", id] as const,
  services: (from: string, to: string) =>
    ["traces", "services", from, to] as const,
};
```

Notice raw `from`/`to` strings in the key, per the spec's rationale.

- [ ] **Step 2: Implement `useSearchTraces`**

Create `packages/desktop-app/src/features/traces/search/use-search-traces.ts`:

```ts
import { resolve } from "@everr/datemath";
import { useQuery } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import type { TraceFilter, TraceSummaryPage } from "../shared/types";
import { tracesQueryKeys } from "../shared/query-keys";
import type { SearchTracesSearch } from "../shared/url-schemas";

function parseAttr(entries: string[]): [string, string][] {
  return entries
    .map((e) => {
      const idx = e.indexOf("=");
      if (idx < 0) return null;
      return [e.slice(0, idx), e.slice(idx + 1)] as [string, string];
    })
    .filter((x): x is [string, string] => x !== null);
}

export function useSearchTraces(search: SearchTracesSearch) {
  return useQuery({
    queryKey: tracesQueryKeys.search(search),
    queryFn: async (): Promise<TraceSummaryPage> => {
      const fromNs = resolve(search.from).getTime() * 1_000_000;
      const toNs = resolve(search.to).getTime() * 1_000_000;
      const filter: TraceFilter = {
        fromNs,
        toNs,
        nameLike: search.name || null,
        service: search.service,
        traceId: null,
        attrs: parseAttr(search.attr),
        minDurationNs: search.minMs != null ? search.minMs * 1_000_000 : null,
        maxDurationNs: search.maxMs != null ? search.maxMs * 1_000_000 : null,
        status: search.status,
        limit: search.limit,
      };
      return invokeCommand<TraceSummaryPage>("telemetry_search_traces", { filter });
    },
  });
}
```

- [ ] **Step 3: Implement `useServices`**

Create `packages/desktop-app/src/features/traces/search/use-services.ts`:

```ts
import { resolve } from "@everr/datemath";
import { useQuery } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import { tracesQueryKeys } from "../shared/query-keys";

export function useServices(from: string, to: string) {
  return useQuery({
    queryKey: tracesQueryKeys.services(from, to),
    queryFn: async (): Promise<string[]> => {
      const fromNs = resolve(from).getTime() * 1_000_000;
      const toNs = resolve(to).getTime() * 1_000_000;
      return invokeCommand<string[]>("telemetry_list_services", { fromNs, toNs });
    },
  });
}
```

- [ ] **Step 4: Implement `useGetTrace`**

Create `packages/desktop-app/src/features/traces/trace/use-get-trace.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import type { Trace } from "../shared/types";
import { tracesQueryKeys } from "../shared/query-keys";

export function useGetTrace(traceId: string) {
  return useQuery({
    queryKey: tracesQueryKeys.trace(traceId),
    queryFn: (): Promise<Trace> =>
      invokeCommand<Trace>("telemetry_get_trace", { traceId }),
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop-app/src/features/traces
git commit -m "feat(traces): add query hooks for search, services, and trace load"
```

---

### Task 10: Search page + trace filters

**Files:**
- Create: `packages/desktop-app/src/features/traces/search/trace-filters.tsx`
- Create: `packages/desktop-app/src/features/traces/search/duration-bar.tsx`
- Create: `packages/desktop-app/src/features/traces/search/trace-results-list.tsx`
- Create: `packages/desktop-app/src/features/traces/search/search-page.tsx`
- Create: `packages/desktop-app/src/features/traces/routes/traces.tsx`

- [ ] **Step 1: Implement `DurationBar`**

Create `packages/desktop-app/src/features/traces/search/duration-bar.tsx`:

```tsx
import { formatDuration } from "../shared/format-duration";

export function DurationBar({
  durationNs,
  maxNs,
  color,
}: { durationNs: number; maxNs: number; color: string }) {
  const pct = maxNs > 0 ? Math.min(100, (durationNs / maxNs) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-32 rounded bg-white/[0.06]">
        <div
          className="absolute inset-y-0 left-0 rounded"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="tabular-nums text-xs text-[var(--settings-text-muted)]">
        {formatDuration(durationNs)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Implement `TraceFilters`**

Create `packages/desktop-app/src/features/traces/search/trace-filters.tsx`:

```tsx
import { Input } from "@everr/ui/components/input";
import { Button } from "@everr/ui/components/button";
import type { SearchTracesSearch } from "../shared/url-schemas";

export interface TraceFiltersProps {
  value: SearchTracesSearch;
  onChange: (next: Partial<SearchTracesSearch>) => void;
  services: string[];
}

export function TraceFilters({ value, onChange, services }: TraceFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 p-3 border-b border-white/[0.06]">
      <Labeled label="Span name contains">
        <Input
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. GET /api/runs"
          className="w-56"
        />
      </Labeled>
      <Labeled label="Services">
        <ServiceMultiSelect
          options={services}
          value={value.service}
          onChange={(service) => onChange({ service })}
        />
      </Labeled>
      <Labeled label="Status">
        <select
          value={value.status}
          onChange={(e) => onChange({ status: e.target.value as SearchTracesSearch["status"] })}
          className="h-8 rounded border border-white/[0.06] bg-transparent px-2 text-sm"
        >
          <option value="all">All</option>
          <option value="ok">Ok</option>
          <option value="error">Error</option>
        </select>
      </Labeled>
      <Labeled label="Min duration (ms)">
        <Input
          type="number"
          value={value.minMs ?? ""}
          onChange={(e) =>
            onChange({ minMs: e.target.value ? Number(e.target.value) : undefined })
          }
          className="w-24"
        />
      </Labeled>
      <Labeled label="Max duration (ms)">
        <Input
          type="number"
          value={value.maxMs ?? ""}
          onChange={(e) =>
            onChange({ maxMs: e.target.value ? Number(e.target.value) : undefined })
          }
          className="w-24"
        />
      </Labeled>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange({
            name: "",
            service: [],
            status: "all",
            minMs: undefined,
            maxMs: undefined,
            attr: [],
          })
        }
      >
        Clear
      </Button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--settings-text-muted)]">
      {label}
      {children}
    </label>
  );
}

function ServiceMultiSelect({
  options,
  value,
  onChange,
}: { options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (svc: string) => {
    if (value.includes(svc)) onChange(value.filter((s) => s !== svc));
    else onChange([...value, svc]);
  };
  return (
    <div className="flex flex-wrap gap-1 max-w-md">
      {options.map((svc) => {
        const active = value.includes(svc);
        return (
          <button
            key={svc}
            type="button"
            onClick={() => toggle(svc)}
            className={
              "rounded px-2 py-0.5 text-xs border " +
              (active
                ? "border-white/[0.24] bg-white/[0.08] text-[var(--settings-text)]"
                : "border-white/[0.06] text-[var(--settings-text-muted)] hover:bg-white/[0.04]")
            }
          >
            {svc}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Implement `TraceResultsList` (virtualized)**

Create `packages/desktop-app/src/features/traces/search/trace-results-list.tsx`:

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import type { TraceSummary } from "../shared/types";
import { DurationBar } from "./duration-bar";
import { serviceColor } from "../shared/service-color";

export interface TraceResultsListProps {
  items: TraceSummary[];
}

export function TraceResultsList({ items }: TraceResultsListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const maxDuration = items.reduce((m, t) => Math.max(m, t.durationNs), 0);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  if (items.length === 0) {
    return (
      <div className="p-6 text-sm text-[var(--settings-text-muted)]">
        No traces in this window.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((v) => {
          const t = items[v.index];
          return (
            <Link
              to="/traces/$traceId"
              params={{ traceId: t.traceId }}
              key={t.traceId}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: v.size,
                transform: `translateY(${v.start}px)`,
              }}
              className="flex items-center gap-4 border-b border-white/[0.04] px-4 hover:bg-white/[0.03]"
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: serviceColor(t.rootService) }}
                aria-hidden
              />
              <span className="w-48 truncate text-sm">
                {t.rootService} <span className="text-[var(--settings-text-muted)]">/</span> {t.rootName}
              </span>
              <DurationBar
                durationNs={t.durationNs}
                maxNs={maxDuration}
                color={serviceColor(t.rootService)}
              />
              <span className="ml-auto tabular-nums text-xs text-[var(--settings-text-muted)]">
                {t.spanCount} spans
                {t.errorCount > 0 ? ` · ${t.errorCount} errors` : ""}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `SearchPage`**

Create `packages/desktop-app/src/features/traces/search/search-page.tsx`:

```tsx
import { RefreshPicker } from "@everr/ui/components/refresh-picker";
import { TimeRangePicker } from "@everr/ui/components/time-range-picker";
import { useAutoRefresh } from "@everr/ui/hooks/use-auto-refresh";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useSearchTraces } from "./use-search-traces";
import { useServices } from "./use-services";
import { TraceFilters } from "./trace-filters";
import { TraceResultsList } from "./trace-results-list";
import { tracesQueryKeys } from "../shared/query-keys";

export function SearchPage() {
  const search = useSearch({ from: "/traces" });
  const navigate = useNavigate({ from: "/traces" });
  const queryClient = useQueryClient();
  const servicesQuery = useServices(search.from, search.to);
  const tracesQuery = useSearchTraces(search);

  useAutoRefresh({
    refresh: search.refresh,
    onTick: () => {
      void queryClient.invalidateQueries({ queryKey: tracesQueryKeys.all });
    },
  });

  const patch = (next: Partial<typeof search>) => {
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
        <h1 className="text-sm font-medium">Traces</h1>
        <div className="ml-auto flex items-center gap-2">
          <TimeRangePicker
            value={{ from: search.from, to: search.to }}
            onChange={(tr) => patch({ from: tr.from, to: tr.to })}
          />
          <RefreshPicker
            value={search.refresh}
            onChange={(refresh) => patch({ refresh })}
            onRefresh={() =>
              queryClient.invalidateQueries({ queryKey: tracesQueryKeys.all })
            }
            isFetching={tracesQuery.isFetching}
          />
        </div>
      </header>
      <TraceFilters
        value={search}
        onChange={patch}
        services={servicesQuery.data ?? []}
      />
      <SearchStatus query={tracesQuery} />
      <TraceResultsList items={tracesQuery.data?.items ?? []} />
    </div>
  );
}

function SearchStatus({
  query,
}: {
  query: ReturnType<typeof useSearchTraces>;
}) {
  if (query.error) {
    const message = String(query.error);
    if (message.startsWith("dir_missing")) {
      return (
        <div className="p-3 text-xs text-[var(--settings-text-muted)] border-b border-white/[0.06]">
          Telemetry collector hasn't started yet. It starts with the desktop app.
        </div>
      );
    }
    return (
      <div className="p-3 text-xs text-red-300 border-b border-white/[0.06]">
        {message}
      </div>
    );
  }
  const age = query.data?.newestFileAgeMs ?? null;
  if (age !== null && age > 5 * 60_000) {
    return (
      <div className="p-3 text-xs text-amber-300 border-b border-white/[0.06]">
        No new traces in {Math.round(age / 60_000)} minutes — the emitting service may not be running.
      </div>
    );
  }
  return null;
}
```

- [ ] **Step 5: Register the route**

Create `packages/desktop-app/src/features/traces/routes/traces.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { SearchPage } from "../search/search-page";
import { SearchTracesUrlSchema } from "../shared/url-schemas";

export const Route = createFileRoute("/traces")({
  validateSearch: SearchTracesUrlSchema.parse,
  component: SearchPage,
});
```

- [ ] **Step 6: Regenerate the router tree**

Run: `pnpm --filter @everr/desktop-app exec tsr generate` (or the equivalent script used in `scripts/`). If no such script exists, re-run `pnpm --filter @everr/desktop-app run frontend:dev` once to let the vite plugin regenerate `routeTree.gen.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop-app/src/features/traces packages/desktop-app/src/routeTree.gen.ts
git commit -m "feat(traces): add search page, filters, virtualized results"
```

---

### Task 11: Trace detail scaffold (header + tab router + loader)

**Files:**
- Create: `packages/desktop-app/src/features/traces/trace/trace-header.tsx`
- Create: `packages/desktop-app/src/features/traces/trace/trace-detail-page.tsx`
- Create: `packages/desktop-app/src/features/traces/routes/trace-detail.tsx`

- [ ] **Step 1: Implement `TraceHeader`**

Create `packages/desktop-app/src/features/traces/trace/trace-header.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import { Copy, RefreshCw } from "lucide-react";
import { formatDuration } from "../shared/format-duration";
import type { Trace } from "../shared/types";

export function TraceHeader({
  trace,
  onRefresh,
  isRefreshing,
}: { trace: Trace; onRefresh: () => void; isRefreshing: boolean }) {
  const rootSpan = trace.spans.find((s) => !s.parentSpanId) ?? trace.spans[0];
  const start = Math.min(...trace.spans.map((s) => s.startNs));
  const end = Math.max(...trace.spans.map((s) => s.startNs + s.durationNs));
  const duration = end - start;
  return (
    <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2">
      <div>
        <div className="text-sm font-medium">{rootSpan.operationName}</div>
        <div className="text-xs text-[var(--settings-text-muted)]">
          {rootSpan.serviceName} · {formatDuration(duration)} · {trace.spans.length} spans
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigator.clipboard.writeText(trace.traceId)}
      >
        <Copy className="size-3.5" /> {trace.traceId.slice(0, 12)}…
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        className="ml-auto"
        disabled={isRefreshing}
      >
        <RefreshCw className={"size-3.5 " + (isRefreshing ? "animate-spin" : "")} />
        Refresh
      </Button>
    </header>
  );
}
```

- [ ] **Step 2: Implement `TraceDetailPage`**

Create `packages/desktop-app/src/features/traces/trace/trace-detail-page.tsx`:

```tsx
import { useAutoRefresh } from "@everr/ui/hooks/use-auto-refresh";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { TimelineView } from "./tabs/timeline/timeline-view";
import { StatsView } from "./tabs/stats/stats-view";
import { CriticalPathView } from "./tabs/critical-path/critical-path-view";
import { SpansTable } from "./tabs/spans/spans-table";
import { JsonView } from "./tabs/json/json-view";
import { TraceHeader } from "./trace-header";
import { useGetTrace } from "./use-get-trace";
import { tracesQueryKeys } from "../shared/query-keys";

export function TraceDetailPage() {
  const { traceId } = useParams({ from: "/traces/$traceId" });
  const search = useSearch({ from: "/traces/$traceId" });
  const navigate = useNavigate({ from: "/traces/$traceId" });
  const queryClient = useQueryClient();
  const parentSearch = (useSearch({ strict: false }) as { refresh?: string }) ?? {};
  const refresh = (parentSearch.refresh as "off" | "5s" | "10s" | "30s" | "1m" | undefined) ?? "off";

  const traceQuery = useGetTrace(traceId);
  useAutoRefresh({
    refresh,
    onTick: () => {
      void queryClient.invalidateQueries({ queryKey: tracesQueryKeys.trace(traceId) });
    },
  });

  const refetch = () => traceQuery.refetch();

  if (traceQuery.error) {
    const message = String(traceQuery.error);
    if (message.startsWith("trace_not_found")) {
      return (
        <div className="p-6 text-sm text-[var(--settings-text-muted)]">
          This trace is no longer on disk. The collector rotates files over time.
        </div>
      );
    }
    return <div className="p-6 text-sm text-red-300">{message}</div>;
  }
  if (!traceQuery.data) return null;
  const trace = traceQuery.data;
  if (trace.spans.length === 0) {
    return <div className="p-6 text-sm text-[var(--settings-text-muted)]">This trace contains no spans.</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <TraceHeader trace={trace} onRefresh={refetch} isRefreshing={traceQuery.isFetching} />
      {trace.warnings.length > 0 && (
        <div className="border-b border-white/[0.06] bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
          {trace.warnings.length} warnings: {trace.warnings.slice(0, 3).join("; ")}
          {trace.warnings.length > 3 ? "…" : ""}
        </div>
      )}
      <TabBar
        active={search.tab}
        onChange={(tab) => void navigate({ search: (prev) => ({ ...prev, tab }), replace: true })}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {search.tab === "timeline" && <TimelineView trace={trace} search={search} />}
        {search.tab === "stats" && <StatsView trace={trace} search={search} />}
        {search.tab === "critical-path" && <CriticalPathView trace={trace} search={search} />}
        {search.tab === "spans" && <SpansTable trace={trace} />}
        {search.tab === "json" && <JsonView trace={trace} />}
      </div>
    </div>
  );
}

function TabBar({
  active,
  onChange,
}: {
  active: "timeline" | "stats" | "critical-path" | "spans" | "json";
  onChange: (tab: "timeline" | "stats" | "critical-path" | "spans" | "json") => void;
}) {
  const tabs: Array<[typeof active, string]> = [
    ["timeline", "Timeline"],
    ["stats", "Stats"],
    ["critical-path", "Critical path"],
    ["spans", "Spans"],
    ["json", "JSON"],
  ];
  return (
    <div className="flex gap-2 border-b border-white/[0.06] px-4">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={
            "px-3 py-2 text-xs border-b-2 " +
            (active === id
              ? "border-white text-[var(--settings-text)]"
              : "border-transparent text-[var(--settings-text-muted)] hover:text-[var(--settings-text)]")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Register the route**

Create `packages/desktop-app/src/features/traces/routes/trace-detail.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { TraceDetailPage } from "../trace/trace-detail-page";
import { TraceDetailUrlSchema } from "../shared/url-schemas";

export const Route = createFileRoute("/traces/$traceId")({
  validateSearch: TraceDetailUrlSchema.parse,
  component: TraceDetailPage,
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/features/traces packages/desktop-app/src/routeTree.gen.ts
git commit -m "feat(traces): scaffold trace detail page with header, tabs, and loader"
```

---

### Task 12: Timeline layout hook + pure-function tests

**Files:**
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/use-timeline-layout.ts`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/use-timeline-layout.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/desktop-app/src/features/traces/trace/tabs/timeline/use-timeline-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeTimelineRows } from "./use-timeline-layout";
import type { Span, Trace } from "../../../shared/types";

function span(partial: Partial<Span>): Span {
  return {
    spanId: "x",
    parentSpanId: null,
    traceId: "t",
    operationName: "op",
    serviceName: "svc",
    processId: "p",
    startNs: 0,
    durationNs: 100,
    status: "ok",
    kind: "internal",
    attributes: [],
    events: [],
    links: [],
    flags: 0,
    ...partial,
  };
}

function makeTrace(spans: Span[]): Trace {
  return { traceId: "t", spans, processes: [], warnings: [] };
}

describe("computeTimelineRows", () => {
  it("renders a single-span trace", () => {
    const rows = computeTimelineRows(makeTrace([span({})]), { collapsed: new Set() });
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].skew).toBe(null);
  });

  it("nests children by parentSpanId", () => {
    const t = makeTrace([
      span({ spanId: "r" }),
      span({ spanId: "c", parentSpanId: "r", startNs: 10 }),
    ]);
    const rows = computeTimelineRows(t, { collapsed: new Set() });
    expect(rows.map((r) => [r.span.spanId, r.depth])).toEqual([
      ["r", 0],
      ["c", 1],
    ]);
  });

  it("groups orphans under a synthetic root", () => {
    const t = makeTrace([
      span({ spanId: "a", parentSpanId: "missing", startNs: 10 }),
      span({ spanId: "b", parentSpanId: "a", startNs: 20 }),
    ]);
    const rows = computeTimelineRows(t, { collapsed: new Set() });
    expect(rows[0].syntheticRoot).toBe(true);
    expect(rows.slice(1).map((r) => r.span.spanId)).toEqual(["a", "b"]);
  });

  it("clamps child start to parent start on clock skew and tags it", () => {
    const t = makeTrace([
      span({ spanId: "r", startNs: 100, durationNs: 100 }),
      span({ spanId: "c", parentSpanId: "r", startNs: 50, durationNs: 10 }),
    ]);
    const rows = computeTimelineRows(t, { collapsed: new Set() });
    const c = rows.find((r) => r.span.spanId === "c")!;
    expect(c.renderStartNs).toBe(100);
    expect(c.skew).toEqual({ originalStartNs: 50 });
  });

  it("hides descendants when an ancestor is collapsed", () => {
    const t = makeTrace([
      span({ spanId: "r" }),
      span({ spanId: "c", parentSpanId: "r", startNs: 10 }),
    ]);
    const rows = computeTimelineRows(t, { collapsed: new Set(["r"]) });
    expect(rows.map((r) => r.span.spanId)).toEqual(["r"]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @everr/desktop-app test use-timeline-layout`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

Create `packages/desktop-app/src/features/traces/trace/tabs/timeline/use-timeline-layout.ts`:

```ts
import { useMemo, useState } from "react";
import type { Span, Trace } from "../../../shared/types";

export interface TimelineRow {
  span: Span;
  depth: number;
  renderStartNs: number;            // possibly clamped for clock skew
  renderEndNs: number;              // span.startNs + span.durationNs (unclamped)
  skew: { originalStartNs: number } | null;
  syntheticRoot?: boolean;
}

export interface TimelineLayoutState { collapsed: Set<string>; }

const SYNTHETIC_ROOT_ID = "__orphans__";

export function computeTimelineRows(
  trace: Trace,
  state: TimelineLayoutState,
): TimelineRow[] {
  const ids = new Set(trace.spans.map((s) => s.spanId));
  const byParent = new Map<string | null, Span[]>();
  for (const span of trace.spans) {
    const parent =
      span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : null;
    const arr = byParent.get(parent) ?? [];
    arr.push(span);
    byParent.set(parent, arr);
  }
  for (const [, arr] of byParent) {
    arr.sort((a, b) => a.startNs - b.startNs || a.spanId.localeCompare(b.spanId));
  }

  const rootCandidates = byParent.get(null) ?? [];
  const rows: TimelineRow[] = [];

  const orphans = rootCandidates.filter((s) => s.parentSpanId !== null);
  const trueRoots = rootCandidates.filter((s) => s.parentSpanId === null);

  const walk = (span: Span, depth: number, parentStartNs: number | null) => {
    const skewed = parentStartNs !== null && span.startNs < parentStartNs;
    rows.push({
      span,
      depth,
      renderStartNs: skewed ? parentStartNs! : span.startNs,
      renderEndNs: span.startNs + span.durationNs,
      skew: skewed ? { originalStartNs: span.startNs } : null,
    });
    if (state.collapsed.has(span.spanId)) return;
    const children = byParent.get(span.spanId) ?? [];
    for (const child of children) walk(child, depth + 1, span.startNs);
  };

  if (orphans.length > 0) {
    const earliest = Math.min(...orphans.map((s) => s.startNs));
    rows.push({
      span: {
        spanId: SYNTHETIC_ROOT_ID,
        parentSpanId: null,
        traceId: trace.traceId,
        operationName: "(orphans)",
        serviceName: "(synthetic)",
        processId: "",
        startNs: earliest,
        durationNs: Math.max(...orphans.map((s) => s.startNs + s.durationNs)) - earliest,
        status: "unset",
        kind: "unspecified",
        attributes: [],
        events: [],
        links: [],
        flags: 0,
      },
      depth: 0,
      renderStartNs: earliest,
      renderEndNs: Math.max(...orphans.map((s) => s.startNs + s.durationNs)),
      skew: null,
      syntheticRoot: true,
    });
    if (!state.collapsed.has(SYNTHETIC_ROOT_ID)) {
      for (const o of orphans) walk(o, 1, null);
    }
  }

  for (const root of trueRoots) walk(root, 0, null);

  return rows;
}

export function useTimelineLayout(trace: Trace) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(
    () => computeTimelineRows(trace, { collapsed }),
    [trace, collapsed],
  );
  const toggle = (spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };
  const collapseAll = () => setCollapsed(new Set(trace.spans.map((s) => s.spanId)));
  const expandAll = () => setCollapsed(new Set());
  return { rows, toggle, collapseAll, expandAll };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @everr/desktop-app test use-timeline-layout`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop-app/src/features/traces/trace/tabs/timeline
git commit -m "feat(traces): timeline layout hook with skew + orphan handling"
```

---

### Task 13: Timeline rendering (header, rows, span bars, detail panel)

**Files:**
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/timeline-header.tsx`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/span-bar.tsx`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/span-row.tsx`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/span-detail-panel.tsx`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/timeline-view.tsx`

- [ ] **Step 1: Implement `TimelineHeader` (time axis)**

```tsx
// timeline-header.tsx
import { formatDuration } from "../../../shared/format-duration";

export function TimelineHeader({ totalNs }: { totalNs: number }) {
  const ticks = Array.from({ length: 5 }, (_, i) => i / 4);
  return (
    <div className="relative h-6 border-b border-white/[0.06]">
      {ticks.map((f) => (
        <span
          key={f}
          className="absolute top-0 text-[10px] text-[var(--settings-text-muted)] tabular-nums"
          style={{ left: `${f * 100}%`, transform: "translateX(-50%)" }}
        >
          {formatDuration(Math.round(totalNs * f))}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `SpanBar`**

```tsx
// span-bar.tsx
export function SpanBar({
  startFraction, widthFraction, color, dim,
}: { startFraction: number; widthFraction: number; color: string; dim?: boolean }) {
  return (
    <div
      className={
        "absolute top-1.5 bottom-1.5 rounded " + (dim ? "opacity-30" : "")
      }
      style={{
        left: `${startFraction * 100}%`,
        width: `${Math.max(0.1, widthFraction * 100)}%`,
        background: color,
      }}
    />
  );
}
```

- [ ] **Step 3: Implement `SpanRow`**

```tsx
// span-row.tsx
import { ChevronDown, ChevronRight, AlertTriangle, Clock } from "lucide-react";
import type { TimelineRow } from "./use-timeline-layout";
import { SpanBar } from "./span-bar";
import { serviceColor } from "../../../shared/service-color";

export interface SpanRowProps {
  row: TimelineRow;
  traceStartNs: number;
  traceEndNs: number;
  isSelected: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  dimNonCritical?: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
}

export function SpanRow({
  row, traceStartNs, traceEndNs, isSelected, isCollapsed,
  hasChildren, dimNonCritical, onToggleCollapse, onSelect,
}: SpanRowProps) {
  const total = Math.max(1, traceEndNs - traceStartNs);
  const startFraction = (row.renderStartNs - traceStartNs) / total;
  const widthFraction = (row.renderEndNs - row.renderStartNs) / total;
  const color = serviceColor(row.span.serviceName);
  return (
    <div
      onClick={onSelect}
      className={
        "group grid grid-cols-[260px_1fr] h-7 cursor-default " +
        (isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]")
      }
      style={{ paddingLeft: `${row.depth * 12}px` }}
    >
      <div className="flex items-center gap-1 pl-1 pr-2 min-w-0 text-xs">
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
            className="text-[var(--settings-text-muted)] hover:text-[var(--settings-text)]"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        ) : <span className="w-3" />}
        <span className="size-2 rounded-full shrink-0" style={{ background: color }} aria-hidden />
        <span className="truncate">{row.span.operationName}</span>
        {row.span.status === "error" && (
          <AlertTriangle className="size-3 text-red-400" aria-label="error" />
        )}
        {row.skew && (
          <Clock className="size-3 text-amber-400" aria-label="clock skew" />
        )}
      </div>
      <div className="relative">
        <SpanBar
          startFraction={startFraction}
          widthFraction={widthFraction}
          color={color}
          dim={dimNonCritical}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `SpanDetailPanel`**

```tsx
// span-detail-panel.tsx
import { formatDuration } from "../../../shared/format-duration";
import type { Span, Trace } from "../../../shared/types";

export function SpanDetailPanel({ span, trace }: { span: Span; trace: Trace }) {
  const process = trace.processes.find((p) => p.processId === span.processId);
  return (
    <div className="w-96 shrink-0 border-l border-white/[0.06] overflow-y-auto p-4 text-xs">
      <h3 className="text-sm font-medium mb-2">{span.operationName}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-4">
        <dt className="text-[var(--settings-text-muted)]">Service</dt><dd>{span.serviceName}</dd>
        <dt className="text-[var(--settings-text-muted)]">Duration</dt><dd>{formatDuration(span.durationNs)}</dd>
        <dt className="text-[var(--settings-text-muted)]">Status</dt><dd>{span.status}</dd>
        <dt className="text-[var(--settings-text-muted)]">Kind</dt><dd>{span.kind}</dd>
        <dt className="text-[var(--settings-text-muted)]">Span ID</dt><dd className="font-mono">{span.spanId}</dd>
      </dl>
      <AttrsSection title="Tags" attributes={span.attributes} />
      {span.events.length > 0 && (
        <section className="mb-3">
          <h4 className="text-[var(--settings-text-muted)] uppercase tracking-wide text-[10px] mb-1">Events</h4>
          <ul className="space-y-1">
            {span.events.map((e, i) => (
              <li key={i}>
                <div className="font-medium">{e.name}</div>
                <div className="text-[var(--settings-text-muted)]">
                  +{formatDuration(e.timestampNs - span.startNs)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {process && (
        <AttrsSection title="Process" attributes={process.attributes} />
      )}
    </div>
  );
}

function AttrsSection({ title, attributes }: { title: string; attributes: { key: string; value: string }[] }) {
  if (attributes.length === 0) return null;
  return (
    <section className="mb-3">
      <h4 className="text-[var(--settings-text-muted)] uppercase tracking-wide text-[10px] mb-1">{title}</h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {attributes.map((kv) => (
          <div key={kv.key} className="contents">
            <dt className="text-[var(--settings-text-muted)] font-mono">{kv.key}</dt>
            <dd className="font-mono break-all">{kv.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 5: Implement `TimelineView`**

```tsx
// timeline-view.tsx
import { useVirtualizer } from "@tanstack/react-virtual";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useRef } from "react";
import type { Trace } from "../../../shared/types";
import type { TraceDetailSearch } from "../../../shared/url-schemas";
import { SpanDetailPanel } from "./span-detail-panel";
import { SpanRow } from "./span-row";
import { TimelineHeader } from "./timeline-header";
import { useTimelineLayout } from "./use-timeline-layout";

export interface TimelineViewProps {
  trace: Trace;
  search: TraceDetailSearch;
  dimPredicate?: (spanId: string) => boolean; // used by critical-path view
}

export function TimelineView({ trace, search, dimPredicate }: TimelineViewProps) {
  const { rows, toggle } = useTimelineLayout(trace);
  const navigate = useNavigate({ from: "/traces/$traceId" });
  const containerRef = useRef<HTMLDivElement>(null);

  const { traceStartNs, traceEndNs } = useMemo(() => {
    const starts = trace.spans.map((s) => s.startNs);
    const ends = trace.spans.map((s) => s.startNs + s.durationNs);
    return {
      traceStartNs: Math.min(...starts),
      traceEndNs: Math.max(...ends),
    };
  }, [trace]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  const selected = search.span
    ? trace.spans.find((s) => s.spanId === search.span) ?? null
    : null;

  const setSelected = (spanId: string | null) => {
    void navigate({
      search: (prev) => ({ ...prev, span: spanId ?? undefined }),
      replace: true,
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        <TimelineHeader totalNs={traceEndNs - traceStartNs} />
        <div ref={containerRef} className="flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index];
              const childCount = trace.spans.filter((s) => s.parentSpanId === row.span.spanId).length;
              return (
                <div
                  key={row.span.spanId + v.index}
                  style={{
                    position: "absolute",
                    left: 0, right: 0, top: 0,
                    height: v.size,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  <SpanRow
                    row={row}
                    traceStartNs={traceStartNs}
                    traceEndNs={traceEndNs}
                    isSelected={selected?.spanId === row.span.spanId}
                    isCollapsed={false /* use-timeline-layout hides collapsed rows already */}
                    hasChildren={childCount > 0}
                    dimNonCritical={dimPredicate ? !dimPredicate(row.span.spanId) : false}
                    onToggleCollapse={() => toggle(row.span.spanId)}
                    onSelect={() => setSelected(row.span.spanId)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected && <SpanDetailPanel span={selected} trace={trace} />}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-app/src/features/traces/trace/tabs/timeline
git commit -m "feat(traces): timeline view — axis, rows, span bars, detail panel"
```

---

### Task 14: Stats tab (pure fn + view)

**Files:**
- Create: `packages/desktop-app/src/features/traces/trace/tabs/stats/use-trace-stats.ts`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/stats/use-trace-stats.test.ts`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/stats/stats-view.tsx`

- [ ] **Step 1: Write failing tests**

```ts
// use-trace-stats.test.ts
import { describe, expect, it } from "vitest";
import { computeTraceStats } from "./use-trace-stats";
import type { Span, Trace } from "../../../shared/types";

const mk = (p: Partial<Span>): Span => ({
  spanId: "x", parentSpanId: null, traceId: "t",
  operationName: "op", serviceName: "svc", processId: "p",
  startNs: 0, durationNs: 100, status: "ok", kind: "internal",
  attributes: [], events: [], links: [], flags: 0, ...p,
});

function trace(spans: Span[]): Trace {
  return { traceId: "t", spans, processes: [], warnings: [] };
}

describe("computeTraceStats", () => {
  it("groups by operationName with count, total, p95", () => {
    const t = trace([
      mk({ operationName: "A", durationNs: 10 }),
      mk({ operationName: "A", durationNs: 20 }),
      mk({ operationName: "B", durationNs: 100 }),
    ]);
    const out = computeTraceStats(t, { group: "operation" });
    expect(out).toEqual([
      expect.objectContaining({ key: "B", count: 1, totalNs: 100 }),
      expect.objectContaining({ key: "A", count: 2, totalNs: 30 }),
    ]);
  });

  it("groups by tag using groupBy key", () => {
    const t = trace([
      mk({ attributes: [{ key: "http.method", value: "GET" }], durationNs: 10 }),
      mk({ attributes: [{ key: "http.method", value: "GET" }], durationNs: 20 }),
      mk({ attributes: [{ key: "http.method", value: "POST" }], durationNs: 5 }),
    ]);
    const out = computeTraceStats(t, { group: "tag", groupBy: "http.method" });
    expect(out.find((s) => s.key === "GET")?.count).toBe(2);
    expect(out.find((s) => s.key === "POST")?.count).toBe(1);
  });

  it("percent-of-trace sums to <= 100", () => {
    const t = trace([
      mk({ operationName: "A", startNs: 0, durationNs: 100 }),
      mk({ operationName: "B", startNs: 100, durationNs: 50 }),
    ]);
    const out = computeTraceStats(t, { group: "operation" });
    const sum = out.reduce((s, r) => s + r.pctOfTrace, 0);
    expect(sum).toBeLessThanOrEqual(100.0001);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @everr/desktop-app test use-trace-stats`
Expected: FAIL.

- [ ] **Step 3: Implement `computeTraceStats`**

```ts
// use-trace-stats.ts
import type { Trace } from "../../../shared/types";

export interface StatsRow {
  key: string;
  count: number;
  totalNs: number;
  avgNs: number;
  p50Ns: number;
  p95Ns: number;
  pctOfTrace: number;
}

export interface StatsArgs {
  group: "operation" | "service" | "tag";
  groupBy?: string;
}

export function computeTraceStats(trace: Trace, args: StatsArgs): StatsRow[] {
  if (trace.spans.length === 0) return [];
  const traceStart = Math.min(...trace.spans.map((s) => s.startNs));
  const traceEnd = Math.max(...trace.spans.map((s) => s.startNs + s.durationNs));
  const traceDuration = Math.max(1, traceEnd - traceStart);

  const groups = new Map<string, number[]>();
  for (const s of trace.spans) {
    const key =
      args.group === "operation" ? s.operationName :
      args.group === "service"   ? s.serviceName :
      (s.attributes.find((a) => a.key === args.groupBy)?.value ?? "(none)");
    const arr = groups.get(key) ?? [];
    arr.push(s.durationNs);
    groups.set(key, arr);
  }

  const rows: StatsRow[] = [];
  for (const [key, durations] of groups) {
    durations.sort((a, b) => a - b);
    const total = durations.reduce((s, d) => s + d, 0);
    rows.push({
      key,
      count: durations.length,
      totalNs: total,
      avgNs: total / durations.length,
      p50Ns: percentile(durations, 0.5),
      p95Ns: percentile(durations, 0.95),
      pctOfTrace: (total / traceDuration) * 100,
    });
  }
  rows.sort((a, b) => b.totalNs - a.totalNs);
  // Cap any per-group pct at 100 in case of overlapping concurrent spans.
  for (const r of rows) r.pctOfTrace = Math.min(100, r.pctOfTrace);
  return rows;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @everr/desktop-app test use-trace-stats`
Expected: PASS.

- [ ] **Step 5: Implement `StatsView`**

```tsx
// stats-view.tsx
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { formatDuration } from "../../../shared/format-duration";
import type { Trace } from "../../../shared/types";
import type { TraceDetailSearch } from "../../../shared/url-schemas";
import { computeTraceStats } from "./use-trace-stats";

export function StatsView({ trace, search }: { trace: Trace; search: TraceDetailSearch }) {
  const navigate = useNavigate({ from: "/traces/$traceId" });
  const attrKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of trace.spans) for (const a of s.attributes) set.add(a.key);
    return [...set].sort();
  }, [trace]);
  const rows = useMemo(
    () => computeTraceStats(trace, { group: search.group, groupBy: search.groupBy }),
    [trace, search.group, search.groupBy],
  );
  const patch = (next: Partial<TraceDetailSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2 text-xs">
        <label className="flex items-center gap-2">
          Group by
          <select
            value={search.group}
            onChange={(e) => patch({ group: e.target.value as TraceDetailSearch["group"] })}
            className="h-7 rounded border border-white/[0.06] bg-transparent px-2"
          >
            <option value="operation">Operation</option>
            <option value="service">Service</option>
            <option value="tag">Tag</option>
          </select>
        </label>
        {search.group === "tag" && (
          <label className="flex items-center gap-2">
            Tag key
            <select
              value={search.groupBy ?? ""}
              onChange={(e) => patch({ groupBy: e.target.value || undefined })}
              className="h-7 rounded border border-white/[0.06] bg-transparent px-2"
            >
              <option value="">— select —</option>
              {attrKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--settings-panel)] text-left text-[var(--settings-text-muted)]">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2 text-right">Count</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Avg</th>
              <th className="px-3 py-2 text-right">p50</th>
              <th className="px-3 py-2 text-right">p95</th>
              <th className="px-3 py-2 text-right">% of trace</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-white/[0.04]">
                <td className="px-3 py-1.5 font-mono">{r.key}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(r.totalNs)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(r.avgNs)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(r.p50Ns)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(r.p95Ns)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.pctOfTrace.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-app/src/features/traces/trace/tabs/stats
git commit -m "feat(traces): stats tab with operation/service/tag grouping"
```

---

### Task 15: Critical path (pure fn + view reusing timeline)

**Files:**
- Create: `packages/desktop-app/src/features/traces/trace/tabs/critical-path/compute-critical-path.ts`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/critical-path/compute-critical-path.test.ts`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/critical-path/critical-path-view.tsx`

- [ ] **Step 1: Write failing tests**

```ts
// compute-critical-path.test.ts
import { describe, expect, it } from "vitest";
import { computeCriticalPath } from "./compute-critical-path";
import type { Span, Trace } from "../../../shared/types";

const mk = (p: Partial<Span>): Span => ({
  spanId: "x", parentSpanId: null, traceId: "t",
  operationName: "op", serviceName: "svc", processId: "p",
  startNs: 0, durationNs: 100, status: "ok", kind: "internal",
  attributes: [], events: [], links: [], flags: 0, ...p,
});

function trace(spans: Span[]): Trace {
  return { traceId: "t", spans, processes: [], warnings: [] };
}

describe("computeCriticalPath", () => {
  it("single span is on the critical path", () => {
    const t = trace([mk({})]);
    expect([...computeCriticalPath(t)]).toEqual(["x"]);
  });

  it("picks longest child chain at each level", () => {
    const t = trace([
      mk({ spanId: "r", startNs: 0, durationNs: 200 }),
      mk({ spanId: "a", parentSpanId: "r", startNs: 10, durationNs: 50 }),
      mk({ spanId: "b", parentSpanId: "r", startNs: 10, durationNs: 180 }),
      mk({ spanId: "b2", parentSpanId: "b", startNs: 20, durationNs: 150 }),
    ]);
    const critical = computeCriticalPath(t);
    expect(critical.has("r")).toBe(true);
    expect(critical.has("b")).toBe(true);
    expect(critical.has("b2")).toBe(true);
    expect(critical.has("a")).toBe(false);
  });

  it("excludes orphan synthetic root from propagation", () => {
    const t = trace([
      mk({ spanId: "orph", parentSpanId: "missing", startNs: 0, durationNs: 10 }),
    ]);
    const critical = computeCriticalPath(t);
    expect(critical.has("orph")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @everr/desktop-app test compute-critical-path`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// compute-critical-path.ts
import type { Span, Trace } from "../../../shared/types";

/**
 * Critical path = root → child-with-latest-end chain, recursively.
 * For siblings, we pick the child whose renderEnd (startNs + durationNs)
 * is the latest, breaking ties by longest duration.
 */
export function computeCriticalPath(trace: Trace): Set<string> {
  const ids = new Set(trace.spans.map((s) => s.spanId));
  const byParent = new Map<string | null, Span[]>();
  for (const s of trace.spans) {
    const parent = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null;
    const arr = byParent.get(parent) ?? [];
    arr.push(s);
    byParent.set(parent, arr);
  }

  const out = new Set<string>();
  const roots = byParent.get(null) ?? [];
  for (const root of roots) walk(root, out);
  return out;

  function walk(span: Span, acc: Set<string>) {
    acc.add(span.spanId);
    const children = byParent.get(span.spanId) ?? [];
    if (children.length === 0) return;
    const next = children.reduce((best, c) => {
      const bestEnd = best.startNs + best.durationNs;
      const cEnd = c.startNs + c.durationNs;
      if (cEnd > bestEnd) return c;
      if (cEnd === bestEnd && c.durationNs > best.durationNs) return c;
      return best;
    });
    walk(next, acc);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @everr/desktop-app test compute-critical-path`
Expected: PASS.

- [ ] **Step 5: Implement `CriticalPathView`**

```tsx
// critical-path-view.tsx
import { useMemo } from "react";
import type { Trace } from "../../../shared/types";
import type { TraceDetailSearch } from "../../../shared/url-schemas";
import { TimelineView } from "../timeline/timeline-view";
import { computeCriticalPath } from "./compute-critical-path";

export function CriticalPathView({
  trace, search,
}: { trace: Trace; search: TraceDetailSearch }) {
  const critical = useMemo(() => computeCriticalPath(trace), [trace]);
  return <TimelineView trace={trace} search={search} dimPredicate={(id) => critical.has(id)} />;
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-app/src/features/traces/trace/tabs/critical-path
git commit -m "feat(traces): critical-path computation + dimmed timeline view"
```

---

### Task 16: Spans table + JSON view

**Files:**
- Create: `packages/desktop-app/src/features/traces/trace/tabs/spans/spans-table.tsx`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/json/json-view.tsx`

- [ ] **Step 1: Implement `SpansTable`**

```tsx
// spans-table.tsx
import { useMemo, useState } from "react";
import { formatDuration } from "../../../shared/format-duration";
import type { Span, Trace } from "../../../shared/types";

type SortKey = "start" | "duration" | "name" | "service";

export function SpansTable({ trace }: { trace: Trace }) {
  const [sort, setSort] = useState<SortKey>("start");
  const [asc, setAsc] = useState(true);
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const f = filter.toLowerCase();
    let arr = trace.spans.filter(
      (s) =>
        !f ||
        s.operationName.toLowerCase().includes(f) ||
        s.serviceName.toLowerCase().includes(f),
    );
    arr = [...arr].sort((a, b) => {
      const cmp =
        sort === "start" ? a.startNs - b.startNs :
        sort === "duration" ? a.durationNs - b.durationNs :
        sort === "name" ? a.operationName.localeCompare(b.operationName) :
        a.serviceName.localeCompare(b.serviceName);
      return asc ? cmp : -cmp;
    });
    return arr;
  }, [trace, sort, asc, filter]);

  const flip = (k: SortKey) => {
    if (k === sort) setAsc((v) => !v); else { setSort(k); setAsc(true); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <input
          placeholder="Filter spans…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 w-72 rounded border border-white/[0.06] bg-transparent px-2 text-xs"
        />
        <span className="ml-auto text-xs text-[var(--settings-text-muted)]">
          {rows.length} of {trace.spans.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--settings-panel)] text-left text-[var(--settings-text-muted)]">
            <tr>
              <Th onClick={() => flip("start")}>Start</Th>
              <Th onClick={() => flip("duration")}>Duration</Th>
              <Th onClick={() => flip("service")}>Service</Th>
              <Th onClick={() => flip("name")}>Operation</Th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Row key={s.spanId} span={s} traceStart={Math.min(...trace.spans.map((x) => x.startNs))} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 cursor-pointer select-none hover:text-[var(--settings-text)]" onClick={onClick}>
      {children}
    </th>
  );
}

function Row({ span, traceStart }: { span: Span; traceStart: number }) {
  return (
    <tr className="border-t border-white/[0.04]">
      <td className="px-3 py-1.5 tabular-nums">+{formatDuration(span.startNs - traceStart)}</td>
      <td className="px-3 py-1.5 tabular-nums">{formatDuration(span.durationNs)}</td>
      <td className="px-3 py-1.5">{span.serviceName}</td>
      <td className="px-3 py-1.5 font-mono">{span.operationName}</td>
      <td className="px-3 py-1.5">{span.status}</td>
    </tr>
  );
}
```

- [ ] **Step 2: Implement `JsonView`**

```tsx
// json-view.tsx
import { Copy } from "lucide-react";
import { Button } from "@everr/ui/components/button";
import type { Trace } from "../../../shared/types";

export function JsonView({ trace }: { trace: Trace }) {
  const text = JSON.stringify(trace, null, 2);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-white/[0.06] px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(text)}>
          <Copy className="size-3.5" /> Copy
        </Button>
      </div>
      <pre className="flex-1 overflow-auto p-3 text-xs font-mono leading-snug">{text}</pre>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-app/src/features/traces/trace/tabs/spans packages/desktop-app/src/features/traces/trace/tabs/json
git commit -m "feat(traces): flat spans table and raw JSON view"
```

---

### Task 17: Sidebar link + fixtures

**Files:**
- Modify: `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`
- Create: `packages/desktop-app/src/features/traces/__fixtures__/small-trace.json`
- Create: `packages/desktop-app/src/features/traces/__fixtures__/multi-service-trace.json`
- Create: `packages/desktop-app/src/features/traces/__fixtures__/orphan-trace.json`
- Create: `packages/desktop-app/src/features/traces/__fixtures__/skew-trace.json`
- Create: `packages/desktop-app/src/features/traces/__fixtures__/attr-heavy-trace.json`

- [ ] **Step 1: Add the sidebar link**

In `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`, above the `<SidebarLink to="/settings" …>` line, add:

```tsx
import { Activity, Bell, CircleUser, Code, LogOut, Settings } from "lucide-react";
// ...
<SidebarLink to="/traces" label="Traces">
  <Activity className="size-[18px]" />
</SidebarLink>
```

- [ ] **Step 2: Add a small-trace fixture**

Create `packages/desktop-app/src/features/traces/__fixtures__/small-trace.json`:

```json
{
  "traceId": "aaaaaaaaaaaaaaaa",
  "spans": [
    {
      "spanId": "0001", "parentSpanId": null, "traceId": "aaaaaaaaaaaaaaaa",
      "operationName": "GET /health", "serviceName": "api", "processId": "p1",
      "startNs": 1000000000, "durationNs": 5000000, "status": "ok", "kind": "server",
      "attributes": [{"key":"http.method","value":"GET"}],
      "events": [], "links": [], "flags": 0
    }
  ],
  "processes": [
    { "processId": "p1", "serviceName": "api",
      "attributes": [{"key":"service.name","value":"api"}] }
  ],
  "warnings": []
}
```

- [ ] **Step 3: Add the other fixtures**

Create `multi-service-trace.json`, `orphan-trace.json`, `skew-trace.json`, and `attr-heavy-trace.json` following the same `Trace` schema. Include:
- `multi-service-trace.json`: 3 services, cross-process parent-child relationships, at least one span with an event.
- `orphan-trace.json`: one span with `"parentSpanId": "missing-span-id"`.
- `skew-trace.json`: a child with `startNs` < its parent's `startNs`.
- `attr-heavy-trace.json`: HTTP spans with `http.method`, `http.status_code`, `http.route` attributes.

Example for `skew-trace.json`:

```json
{
  "traceId": "skew0000000000000",
  "spans": [
    { "spanId": "r", "parentSpanId": null, "traceId": "skew0000000000000",
      "operationName": "root", "serviceName": "api", "processId": "p1",
      "startNs": 1000, "durationNs": 2000, "status": "ok", "kind": "server",
      "attributes": [], "events": [], "links": [], "flags": 0 },
    { "spanId": "c", "parentSpanId": "r", "traceId": "skew0000000000000",
      "operationName": "skewed-child", "serviceName": "api", "processId": "p1",
      "startNs": 500, "durationNs": 200, "status": "ok", "kind": "internal",
      "attributes": [], "events": [], "links": [], "flags": 0 }
  ],
  "processes": [
    { "processId": "p1", "serviceName": "api",
      "attributes": [{"key":"service.name","value":"api"}] }
  ],
  "warnings": []
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/features
git commit -m "feat(traces): sidebar link + Trace JSON fixtures for tests"
```

---

### Task 18: Component tests for search + timeline

**Files:**
- Create: `packages/desktop-app/src/features/traces/search/trace-results-list.test.tsx`
- Create: `packages/desktop-app/src/features/traces/trace/tabs/timeline/timeline-view.test.tsx`

- [ ] **Step 1: Test `TraceResultsList` renders rows and navigates**

```tsx
// trace-results-list.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createRouter, RouterProvider, createRoute, createRootRoute, createMemoryHistory } from "@tanstack/react-router";
import { TraceResultsList } from "./trace-results-list";

const rootRoute = createRootRoute({ component: () => <Outlet /> });
function Outlet() { return null; }

describe("TraceResultsList", () => {
  it("renders one link per trace with root service/name", async () => {
    const items = [
      {
        traceId: "aaaa", rootService: "api", rootName: "GET /x",
        rootStatus: "ok" as const, startNs: 0, durationNs: 1_000_000,
        spanCount: 2, errorCount: 0, services: ["api"],
      },
    ];
    render(<TraceResultsList items={items} />, { wrapper: RouterWrapper });
    expect(screen.getByText(/api/)).toBeInTheDocument();
    expect(screen.getByText(/GET \/x/)).toBeInTheDocument();
  });

  it("shows empty state when items is empty", () => {
    render(<TraceResultsList items={[]} />, { wrapper: RouterWrapper });
    expect(screen.getByText(/No traces in this window/i)).toBeInTheDocument();
  });
});

function RouterWrapper({ children }: { children: React.ReactNode }) {
  const route = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => children });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 2: Test `TimelineView` collapses/expands and selects**

```tsx
// timeline-view.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import skewTrace from "../../../__fixtures__/skew-trace.json";
import type { Trace } from "../../../shared/types";
import { TimelineView } from "./timeline-view";

// router wrapper like above…
```

Follow the `trace-results-list.test.tsx` router wrapper pattern. Assertions:
- The skew fixture renders with exactly 2 span rows.
- Clicking the collapse chevron on the root hides the child row.
- Clicking a span row sets `?span=<id>` via the router and renders the detail panel.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @everr/desktop-app test -- features/traces`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/features/traces
git commit -m "test(traces): component tests for results list and timeline"
```

---

### Task 19: End-to-end smoke test — open app, search, view one trace

**Files:**
- None (manual verification + one integration test from the Tauri side)

- [ ] **Step 1: Run a one-shot Rust integration test that exercises the full stack**

Append to `packages/desktop-app/src-tauri/src/telemetry/commands.rs` (under `#[cfg(test)]`):

```rust
#[cfg(test)]
mod integration {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tempfile::TempDir;

    fn sample_line(trace_id: &str, span_id: &str, parent: &str) -> String {
        let start = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
        format!(
            r#"{{"resourceSpans":[{{"resource":{{"attributes":[{{"key":"service.name","value":{{"stringValue":"api"}}}}]}},"scopeSpans":[{{"spans":[{{"traceId":"{trace_id}","spanId":"{span_id}","parentSpanId":"{parent}","name":"op","startTimeUnixNano":"{start}","endTimeUnixNano":"{}"}}]}}]}}]}}"#,
            start + 1_000_000
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn search_then_get_returns_a_trace() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("otlp.json"),
            format!("{}\n{}\n", sample_line("deadbeef", "a1", ""), sample_line("deadbeef", "b1", "a1")),
        ).unwrap();
        std::env::set_var("EVERR_TELEMETRY_DIR_OVERRIDE", tmp.path());

        let page = telemetry_search_traces(TraceFilter::default()).await.unwrap();
        assert_eq!(page.items.len(), 1);
        let trace = telemetry_get_trace("deadbeef".to_string()).await.unwrap();
        assert_eq!(trace.spans.len(), 2);
    }
}
```

Ensure `everr_core::build::telemetry_dir()` honors `EVERR_TELEMETRY_DIR_OVERRIDE` (add the override if needed; wrap the existing function so tests can point it at a temp dir).

- [ ] **Step 2: Run integration test**

Run: `cargo test -p everr-desktop-tauri integration`
Expected: PASS.

- [ ] **Step 3: Manually exercise the UI**

Run: `pnpm --filter @everr/desktop-app dev`

Manual checklist:
- [ ] Sidebar shows a new "Traces" icon.
- [ ] `/traces` loads, the status banner shows "No traces in this window" if the collector has no data yet, otherwise rows appear.
- [ ] Clicking a row navigates to `/traces/<id>?tab=timeline`. Timeline renders; clicking a span opens the detail panel.
- [ ] Switching tabs (stats, critical path, spans, JSON) renders each view from the cached trace without a new IPC call (devtools network/invoke tab).
- [ ] Setting refresh to 10s on the search page causes the results list to refetch on that cadence.
- [ ] Opening a partial-trace fixture via a manually-constructed OTLP file shows the orphans banner and synthetic root.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src-tauri
git commit -m "test(traces): integration smoke test for search → get flow"
```

---

## Self-review checklist (done by plan author)

1. **Spec coverage:**
   - Top-level `/traces` route: Tasks 10, 17.
   - Search page + filters + virtualized results: Task 10.
   - Trace detail + tabs: Task 11.
   - Timeline + skew + orphans: Tasks 12, 13.
   - Stats (operation/service/tag + `groupBy`): Task 14.
   - Critical path: Task 15.
   - Spans table + JSON: Task 16.
   - Tauri commands + DTOs + aggregation: Tasks 1–5.
   - Multi-service, duration-range, root-status filters: Tasks 2, 3.
   - `ProcessId` derivation: Task 1 (DTO), Task 3 (wiring).
   - `useAutoRefresh` route-agnostic lift: Task 6.
   - `@tanstack/react-virtual` dep: Task 7.
   - Service colors via CSS vars: Task 8.
   - Fixtures (small/multi-service/orphan/skew/attr-heavy): Task 17.
   - Empty/error states: embedded in Tasks 10 and 11 (SearchStatus, trace_not_found, warnings banner).
   - Sidebar placement: Task 17.

2. **Placeholder scan:** No TBD/TODO/"implement later". Every code step has complete code or explicit copy-from-source instructions.

3. **Type consistency:**
   - `TraceFilter` fields in DTO crate (Task 1) match `TraceFilter` in TS (Task 8): `fromNs`/`toNs`/`nameLike`/`service`/`traceId`/`attrs`/`minDurationNs`/`maxDurationNs`/`status`/`limit`.
   - `Trace`, `Span`, `Process`, `TraceSummary`, `TraceSummaryPage` names consistent across Rust (Task 1) and TS (Task 8), with serde `camelCase` rename.
   - `ProcessId` is `String` in both, keyed by blake3 hash of sorted attrs (Task 1).
   - `SpanStatus` values `unset` / `ok` / `error` consistent.
   - `tracesQueryKeys.all` referenced from both search page (Task 10) and detail page (Task 11).
   - `useAutoRefresh` signature `{ refresh, onTick }` consistent across Tasks 6, 10, 11.
