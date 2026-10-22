mod support;

use mockito::Server;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn cloud_status_reports_current_identity_without_exposing_or_changing_the_session() {
    for endpoint in [None, Some("https://ingest.example.test")] {
        let env = CliTestEnv::new();
        let mut server = Server::new();
        env.write_session(&server.url(), "private-session-token");
        let saved = std::fs::read(env.session_path()).unwrap();
        let mut identity = serde_json::json!({
            "name": "Ada Lovelace", "email": "ada@example.com", "organizationName": "Acme"
        });
        if let Some(endpoint) = endpoint {
            identity["userId"] = "ada".into();
            identity["organizationId"] = "org-acme".into();
            identity["ingestEndpoint"] = endpoint.into();
        }
        let mock = server
            .mock("GET", "/api/cli/me")
            .match_header("authorization", "Bearer private-session-token")
            .with_header("content-type", "application/json")
            .with_body(identity.to_string())
            .expect(2)
            .create();

        env.command()
            .args(["cloud", "status"])
            .assert()
            .success()
            .stdout(format!(
                "Name: Ada Lovelace\nEmail: ada@example.com\nOrganization: Acme\nInstallation: {}\nIngestion endpoint: {}\n",
                server.url(),
                endpoint.unwrap_or("not configured or unavailable on this server")
            ))
            .stderr(contains("private-session-token").not());
        let output = env
            .command()
            .args(["cloud", "status", "--json"])
            .assert()
            .success()
            .stderr(contains("private-session-token").not())
            .get_output()
            .stdout
            .clone();
        identity["url"] = server.url().into();
        identity["ingestEndpoint"] = serde_json::json!(endpoint);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&output).unwrap(),
            identity
        );
        mock.assert();
        assert_eq!(std::fs::read(env.session_path()).unwrap(), saved);
    }
}

#[test]
fn cloud_status_requires_a_session_for_the_current_cloud() {
    let env = CliTestEnv::new();
    env.command()
        .args(["cloud", "status"])
        .assert()
        .code(1)
        .stdout("")
        .stderr(contains("No active session. Run `everr cloud login`"));
    assert!(!env.session_path().exists());
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

fn mock_login(
    server: &mut mockito::ServerGuard,
    identity: serde_json::Value,
    status: usize,
) -> Vec<mockito::Mock> {
    vec![
        server
            .mock("POST", "/api/auth/device/code")
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "device_code": "device-secret", "user_code": "CODE",
                    "verification_uri": format!("{}/device", server.url()),
                    "expires_in": 60, "interval": 0
                })
                .to_string(),
            )
            .create(),
        server
            .mock("POST", "/api/auth/device/token")
            .with_status(status)
            .with_header("content-type", "application/json")
            .with_body(if status == 200 {
                r#"{"access_token":"new-token"}"#
            } else {
                r#"{"error":"access_denied"}"#
            })
            .create(),
        server
            .mock("GET", "/api/cli/me")
            .with_body(identity.to_string())
            .expect(if status == 200 { 1 } else { 0 })
            .create(),
    ]
}

#[test]
fn login_replaces_the_single_session_without_creating_repository_configuration() {
    for legacy_server in [false, true] {
        let env = CliTestEnv::new();
        let root = env.home_dir.join("repo");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        env.write_session("https://old.example.test", "old-token");
        let mut server = Server::new();
        let identity = if legacy_server {
            serde_json::json!({ "name": "Alice", "email": "alice@example.test", "organizationName": "Acme" })
        } else {
            serde_json::json!({ "name": "Alice", "email": "alice@example.test", "userId": "alice", "organizationName": "Acme", "organizationId": "org-acme", "ingestEndpoint": "https://ingest.example.test" })
        };
        let requests = mock_login(&mut server, identity, 200);
        let mut cmd = env.command();
        cmd.current_dir(&root)
            .args(["cloud", "login", "--url", &server.url(), "--no-open"]);
        cmd.assert()
            .success()
            .stdout(contains("Logged in as alice@example.test"));
        for request in requests {
            request.assert();
        }
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(env.session_path()).unwrap()).unwrap();
        assert_eq!(
            saved,
            serde_json::json!({ "session": { "api_base_url": server.url(), "token": "new-token" } })
        );
        assert!(!root.join(".everr").exists());
    }
}

