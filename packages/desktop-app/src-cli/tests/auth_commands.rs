mod support;

use mockito::{Matcher, Server};
use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn auth_login_rejects_removed_token_flag() {
    let env = CliTestEnv::new();

    env.command()
        .args(["login", "--token", "token-123"])
        .assert()
        .failure()
        .stderr(contains("unexpected argument '--token'"));
}

#[test]
fn auth_logout_removes_existing_session() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "token-123");

    env.command()
        .args(["logout"])
        .assert()
        .success()
        .stdout(contains("Logged out."));

    assert!(!env.session_path().exists());
}

#[test]
fn auth_logout_without_session_is_idempotent() {
    let env = CliTestEnv::new();

    env.command()
        .args(["logout"])
        .assert()
        .success()
        .stdout(contains("No active session."));
}

#[test]
fn mismatched_saved_session_is_rejected_without_clearing() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "token-123");

    env.command()
        .args(["status"])
        .assert()
        .failure()
        .stderr(contains("no active session; run `everr login`"));

    assert!(env.session_path().exists());
}

#[test]
fn expired_session_prompts_reauthentication_without_clearing_saved_session() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    env.write_session(&server.url(), "expired-token");

    let mock = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer expired-token")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("limit".into(), "20".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(401)
        .with_header("content-type", "application/json")
        .with_body(r#"{"error":"expired"}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .args(["runs"])
        .assert()
        .failure()
        .stderr(contains(
            "Session expired. Run `everr login` to re-authenticate.",
        ));

    mock.assert();
    assert!(env.session_path().exists());
}
