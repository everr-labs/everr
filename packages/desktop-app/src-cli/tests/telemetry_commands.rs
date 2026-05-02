mod support;

use predicates::str::{contains, diff};
use support::CliTestEnv;

#[test]
fn endpoint_prints_only_collector_url() {
    let env = CliTestEnv::new();
    let collector_url = format!("{}\n", everr_core::build::otlp_http_origin());

    env.command()
        .args(["telemetry", "endpoint"])
        .assert()
        .success()
        .stdout(diff(collector_url))
        .stderr(diff(""));
}

#[test]
fn query_connection_error_mentions_start_command() {
    let env = CliTestEnv::new();

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", "http://127.0.0.1:9")
        .args(["telemetry", "query", "SHOW TABLES"])
        .assert()
        .code(2)
        .stderr(contains("everr telemetry start"))
        .stderr(contains("Everr Desktop"));
}
