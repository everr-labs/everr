mod support;

use everr_cli::profiles::{Profile, Project, Target};
use everr_cli::state::Session;
use mockito::{Matcher, Server};
use predicates::str::contains;
use support::CliTestEnv;

fn save(env: &CliTestEnv, name: &str, url: &str, organization: &str, user: &str) {
    env.profile_store()
        .save(
            name,
            Profile {
                target: Target {
                    url: url.to_owned(),
                    organization_id: organization.to_owned(),
                },
                user_id: user.to_owned(),
                email: format!("{user}@example.test"),
                organization_name: organization.to_owned(),
            },
            Session {
                api_base_url: url.to_owned(),
                token: format!("token-{name}"),
            },
        )
        .unwrap();
}

fn project(env: &CliTestEnv, url: &str, organization: &str) -> std::path::PathBuf {
    let root = env.home_dir.join("project");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::create_dir_all(root.join(".everr")).unwrap();
    std::fs::write(
        root.join(".everr/config.yaml"),
        format!("version: 1\nurl: {url}\norganizationId: {organization}\n"),
    )
    .unwrap();
    root
}

fn login_server(
    server: &mut mockito::ServerGuard,
    organization: &str,
    user: &str,
    status: usize,
) -> Vec<mockito::Mock> {
    vec![
        server.mock("POST", "/api/auth/device/code").with_status(200).with_header("content-type", "application/json")
            .with_body(serde_json::json!({"device_code":"device-secret", "user_code":"CODE", "verification_uri_complete":format!("{}/device?user_code=CODE", server.url()), "verification_uri":format!("{}/device", server.url()), "expires_in":60,"interval":0}).to_string()).create(),
        server.mock("POST", "/api/auth/device/token").with_status(status).with_header("content-type", "application/json")
            .with_body(if status == 200 { r#"{"access_token":"new-token"}"# } else { r#"{"error":"access_denied"}"# }).create(),
        server.mock("GET", "/api/cli/me").with_status(200).with_header("content-type", "application/json")
            .with_body(serde_json::json!({"organizationId":organization,"organizationName":organization,"userId":user,"email":format!("{user}@example.test"),"name":user}).to_string())
            .expect(if status == 200 {1} else {0}).create(),
    ]
}

#[test]
fn login_from_subdirectory_creates_project_target_and_global_profile_after_authentication() {
    let env = CliTestEnv::new();
    let root = env.home_dir.join("repo");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    let nested = root.join("packages/service");
    std::fs::create_dir_all(&nested).unwrap();
    let mut server = Server::new();
    let requests = login_server(&mut server, "org-acme", "alice", 200);
    env.command()
        .current_dir(&nested)
        .args([
            "login",
            "--profile",
            "acme",
            "--url",
            &server.url(),
            "--organization-id",
            "org-acme",
            "--no-open",
        ])
        .assert()
        .success()
        .stdout(contains("Profile: acme"))
        .stdout(contains("organization_id=org-acme"));
    for request in requests {
        request.assert();
    }
    assert_eq!(
        Project::discover(&nested).unwrap().target.unwrap(),
        Target {
            url: server.url(),
            organization_id: "org-acme".into()
        }
    );
    assert!(!nested.join(".everr").exists());
    let saved = env.profile_store().load().unwrap();
    assert_eq!(saved.profiles["acme"].user_id, "alice");
    assert_eq!(
        env.profile_store().session("acme").unwrap().unwrap().token,
        "new-token"
    );
    let identity = server.mock("GET", "/api/cli/me")
        .match_header("authorization", "Bearer new-token")
        .match_header("x-everr-organization-id", "org-acme")
        .with_body(r#"{"userId":"alice","email":"alice@example.test","name":"Alice","organizationId":"org-acme","organizationName":"Acme","ingestEndpoint":"https://telemetry.example.test"}"#)
        .create();
    let output = env
        .command()
        .current_dir(&nested)
        .args(["whoami", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let connection: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(connection["profile"], "acme");
    assert_eq!(connection["selectionSource"], "project configuration");
    assert_eq!(connection["url"], server.url());
    assert_eq!(connection["organizationId"], "org-acme");
    assert_eq!(
        connection["ingestEndpoint"],
        "https://telemetry.example.test"
    );
    assert!(!String::from_utf8(output).unwrap().contains("new-token"));
    identity.assert();
    let resources = server
        .mock("GET", "/api/cli/resources")
        .match_query(Matcher::Any)
        .match_header("authorization", "Bearer new-token")
        .match_header("x-everr-organization-id", "org-acme")
        .with_body("[]")
        .create();
    env.command()
        .current_dir(&nested)
        .args(["resources", "list"])
        .assert()
        .success();
    resources.assert();
}

#[test]
fn denied_login_leaves_no_project_configuration_or_credentials() {
    let env = CliTestEnv::new();
    let root = env.home_dir.join("repo");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    let mut server = Server::new();
    let requests = login_server(&mut server, "org-acme", "alice", 400);
    env.command()
        .current_dir(&root)
        .args([
            "login",
            "--profile",
            "acme",
            "--url",
            &server.url(),
            "--no-open",
        ])
        .assert()
        .failure();
    for request in requests {
        request.assert();
    }
    assert!(!root.join(".everr").exists());
    assert!(env.profile_store().load().unwrap().profiles.is_empty());
    assert!(env.profile_store().session("acme").unwrap().is_none());
}

#[test]
fn login_rejects_wrong_organizations_pinned_by_project_or_flag_without_changing_configuration() {
    for existing_project in [true, false] {
        let env = CliTestEnv::new();
        let mut server = Server::new();
        let root = if existing_project {
            project(&env, &server.url(), "org-expected")
        } else {
            let root = env.home_dir.join("project");
            std::fs::create_dir_all(root.join(".git")).unwrap();
            root
        };
        let requests = login_server(&mut server, "org-wrong", "alice", 200);
        let revoke = server
            .mock("POST", "/api/auth/sign-out")
            .match_header("authorization", "Bearer new-token")
            .with_body("{}")
            .create();
        let mut command = env.command();
        command.current_dir(&root).args(["login", "--no-open"]);
        if !existing_project {
            command.args(["--url", &server.url(), "--organization-id", "org-expected"]);
        }
        command
            .assert()
            .failure()
            .stderr(contains("approved organization differs"));
        for request in requests {
            request.assert();
        }
        revoke.assert();
        let discovered = Project::discover(&root).unwrap().target;
        if existing_project {
            assert_eq!(discovered.unwrap().organization_id, "org-expected");
            env.command()
                .current_dir(&root)
                .args(["login", "--organization-id", "org-other", "--no-open"])
                .assert()
                .failure()
                .stderr(contains("requested organization differs"));
        } else {
            assert!(discovered.is_none());
        }
        assert!(env.profile_store().load().unwrap().profiles.is_empty());
    }
}

#[test]
fn explicit_login_creates_another_profile_without_overwriting_project_configuration() {
    let env = CliTestEnv::new();
    let root = project(&env, "https://original.example.test", "org-original");
    let mut server = Server::new();
    let requests = login_server(&mut server, "org-new", "alice", 200);
    env.command()
        .current_dir(&root)
        .args([
            "login",
            "--profile",
            "other",
            "--url",
            &server.url(),
            "--no-open",
        ])
        .assert()
        .success();
    for request in requests {
        request.assert();
    }
    assert_eq!(
        Project::discover(&root)
            .unwrap()
            .target
            .unwrap()
            .organization_id,
        "org-original"
    );
    assert_eq!(
        env.profile_store().load().unwrap().profiles["other"]
            .target
            .organization_id,
        "org-new"
    );
}

#[test]
fn project_selection_and_explicit_overrides_keep_organizations_and_installations_independent() {
    let env = CliTestEnv::new();
    let mut first = Server::new();
    let mut second = Server::new();
    save(&env, "personal", &first.url(), "org-personal", "alice");
    save(&env, "work", &first.url(), "org-work", "alice");
    save(&env, "staging", &second.url(), "org-work", "bob");
    let root = project(&env, &first.url(), "org-work");
    let personal = first
        .mock("GET", "/api/cli/resources")
        .match_query(Matcher::Any)
        .match_header("authorization", "Bearer token-personal")
        .match_header("x-everr-organization-id", "org-personal")
        .with_body("[]")
        .create();
    env.command().args(["resources", "list"]).assert().success();
    personal.assert();
    let work = first
        .mock("GET", "/api/cli/resources")
        .match_query(Matcher::Any)
        .match_header("authorization", "Bearer token-work")
        .match_header("x-everr-organization-id", "org-work")
        .with_body("[]")
        .expect(2)
        .create();
    env.command()
        .current_dir(&root)
        .args(["resources", "list"])
        .assert()
        .success();
    env.command()
        .env("EVERR_PROFILE", "work")
        .args(["resources", "list"])
        .assert()
        .success();
    work.assert();
    let staging = second
        .mock("GET", "/api/cli/resources")
        .match_query(Matcher::Any)
        .match_header("authorization", "Bearer token-staging")
        .match_header("x-everr-organization-id", "org-work")
        .with_body("[]")
        .create();
    env.command()
        .current_dir(&root)
        .env("EVERR_PROFILE", "personal")
        .args(["resources", "list", "--profile", "staging"])
        .assert()
        .success();
    staging.assert();
}

#[test]
fn missing_or_ambiguous_project_credentials_never_use_the_global_default() {
    let env = CliTestEnv::new();
    save(
        &env,
        "personal",
        "https://cloud.example.test",
        "org-personal",
        "alice",
    );
    let root = project(&env, "https://work.example.test", "org-work");
    env.command()
        .args(["--profile", "missing", "ci", "status"])
        .assert()
        .failure()
        .stderr(contains("Unknown profile 'missing'"));
    env.command()
        .current_dir(&root)
        .args(["resources", "list"])
        .assert()
        .failure()
        .stderr(contains("No authenticated profile"));
    save(
        &env,
        "work-alice",
        "https://work.example.test",
        "org-work",
        "alice",
    );
    save(
        &env,
        "work-bob",
        "https://work.example.test",
        "org-work",
        "bob",
    );
    env.command()
        .current_dir(&root)
        .args(["resources", "list"])
        .assert()
        .failure()
        .stderr(contains("Multiple profiles match"));
    assert_eq!(
        env.profile_store()
            .session("personal")
            .unwrap()
            .unwrap()
            .token,
        "token-personal"
    );
}

#[test]
fn profiles_are_inspectable_without_secrets_and_logout_only_revokes_the_selected_session() {
    let env = CliTestEnv::new();
    env.command()
        .args(["cloud", "logout"])
        .assert()
        .success()
        .stdout(contains("No active session."));
    let mut server = Server::new();
    save(&env, "work", &server.url(), "org-work", "alice");
    save(&env, "personal", &server.url(), "org-personal", "alice");
    let output = env
        .command()
        .args(["profiles", "list"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    assert!(!String::from_utf8(output).unwrap().contains("token-"));
    let output = env
        .command()
        .args(["profiles", "show", "work"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    assert!(!String::from_utf8(output).unwrap().contains("token-"));
    let revoke = server
        .mock("POST", "/api/auth/sign-out")
        .match_header("authorization", "Bearer token-work")
        .with_body("{}")
        .create();
    env.command()
        .args(["logout", "--profile", "work"])
        .assert()
        .success();
    revoke.assert();
    assert!(env.profile_store().session("work").unwrap().is_none());
    assert!(env.profile_store().session("personal").unwrap().is_some());
    assert!(
        env.profile_store()
            .load()
            .unwrap()
            .profiles
            .contains_key("work")
    );
    env.command()
        .args(["resources", "list", "--profile", "work"])
        .assert()
        .failure()
        .stderr(contains("logged out"));
    env.command()
        .args(["profiles", "use", "personal"])
        .assert()
        .success();
    assert_eq!(
        env.profile_store()
            .load()
            .unwrap()
            .current_profile
            .as_deref(),
        Some("personal")
    );
    env.command()
        .args(["profiles", "remove", "work"])
        .assert()
        .success();
    assert!(
        !env.profile_store()
            .load()
            .unwrap()
            .profiles
            .contains_key("work")
    );
    let revoke_personal = server
        .mock("POST", "/api/auth/sign-out")
        .match_header("authorization", "Bearer token-personal")
        .with_body("{}")
        .create();
    env.command()
        .args(["cloud", "logout"])
        .assert()
        .success()
        .stdout(contains("Logged out."));
    revoke_personal.assert();
    assert!(env.profile_store().session("personal").unwrap().is_none());
    env.command()
        .args(["cloud", "logout"])
        .assert()
        .success()
        .stdout(contains("No active session."));
}

#[test]
fn legacy_session_is_migrated_using_authenticated_server_identity() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    env.write_legacy_session(&server.url(), "legacy-token");
    let me = server.mock("GET", "/api/cli/me").match_header("authorization", "Bearer legacy-token")
        .with_body(r#"{"email":"alice@example.test","name":"Alice","userId":"alice","organizationId":"org-work","organizationName":"Work"}"#).expect(2).create();
    let resources = server
        .mock("GET", "/api/cli/resources")
        .match_query(Matcher::Any)
        .match_header("authorization", "Bearer legacy-token")
        .match_header("x-everr-organization-id", "org-work")
        .with_body("[]")
        .create();
    env.command().args(["resources", "list"]).assert().success();
    resources.assert();
    assert_eq!(
        env.profile_store().load().unwrap().profiles["default"]
            .target
            .organization_id,
        "org-work"
    );
    assert!(!env.session_path().exists());
    let output = env
        .command()
        .args(["whoami", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let connection: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(connection["profile"], "default");
    assert!(connection["ingestEndpoint"].is_null());
    assert!(
        connection
            .as_object()
            .unwrap()
            .contains_key("ingestEndpoint")
    );
    me.assert();
}

#[test]
fn expired_profile_never_falls_back_to_another_account() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    save(&env, "personal", &server.url(), "org-personal", "alice");
    save(&env, "work", &server.url(), "org-work", "alice");
    let root = project(&env, &server.url(), "org-work");
    let request = server
        .mock("GET", "/api/cli/resources")
        .match_query(Matcher::Any)
        .match_header("authorization", "Bearer token-work")
        .match_header("x-everr-organization-id", "org-work")
        .with_status(401)
        .with_body("expired")
        .create();
    env.command()
        .current_dir(&root)
        .args(["resources", "list"])
        .assert()
        .failure()
        .stderr(contains(
            "Session expired. Run `everr login --profile work` to re-authenticate.",
        ));
    request.assert();
    for name in ["work", "personal"] {
        assert_eq!(
            env.profile_store().session(name).unwrap().unwrap().token,
            format!("token-{name}")
        );
    }
}

#[test]
fn reauthentication_as_a_different_account_preserves_the_saved_profile_and_project() {
    let env = CliTestEnv::new();
    let mut server = Server::new();
    save(&env, "work", &server.url(), "org-work", "alice");
    let root = project(&env, &server.url(), "org-work");
    let requests = login_server(&mut server, "org-work", "bob", 200);
    let revoke = server
        .mock("POST", "/api/auth/sign-out")
        .match_header("authorization", "Bearer new-token")
        .with_body("{}")
        .create();
    env.command()
        .current_dir(&root)
        .args(["login", "--profile", "work", "--no-open"])
        .assert()
        .failure()
        .stderr(contains("approved account differs"));
    for request in requests {
        request.assert();
    }
    revoke.assert();
    assert_eq!(
        env.profile_store().session("work").unwrap().unwrap().token,
        "token-work"
    );
    assert_eq!(
        env.profile_store().load().unwrap().profiles["work"].user_id,
        "alice"
    );
}

#[test]
fn logout_in_an_unmatched_project_preserves_the_default_profile_session() {
    let env = CliTestEnv::new();
    env.write_profile_session("https://personal.example.test", "personal-token");
    let root = project(&env, "https://work.example.test", "org-work");
    env.command()
        .current_dir(&root)
        .arg("logout")
        .assert()
        .success();
    assert_eq!(
        env.profile_store()
            .session("default")
            .unwrap()
            .unwrap()
            .token,
        "personal-token"
    );
}
