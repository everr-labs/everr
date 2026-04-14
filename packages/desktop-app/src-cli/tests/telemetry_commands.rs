mod support;

use std::path::PathBuf;

use predicates::prelude::*;

fn fixture_arg() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/telemetry")
}

#[test]
fn telemetry_traces_json_contains_meta_and_rows() {
    let env = support::CliTestEnv::new();
    let output = env
        .command()
        .args([
            "telemetry",
            "traces",
            "--telemetry-dir",
            fixture_arg().to_str().unwrap(),
            "--from",
            "now-1000d",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let json = support::parse_stdout_json(&output);
    assert!(json.get("meta").is_some(), "expected meta key");
    assert!(json.get("rows").is_some(), "expected rows key");
    let rows = json["rows"].as_array().expect("rows is array");
    assert_eq!(rows.len(), 2);
}

#[test]
fn telemetry_logs_trace_id_filter_matches_fixture() {
    let env = support::CliTestEnv::new();
    env.command()
        .args([
            "telemetry",
            "logs",
            "--telemetry-dir",
            fixture_arg().to_str().unwrap(),
            "--from",
            "now-1000d",
            "--trace-id",
            "0102030405060708090a0b0c0d0e0f10",
        ])
        .assert()
        .success();
}

#[test]
fn telemetry_traces_missing_dir_shows_sibling_hint_or_fallback() {
    let env = support::CliTestEnv::new();
    env.command()
        .args([
            "telemetry",
            "traces",
            "--telemetry-dir",
            env.home_dir.join("definitely-not-a-dir").to_str().unwrap(),
        ])
        .assert()
        .success()
        .stderr(predicate::str::contains("No telemetry"));
}

#[test]
fn telemetry_ai_instructions_prints_full_guidance() {
    let env = support::CliTestEnv::new();
    env.command()
        .args(["telemetry", "ai-instructions"])
        .assert()
        .success()
        .stdout(predicate::str::contains("everr telemetry traces"))
        .stdout(predicate::str::contains("everr telemetry logs"))
        .stdout(predicate::str::contains("Investigation playbook:"))
        .stdout(predicate::str::contains("After modifying instrumented code"));
}
