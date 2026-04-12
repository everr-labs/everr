mod support;

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

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

#[test]
fn traces_returns_all_rows_with_default_filter() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = TraceFilter::default();
    let rows = store.traces(filter).expect("query traces");
    assert_eq!(rows.len(), 2, "fixture has two spans");
    let names: Vec<_> = rows.iter().map(|r| r.name.as_str()).collect();
    assert!(names.iter().any(|n| *n == "test.span.ok"));
    assert!(names.iter().any(|n| *n == "test.span.err"));
}

#[test]
fn traces_preserve_raw_ids_and_structured_resource_attributes() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let rows = store.traces(TraceFilter::default()).expect("query traces");
    assert_eq!(rows[0].trace_id, "0102030405060708090a0b0c0d0e0f10");
    assert_eq!(rows[0].span_id, "1112131415161718");
    assert_eq!(rows[0].resource["service.name"], "test-service");
}

#[test]
fn traces_name_like_filter_substring_matches() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = TraceFilter {
        name_like: Some("err".into()),
        ..TraceFilter::default()
    };
    let rows = store.traces(filter).expect("query traces");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "test.span.err");
}

#[test]
fn logs_returns_all_records_by_default() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter::default();
    let rows = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 2, "fixture has two log records");
}

#[test]
fn logs_trace_id_filter_matches_fixture_row() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter {
        trace_id: Some("0102030405060708090a0b0c0d0e0f10".into()),
        ..LogFilter::default()
    };
    let rows = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].message, "test log message info");
    assert_eq!(
        rows[0].trace_id.as_deref(),
        Some("0102030405060708090a0b0c0d0e0f10")
    );
    assert_eq!(rows[0].resource["service.name"], "test-service");
}

#[test]
fn logs_level_filter_matches_severity() {
    let store = TelemetryStore::open_at(&fixture_dir()).expect("open fixture");
    let filter = LogFilter {
        level: Some("WARN".into()),
        ..LogFilter::default()
    };
    let rows = store.logs(filter).expect("query logs");
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
    let rows = store.logs(filter).expect("query logs");
    assert_eq!(rows.len(), 0);
}