#[test]
fn failed_login_uses_the_saved_url_and_preserves_the_previous_session() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    env.write_session(&server.url(), "old-token");
    let saved = std::fs::read(env.session_path()).unwrap();
    let requests = mock_login(&mut server, serde_json::json!({}), 400);
    env.command()
        .args(["cloud", "login", "--no-open"])
        .assert()
        .failure();
    for request in requests {
        request.assert();
    }
    assert_eq!(std::fs::read(env.session_path()).unwrap(), saved);
}

#[test]
fn logout_revokes_and_removes_the_single_session() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    env.write_session(&server.url(), "old-token");
    let revoke = server
        .mock("POST", "/api/auth/sign-out")
        .match_header("authorization", "Bearer old-token")
        .create();
    env.command()
        .args(["cloud", "logout"])
        .assert()
        .success()
        .stdout(contains("Logged out."));
    revoke.assert();
    assert!(!env.session_path().exists());
    env.command()
        .args(["cloud", "logout"])
        .assert()
        .success()
        .stdout(contains("No active session."));
}

#[test]
fn apply_uses_an_explicit_api_key_url_without_a_saved_session() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    std::fs::write(env.home_dir.join("everr.yaml"), "repoid: test-repo\n").unwrap();
    let plan = server
        .mock("POST", "/api/apply")
        .match_header("authorization", "Bearer api-key")
        .with_body(r#"{"dryRun":true,"results":[],"organization":{"id":"org-test","name":"Test"}}"#)
        .create();
    env.command()
        .env("EVERR_API_KEY", "api-key")
        .env("EVERR_API_URL", server.url())
        .args(["apply", ".", "--dry-run"])
        .assert()
        .success();
    plan.assert();
    assert!(!env.session_path().exists());
}

#[test]
fn remote_commands_use_the_saved_api_url_including_its_path_prefix() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    let mut other = Server::new();
    let url = format!("{}/everr", server.url());
    env.write_session(&url, "saved-token");
    let unexpected_get = other.mock("GET", mockito::Matcher::Any).expect(0).create();
    let unexpected_post = other.mock("POST", mockito::Matcher::Any).expect(0).create();
    let me = server
        .mock("GET", "/everr/api/cli/me")
        .match_header("authorization", "Bearer saved-token")
        .with_body(r#"{"name":"Alice","email":"alice@example.test","organizationName":"Acme"}"#)
        .expect(1)
        .create();
    let resources = server
        .mock("GET", "/everr/api/cli/resources")
        .match_query(mockito::Matcher::Any)
        .match_header("authorization", "Bearer saved-token")
        .with_body("[]")
        .create();
    let sql = server
        .mock("POST", "/everr/api/cli/sql")
        .match_header("authorization", "Bearer saved-token")
        .with_body("{\"value\":1}\n")
        .expect(1)
        .create();
    let ci = server.mock("GET", "/everr/api/cli/runs/status")
        .match_query(mockito::Matcher::Any)
        .match_header("authorization", "Bearer saved-token")
        .with_body(r#"{"repo":"test/repo","branch":"main","commit":"abc","state":"completed","active":[],"completed":[]}"#).create();
    for args in [
        vec!["cloud", "status", "--json"],
        vec!["resources", "list"],
        vec!["cloud", "query", "SELECT 1"],
        vec!["ci", "status", "--run-id", "42", "--repo", "test/repo"],
    ] {
        env.command_with_api_base_url(&other.url())
            .args(args)
            .assert()
            .success();
    }
    let resource_dir = env.home_dir.join("resources");
    std::fs::create_dir(&resource_dir).unwrap();
    std::fs::write(resource_dir.join("everr.yaml"), "repoid: test-repo\n").unwrap();
    for api_key in [false, true] {
        let apply = server
            .mock("POST", "/everr/api/apply")
            .match_header(
                "authorization",
                if api_key {
                    "Bearer api-key"
                } else {
                    "Bearer saved-token"
                },
            )
            .with_body(
                r#"{"dryRun":true,"results":[],"organization":{"id":"org-test","name":"Test"}}"#,
            )
            .create();
        let mut cmd = env.command_with_api_base_url(&other.url());
        if api_key {
            cmd.env("EVERR_API_KEY", "api-key");
        }
        cmd.current_dir(&resource_dir)
            .args(["apply", ".", "--dry-run"])
            .assert()
            .success();
        apply.assert();
    }
    for request in [me, resources, sql, ci, unexpected_get, unexpected_post] {
        request.assert();
    }
}
