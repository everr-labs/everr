mod support;

use std::fs;

use mockito::Matcher;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::{contains, diff};
use serde_json::json;
use support::{CliTestEnv, mock_api_server};

#[test]
fn cached_update_prints_notice_without_network() {
    let env = CliTestEnv::new();
    write_cache(&env, "2099.1.0", true, "2099-01-01T00:00:00Z");

    env.command()
        .args(["skills", "list"])
        .assert()
        .success()
        .stdout(contains("A new version is available: 2099.1.0"));
}

#[test]
fn stale_cache_fetches_release_metadata_and_records_update() {
    let env = CliTestEnv::new();
    write_cache(&env, "0.0.1", false, "2000-01-01T00:00:00Z");
    let mut server = mock_api_server();
    let mock = server
        .mock("GET", "/everr-app/release-metadata.json")
        .match_query(Matcher::Missing)
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"version":"2099.1.0"}"#)
        .expect(1)
        .create();

    env.command_with_release_metadata_url(&format!(
        "{}/everr-app/release-metadata.json",
        server.url()
    ))
    .args(["skills", "list"])
    .assert()
    .success()
    .stdout(contains("A new version is available: 2099.1.0"));

    mock.assert();
    let cache = fs::read_to_string(env.update_cache_path()).expect("read cache");
    let cache: serde_json::Value = serde_json::from_str(&cache).expect("parse cache");
    assert_eq!(cache["latest_version"], "2099.1.0");
    assert_eq!(cache["update_available"], true);
}

#[test]
fn cached_update_continues_to_print_before_next_check_interval() {
    let env = CliTestEnv::new();
    write_cache(&env, "2099.1.0", true, "2099-01-01T00:00:00Z");

    env.command()
        .args(["skills", "list"])
        .assert()
        .success()
        .stdout(contains("A new version is available: 2099.1.0"));
}

#[test]
fn cached_current_version_does_not_print_notice() {
    let env = CliTestEnv::new();
    write_cache(&env, env!("EVERR_VERSION"), true, "2099-01-01T00:00:00Z");

    env.command()
        .args(["skills", "list"])
        .assert()
        .success()
        .stdout(predicates::str::contains("A new version is available").not());
}

#[test]
fn wrap_stdout_is_not_prefixed_by_update_notice() {
    let env = CliTestEnv::new();
    write_cache(&env, "2099.1.0", true, "2099-01-01T00:00:00Z");

    env.command()
        .args(["wrap", "--", "sh", "-c", "printf 'child stdout\\n'"])
        .env("EVERR_OTLP_HTTP_ORIGIN", "http://127.0.0.1:9")
        .assert()
        .code(2)
        .stdout(diff(""));
}

#[test]
fn version_flag_remains_available_without_notice() {
    let env = CliTestEnv::new();
    write_cache(&env, "2099.1.0", true, "2099-01-01T00:00:00Z");

    env.command()
        .arg("--version")
        .assert()
        .success()
        .stdout(contains("everr"))
        .stdout(predicates::str::contains("A new version is available").not());
}

fn write_cache(
    env: &CliTestEnv,
    latest_version: &str,
    update_available: bool,
    last_checked_at: &str,
) {
    let path = env.update_cache_path();
    fs::create_dir_all(path.parent().expect("cache parent")).expect("create cache parent");
    fs::write(
        path,
        serde_json::to_string_pretty(&json!({
            "last_checked_at": last_checked_at,
            "latest_version": latest_version,
            "update_available": update_available,
        }))
        .expect("serialize cache"),
    )
    .expect("write cache");
}
