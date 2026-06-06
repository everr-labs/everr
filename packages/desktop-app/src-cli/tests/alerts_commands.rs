mod support;

use std::path::PathBuf;

use mockito::Matcher;
use predicates::prelude::*;
use predicates::str::contains;
use serde_json::Value;
use support::{CliTestEnv, mock_api_server, parse_stdout_json};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("alerts")
        .join(name)
}

#[test]
fn alerts_test_posts_yaml_to_cloud_endpoint_by_default() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-alerts");

    let mock = server
        .mock("POST", "/api/cli/alerts/test")
        .match_header("authorization", "Bearer token-alerts")
        .match_header("content-type", Matcher::Regex("^application/json(;.*)?$".into()))
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex(r#""rawYaml":"#.into()),
            Matcher::Regex("high-5xx-routes".into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            r#"{"filters":{"target":"cloud"},"alerts":[{"service":"api","name":"high-5xx-routes","severity":"critical","routing":"admins","firing":true,"rowCount":1,"evidence":[{"route":"/api"}],"truncated":false}]}"#,
        )
        .create();

    let output = env
        .command_with_api_base_url(&server.url())
        .args([
            "alerts",
            "test",
            fixture_path("valid-alerts.yaml").to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(contains(r#""target": "cloud""#))
        .stdout(contains(r#""name": "high-5xx-routes""#))
        .get_output()
        .stdout
        .clone();

    let json = parse_stdout_json(&output);
    assert_eq!(
        json["filters"]["target"],
        Value::String("cloud".to_string())
    );
    mock.assert();
}

#[test]
fn alerts_upload_posts_yaml_source_url_and_git_metadata() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/alerts",
        "git@github.com:everr-labs/everr.git",
    );
    let source_path = repo_dir.join("alerts.yaml");
    std::fs::copy(fixture_path("valid-alerts.yaml"), &source_path).expect("copy alert fixture");
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-upload");

    let mock = server
        .mock("POST", "/api/cli/alerts/upload")
        .match_header("authorization", "Bearer token-upload")
        .match_header("content-type", Matcher::Regex("^application/json(;.*)?$".into()))
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex(r#""rawYaml":"#.into()),
            Matcher::Regex(r#""sourceUrl":"https://github.com/everr-labs/everr/blob/feature/alerts/alerts.yaml""#.into()),
            Matcher::Regex(r#""repo":"everr-labs/everr""#.into()),
            Matcher::Regex(r#""branch":"feature/alerts""#.into()),
            Matcher::Regex(r#""path":"alerts.yaml""#.into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            r#"{"uploaded":[{"service":"api","name":"high-5xx-routes"}],"deactivated":[],"sourceUrl":"https://github.com/everr-labs/everr/blob/feature/alerts/alerts.yaml"}"#,
        )
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args([
            "alerts",
            "upload",
            source_path.to_str().unwrap(),
            "--source-url",
            "https://github.com/everr-labs/everr/blob/feature/alerts/alerts.yaml",
        ])
        .assert()
        .success()
        .stdout(contains(
            r#""sourceUrl": "https://github.com/everr-labs/everr/blob/feature/alerts/alerts.yaml""#,
        ));

    mock.assert();
}

#[test]
fn alerts_test_local_runs_query_against_local_sql_endpoint() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    let mock = server
        .mock("POST", "/sql")
        .match_header("content-type", Matcher::Regex("^text/plain(;.*)?$".into()))
        .match_body(Matcher::AllOf(vec![
            Matcher::Regex("INTERVAL 5 MINUTE".into()),
            Matcher::Regex("ServiceName = 'api'".into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body("{\"route\":\"/api\",\"error_count\":12}\n")
        .create();

    let output = env
        .command()
        .env("EVERR_SQL_HTTP_ORIGIN", server.url())
        .args([
            "alerts",
            "test",
            fixture_path("valid-alerts.yaml").to_str().unwrap(),
            "--local",
        ])
        .assert()
        .success()
        .stdout(contains(r#""target": "local""#))
        .stdout(contains(r#""firing": true"#))
        .get_output()
        .stdout
        .clone();

    let json = parse_stdout_json(&output);
    assert_eq!(
        json["filters"]["target"],
        Value::String("local".to_string())
    );
    assert_eq!(json["alerts"][0]["rowCount"], Value::Number(1.into()));
    assert_eq!(
        json["alerts"][0]["evidence"][0]["route"],
        Value::String("/api".to_string())
    );
    mock.assert();
}

#[test]
fn alerts_test_local_rejects_invalid_yaml() {
    let env = CliTestEnv::new();

    env.command()
        .args([
            "alerts",
            "test",
            fixture_path("invalid-alerts.yaml").to_str().unwrap(),
            "--local",
        ])
        .assert()
        .failure()
        .stderr(
            predicate::str::contains("severity").or(predicate::str::contains("evaluationInterval")),
        );
}
