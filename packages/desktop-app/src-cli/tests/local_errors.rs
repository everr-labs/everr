mod support;

use mockito::Matcher;
use predicates::prelude::*;
use predicates::str::contains;
use support::{CliTestEnv, mock_api_server};

const SUMMARY_ROW: &str = r#"{"fingerprint":"fp-1","exceptionType":"TypeError","exceptionMessage":"boom","body":"TypeError: boom","latestServiceName":"api","services":["api"],"occurrenceCount":3,"traceCount":2,"firstSeen":"2026-07-10 10:00:00.000000000","lastSeen":"2026-07-16 14:03:11.000000000","latestTraceId":"trace-1","latestSpanId":"span-1","latestTimestamp":"2026-07-16 14:03:11.000000000"}"#;

const OCCURRENCE_ROW: &str = r#"{"timestampRank":1,"fingerprint":"fp-1","timestamp":"2026-07-16 14:03:11.000000000","serviceName":"api","traceId":"trace-1","spanId":"span-1","body":"TypeError: boom","exceptionType":"TypeError","exceptionMessage":"boom","exceptionStacktrace":"at boom (app.ts:1)","resourceAttributes":{"service.version":"1.2.3"},"logAttributes":{},"scopeAttributes":{}}"#;

#[test]
fn local_errors_list_renders_table_from_collector_sql() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    // The list runs one summary query, filtered by service and paged, and the
    // shared fingerprint hash is inlined into it.
    let mock = server
        .mock("POST", "/sql")
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex("GROUP BY fingerprint".into()),
            Matcher::Regex(r"ServiceName IN \('api'\)".into()),
            Matcher::Regex("cityHash64".into()),
            Matcher::Regex("LIMIT 5".into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body(format!("{SUMMARY_ROW}\n"))
        .create();

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", server.url())
        .args([
            "local",
            "errors",
            "list",
            "--service",
            "api",
            "--limit",
            "5",
        ])
        .assert()
        .success()
        .stdout(contains("OCCURRENCES"))
        .stdout(contains("FINGERPRINT"))
        .stdout(contains("fp-1"))
        .stdout(contains("TypeError: boom"))
        .stdout(contains("3"));

    mock.assert();
}

#[test]
fn local_errors_list_reports_empty_range() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    let mock = server
        .mock("POST", "/sql")
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body("")
        .create();

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", server.url())
        .args(["local", "errors", "list"])
        .assert()
        .success()
        .stdout(predicate::str::diff("No Errors in this time range.\n"));

    mock.assert();
}

#[test]
fn local_errors_show_renders_detail_with_raw_trace_ids() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    // show runs two queries: the one-row summary, then the ranked Occurrences.
    let summary = server
        .mock("POST", "/sql")
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex("GROUP BY fingerprint".into()),
            Matcher::Regex(r"WHERE fingerprint = 'fp-1'".into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body(format!("{SUMMARY_ROW}\n"))
        .create();
    let occurrences = server
        .mock("POST", "/sql")
        .match_body(Matcher::Regex("ranked_occurrence_rows".into()))
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body(format!("{OCCURRENCE_ROW}\n"))
        .create();

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", server.url())
        .args(["local", "errors", "show", "fp-1"])
        .assert()
        .success()
        .stdout(contains("TypeError: boom"))
        .stdout(contains("Services     api"))
        .stdout(contains("Occurrences  3 across 2 traces"))
        .stdout(contains("at boom (app.ts:1)"))
        .stdout(contains("Occurrences (1 of 3)"))
        // Local telemetry has no web UI: no "Web" line, raw trace id, no URL.
        .stdout(contains("Web").not())
        .stdout(contains("trace-1"));

    summary.assert();
    occurrences.assert();
}

#[test]
fn local_errors_show_surfaces_not_found() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    let mock = server
        .mock("POST", "/sql")
        .match_body(Matcher::Regex("GROUP BY fingerprint".into()))
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body("")
        .create();

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", server.url())
        .args(["local", "errors", "show", "fp-missing"])
        .assert()
        .failure()
        .stderr(contains("No Error with Fingerprint fp-missing"));

    mock.assert();
}
