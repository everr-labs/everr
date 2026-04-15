mod support;

use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

use everr_cli::telemetry::query::{LogFilter, TraceFilter};
use everr_cli::telemetry::store::{StoreError, TelemetryStore};

#[test]
fn open_on_missing_dir_returns_dir_missing() {
    let env = support::CliTestEnv::new();
    let telemetry = env.telemetry_dir();
    assert!(!telemetry.exists());

    match TelemetryStore::open_at(&telemetry) {
        Err(StoreError::DirMissing(path)) => {
            assert_eq!(path, telemetry);
        }
        other => panic!("expected DirMissing, got {other:?}"),
    }
}

#[test]
fn open_on_empty_dir_is_ok() {
    let env = support::CliTestEnv::new();
    let telemetry = env.telemetry_dir();
    fs::create_dir_all(&telemetry).expect("create telemetry dir");

    TelemetryStore::open_at(&telemetry).expect("open on empty dir");
}

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/telemetry")
}

// --- Log tests ---

#[test]
fn logs_returns_all_records_by_default() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter::default();
    let (rows, stats) = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 2, "fixture has two log records");
    assert_eq!(stats.skipped_unreadable_files, 0);
    assert_eq!(stats.skipped_malformed_lines, 0);
}

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
fn logs_from_filter_excludes_older_rows() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    // Set from_ns to now (all fixture data is in the past)
    let now_ns = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    let filter = LogFilter {
        from_ns: Some(now_ns),
        ..LogFilter::default()
    };
    let (rows, _) = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 0);
}

#[test]
fn logs_target_populated_from_scope_name() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let (rows, _) = store.logs(LogFilter::default()).expect("query logs");
    assert!(rows.iter().all(|r| r.target == "test-scope"),
        "target should come from InstrumentationScope.name");
}

// --- Trace tree tests ---

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

// --- Hydration test ---

fn hydration_fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/telemetry_hydration")
}

#[test]
fn trace_trees_hydration_loads_parent_outside_from_window() {
    // Root span: Sept 2020 (1600000000000000000ns = epoch 1600000000s)
    // Child span: Nov 2023 (1700000000000000000ns = epoch 1700000000s)
    // --from window covers child but NOT root.
    // Discovery should find the trace via the child, hydration should
    // load the root even though it's outside --from.
    let store = TelemetryStore::open_at(&hydration_fixture_dir()).expect("open fixture");

    // Set --from to midpoint between root and child epochs.
    // This includes the child (1700000000s) and excludes the root (1600000000s).
    let midpoint_epoch_ns: u64 = ((1_600_000_000u64 + 1_700_000_000) / 2) * 1_000_000_000;

    let filter = TraceFilter {
        from_ns: Some(midpoint_epoch_ns),
        ..TraceFilter::default()
    };
    let (trees, _) = store.trace_trees(filter).expect("query");
    assert_eq!(trees.len(), 1, "should find 1 trace via child span");
    assert_eq!(
        trees[0].spans.len(),
        2,
        "hydration must include root span even though it's outside --from"
    );
    let names: Vec<_> = trees[0].spans.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"root.span"), "root must be hydrated");
    assert!(names.contains(&"child.span"), "child must be present");
}
