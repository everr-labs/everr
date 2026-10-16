mod support;

use mockito::Server;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn cloud_status_reports_current_identity_without_exposing_or_changing_the_session() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    env.write_profile_session(&server.url(), "private-session-token");
    let saved = std::fs::read(env.profile_store().credentials_path()).unwrap();
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
    assert_eq!(
        std::fs::read(env.profile_store().credentials_path()).unwrap(),
        saved
    );
}

#[test]
fn cloud_status_requires_a_session_for_the_current_cloud() {
    let env = CliTestEnv::new();
    env.command()
        .args(["cloud", "status"])
        .assert()
        .code(1)
        .stdout("")
        .stderr(contains(
            "No authenticated profile for this target. Run `everr login`",
        ));
    assert!(!env.profile_store().credentials_path().exists());

    env.write_profile_session("https://other.example.com", "private-session-token");
    let session = env.profile_store().session("default").unwrap().unwrap();
    env.profile_store()
        .clear_session("default", &session)
        .unwrap();
    let saved = std::fs::read(env.profile_store().credentials_path()).unwrap();
    env.command()
        .args(["cloud", "status", "--profile", "default"])
        .assert()
        .code(1)
        .stdout("")
        .stderr(contains(
            "Profile 'default' is logged out. Run `everr login --profile default`",
        ));
    assert_eq!(
        std::fs::read(env.profile_store().credentials_path()).unwrap(),
        saved
    );
}

#[test]
fn cloud_status_propagates_api_errors_and_preserves_the_session() {
    for (status, body, message) in [
        (
            401,
            r#"{"error":"expired"}"#,
            "Session expired. Run `everr login --profile default` to re-authenticate.",
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
        env.write_profile_session(&server.url(), "private-session-token");
        let saved = std::fs::read(env.profile_store().credentials_path()).unwrap();
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
        assert_eq!(
            std::fs::read(env.profile_store().credentials_path()).unwrap(),
            saved
        );
    }
}

#[test]
fn cloud_status_reports_transport_failure_without_changing_the_session() {
    let env = CliTestEnv::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    env.write_profile_session(&origin, "private-session-token");
    let saved = std::fs::read(env.profile_store().credentials_path()).unwrap();
    env.command_with_api_base_url(&origin)
        .args(["cloud", "status"])
        .assert()
        .code(1)
        .stdout("")
        .stderr(contains("request failed"))
        .stderr(contains("private-session-token").not());
    assert_eq!(
        std::fs::read(env.profile_store().credentials_path()).unwrap(),
        saved
    );
}
