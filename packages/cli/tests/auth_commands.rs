mod support;

use mockito::{Matcher, Server};
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn cloud_status_reports_current_identity_without_exposing_or_changing_the_session() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    env.write_session(&server.url(), "private-session-token");
    let saved = std::fs::read(env.session_path()).unwrap();
    let mock = server
        .mock("GET", "/api/cli/me")
        .match_header("authorization", "Bearer private-session-token")
        .with_header("content-type", "application/json")
        .with_body(r#"{"name":"Ada Lovelace","email":"ada@example.com","organizationName":"Acme"}"#)
        .expect(1)
        .create();

    env.command_with_api_base_url(&server.url())
        .args(["cloud", "status"])
        .assert()
        .success()
        .stdout(format!(
            "Name: Ada Lovelace\nEmail: ada@example.com\nOrganization: Acme\nCloud: {}\n",
            server.url()
        ))
        .stderr(contains("private-session-token").not());
    mock.assert();
    assert_eq!(std::fs::read(env.session_path()).unwrap(), saved);
}

#[test]
fn cloud_status_requires_a_session_for_the_current_cloud() {
    let env = CliTestEnv::new();
    env.command()
        .args(["cloud", "status"])
        .assert()
        .code(1)
        .stdout("")
        .stderr(contains("no active session; run `everr cloud login`"));
    assert!(!env.session_path().exists());

    env.write_session("https://other.example.com", "private-session-token");
    let saved = std::fs::read(env.session_path()).unwrap();
    env.command_with_api_base_url("http://localhost:5173")
        .args(["cloud", "status"])
        .assert()
        .code(1)
        .stdout("")
        .stderr(contains("no active session; run `everr cloud login`"));
    assert_eq!(std::fs::read(env.session_path()).unwrap(), saved);
}

#[test]
fn cloud_status_propagates_api_errors_and_preserves_the_session() {
    for (status, body, message) in [
        (
            401,
            r#"{"error":"expired"}"#,
            "Session expired. Run `everr cloud login` to re-authenticate.",
        ),
        (
            500,
            r#"{"error":"service unavailable"}"#,
            "service unavailable",
        ),
        (200, r#"{"email":"ada@example.com"}"#, "decode"),
    ] {
        let env = CliTestEnv::new();
        let mut server = Server::new();
        env.write_session(&server.url(), "private-session-token");
        let saved = std::fs::read(env.session_path()).unwrap();
        let mock = server
            .mock("GET", "/api/cli/me")
            .match_header("authorization", "Bearer private-session-token")
            .with_status(status)
            .with_header("content-type", "application/json")
            .with_body(body)
            .create();
        env.command_with_api_base_url(&server.url())
            .args(["cloud", "status"])
            .assert()
            .code(1)
            .stdout("")
            .stderr(contains(message))
            .stderr(contains("private-session-token").not());
        mock.assert();
        assert_eq!(std::fs::read(env.session_path()).unwrap(), saved);
    }
}

#[test]
fn cloud_status_reports_transport_failure_without_changing_the_session() {
    let env = CliTestEnv::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    env.write_session(&origin, "private-session-token");
    let saved = std::fs::read(env.session_path()).unwrap();
    env.command_with_api_base_url(&origin)
        .args(["cloud", "status"])
        .assert()
        .code(1)
        .stdout("")
        .stderr(contains("request failed"))
        .stderr(contains("private-session-token").not());
    assert_eq!(std::fs::read(env.session_path()).unwrap(), saved);
}

#[test]
fn auth_login_rejects_removed_token_flag() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "login", "--token", "token-123"])
        .assert()
        .failure()
        .stderr(contains("unexpected argument '--token'"));
}

#[test]
fn auth_logout_removes_existing_session() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "token-123");

    env.command()
        .args(["cloud", "logout"])
        .assert()
        .success()
        .stdout(contains("Logged out."));

    assert!(!env.session_path().exists());
}

#[test]
fn auth_logout_without_session_is_idempotent() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "logout"])
        .assert()
        .success()
        .stdout(contains("No active session."));
}

#[test]
fn mismatched_saved_session_is_rejected_without_clearing() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "token-123");

    env.command()
        .args(["ci", "status"])
        .assert()
        .failure()
        .stderr(contains("no active session; run `everr cloud login`"));

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
        .args(["ci", "runs"])
        .assert()
        .failure()
        .stderr(contains(
            "Session expired. Run `everr cloud login` to re-authenticate.",
        ));

    mock.assert();
    assert!(env.session_path().exists());
}
