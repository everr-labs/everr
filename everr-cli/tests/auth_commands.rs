mod support;

use std::fs;

use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn auth_login_with_flags_persists_session_file() {
    let env = CliTestEnv::new();

    env.command()
        .args([
            "auth",
            "login",
            "--api-base-url",
            "https://dev.everr.test",
            "--token",
            "token-123",
        ])
        .assert()
        .success()
        .stdout(contains("Logged in. Session saved at"));

    let session_path = env.session_path();
    let raw = fs::read_to_string(session_path).expect("session file should exist");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("session should be json");

    assert_eq!(parsed["api_base_url"], "https://dev.everr.test");
    assert_eq!(parsed["token"], "token-123");
}

#[test]
fn auth_logout_removes_existing_session() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "token-123");

    env.command()
        .args(["auth", "logout"])
        .assert()
        .success()
        .stdout(contains("Logged out."));

    assert!(!env.session_path().exists());
}

#[test]
fn auth_logout_without_session_is_idempotent() {
    let env = CliTestEnv::new();

    env.command()
        .args(["auth", "logout"])
        .assert()
        .success()
        .stdout(contains("No active session."));
}
