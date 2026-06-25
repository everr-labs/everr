mod support;

use std::fs;

use predicates::prelude::*;
use predicates::str::contains;
use support::CliTestEnv;

#[cfg(unix)]
fn assert_symlink(path: &std::path::Path) {
    let metadata = fs::symlink_metadata(path).expect("read symlink metadata");
    assert!(
        metadata.file_type().is_symlink(),
        "{} should be a symlink",
        path.display()
    );
}

#[test]
fn skills_help_lists_commands_without_json_option() {
    let env = CliTestEnv::new();

    env.command()
        .args(["skills", "--help"])
        .assert()
        .success()
        .stdout(contains("list"))
        .stdout(contains("install"))
        .stdout(contains("update"))
        .stdout(contains("uninstall"))
        .stdout(predicate::str::contains("--json").not());
}

#[test]
fn old_ai_instruction_commands_are_removed() {
    let env = CliTestEnv::new();

    env.command().arg("ai-instructions").assert().failure();

    env.command()
        .args(["local", "ai-instructions"])
        .assert()
        .failure();

    env.command().arg("setup-assistant").assert().failure();
}

#[test]
fn skills_install_all_project_creates_canonical_skills_and_provider_symlink() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    env.command()
        .current_dir(&repo)
        .args([
            "skills",
            "install",
            "--all",
            "--project",
            "--agent",
            "claude-code",
        ])
        .assert()
        .success()
        .stdout(contains("Installed"))
        .stdout(contains("everr-working-with-ci"))
        .stdout(contains("everr-setup-telemetry"))
        .stdout(contains("everr-use-telemetry"));

    assert!(
        repo.join(".agents/skills/everr-working-with-ci/SKILL.md")
            .is_file()
    );
    assert!(
        repo.join(".agents/skills/everr-setup-telemetry/rules/nodejs.md")
            .is_file()
    );
    assert!(
        repo.join(".agents/skills/everr-setup-telemetry/rules/error-tracking.md")
            .is_file()
    );
    assert!(
        repo.join(".agents/skills/everr-setup-telemetry/rules/rust.md")
            .is_file()
    );
    #[cfg(unix)]
    assert_symlink(&repo.join(".claude/skills/everr-working-with-ci"));
}

#[test]
fn skills_install_all_project_restores_missing_telemetry_rules() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    env.command()
        .current_dir(&repo)
        .args([
            "skills",
            "install",
            "--all",
            "--project",
            "--agent",
            "claude-code",
        ])
        .assert()
        .success();

    let rules_dir = repo.join(".agents/skills/everr-setup-telemetry/rules");
    fs::remove_dir_all(&rules_dir).expect("remove installed rules");

    env.command()
        .current_dir(&repo)
        .args([
            "skills",
            "install",
            "--all",
            "--project",
            "--agent",
            "claude-code",
        ])
        .assert()
        .success()
        .stdout(contains("Installed"));

    assert!(rules_dir.join("nodejs.md").is_file());
    assert!(rules_dir.join("error-tracking.md").is_file());
    assert!(rules_dir.join("rust.md").is_file());
}

#[test]
fn skills_install_without_selection_requires_interactive_terminal() {
    let env = CliTestEnv::new();

    env.command()
        .args(["skills", "install"])
        .assert()
        .failure()
        .stderr(contains("use --all"));
}

#[test]
fn skills_install_rejects_named_skills() {
    let env = CliTestEnv::new();

    env.command()
        .args(["skills", "install", "everr-use-telemetry", "--global"])
        .assert()
        .failure()
        .stderr(contains("unexpected argument"));
}

#[test]
fn skills_install_global_creates_provider_symlink() {
    let env = CliTestEnv::new();

    env.command()
        .args(["skills", "install", "--all", "--global", "--agent", "codex"])
        .assert()
        .success()
        .stdout(contains("Installed"))
        .stdout(contains("everr-use-telemetry"));

    assert!(
        env.home_dir
            .join(".agents/skills/everr-use-telemetry/SKILL.md")
            .is_file()
    );
    let codex_skill = env.home_dir.join(".codex/skills/everr-use-telemetry");
    assert!(codex_skill.join("SKILL.md").is_file());
    #[cfg(unix)]
    assert_symlink(&codex_skill);
}

#[test]
fn skills_update_without_scope_checks_global_skills() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    let skill_doc = env
        .home_dir
        .join(".agents/skills/everr-use-telemetry/SKILL.md");
    fs::create_dir_all(skill_doc.parent().expect("skill parent")).expect("create skill parent");
    fs::write(&skill_doc, "local edits").expect("edit global skill");

    env.command()
        .current_dir(&repo)
        .args(["skills", "update"])
        .assert()
        .success()
        .stdout(contains("Updated 1 skill: everr-use-telemetry"));

    let content = fs::read_to_string(skill_doc).expect("read updated skill");
    assert!(content.contains("name: everr-use-telemetry"));
    assert!(!content.contains("local edits"));
}

#[test]
fn skills_update_without_scope_refreshes_telemetry_rules() {
    let env = CliTestEnv::new();

    env.command()
        .args(["skills", "install", "--all", "--global", "--agent", "codex"])
        .assert()
        .success();

    let rule_path = env
        .home_dir
        .join(".agents/skills/everr-setup-telemetry/rules/error-tracking.md");
    fs::write(&rule_path, "stale rule").expect("write stale rule");

    env.command()
        .args(["skills", "update"])
        .assert()
        .success()
        .stdout(contains("Updated"))
        .stdout(contains("everr-setup-telemetry"));

    let content = fs::read_to_string(rule_path).expect("read updated rule");
    assert!(content.contains("FROM traces"));
    assert!(content.contains("FROM logs"));
    assert!(!content.contains("stale rule"));
}

#[test]
fn skills_update_replaces_legacy_global_skill_names() {
    let env = CliTestEnv::new();
    let legacy_skill = env
        .home_dir
        .join(".agents/skills/everr-local-debugging/SKILL.md");
    fs::create_dir_all(legacy_skill.parent().expect("legacy skill parent"))
        .expect("create legacy skill parent");
    fs::write(&legacy_skill, "name: everr-local-debugging").expect("write legacy skill");

    env.command()
        .args(["skills", "update"])
        .assert()
        .success()
        .stdout(contains("Updated 1 skill: everr-use-telemetry"));

    assert!(!legacy_skill.exists());
    assert!(
        env.home_dir
            .join(".agents/skills/everr-use-telemetry/SKILL.md")
            .is_file()
    );
}

#[test]
fn setup_skips_skills_when_noninteractive_and_no_agents_detected() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");
    env.write_session("http://127.0.0.1:0", "token-123");

    env.command_with_api_base_url("http://127.0.0.1:0")
        .current_dir(&repo)
        .arg("setup")
        .write_stdin("\n")
        .assert()
        .success()
        .stderr(contains("Already logged in"));

    // With no agents detected in non-interactive mode, skills are skipped.
    assert!(
        !repo
            .join(".agents/skills/everr-working-with-ci/SKILL.md")
            .exists()
    );
    assert!(
        !env.home_dir
            .join(".agents/skills/everr-working-with-ci/SKILL.md")
            .exists()
    );
}

#[test]
fn setup_syncs_all_global_skills_when_any_global_skill_exists() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");
    env.write_session("http://127.0.0.1:0", "token-123");

    let existing_skill = env
        .home_dir
        .join(".agents/skills/everr-use-telemetry/SKILL.md");
    fs::create_dir_all(existing_skill.parent().expect("skill parent"))
        .expect("create skill parent");
    fs::write(&existing_skill, "local edits").expect("write edited skill");

    env.command_with_api_base_url("http://127.0.0.1:0")
        .current_dir(&repo)
        .arg("setup")
        .write_stdin("\n")
        .assert()
        .success()
        .stderr(contains("Already logged in"));

    let content = fs::read_to_string(&existing_skill).expect("read synced skill");
    assert!(content.contains("name: everr-use-telemetry"));
    assert!(!content.contains("local edits"));
    assert!(
        env.home_dir
            .join(".agents/skills/everr-working-with-ci/SKILL.md")
            .is_file()
    );
    assert!(
        env.home_dir
            .join(".agents/skills/everr-setup-telemetry/SKILL.md")
            .is_file()
    );
    assert!(
        !repo
            .join(".agents/skills/everr-working-with-ci/SKILL.md")
            .exists()
    );
}

#[test]
fn setup_authenticates_without_enter_when_polling_succeeds() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    let mut server = support::mock_api_server();
    let code_mock = server
        .mock("POST", "/api/auth/device/code")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            r#"{"device_code":"device-123","user_code":"CODE-123","verification_uri":"https://example.com/device","expires_in":60,"interval":0}"#,
        )
        .create();
    let token_mock = server
        .mock("POST", "/api/auth/device/token")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"access_token":"token-123"}"#)
        .create();
    let me_mock = server
        .mock("GET", "/api/cli/me")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"email":"user@example.com","name":"Test User","profileUrl":null}"#)
        .create();
    let org_mock = server
        .mock("GET", "/api/cli/org")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"name":"Acme","isOnlyMember":true,"onboardingCompleted":true}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo)
        .arg("setup")
        .assert()
        .success()
        .stderr(contains("Press Enter to open in your browser").not())
        .stderr(contains("Logged in as user@example.com"))
        .stderr(contains("Using organization: Acme"));

    code_mock.assert();
    token_mock.assert();
    me_mock.assert();
    org_mock.assert();
    let session = fs::read_to_string(env.session_path()).expect("read saved session");
    assert!(session.contains("token-123"));
}

#[test]
fn setup_outputs_identity_and_skips_org_setup_when_org_already_onboarded() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    let mut server = support::mock_api_server();
    env.write_session(&server.url(), "token-123");

    let me_mock = server
        .mock("GET", "/api/cli/me")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"email":"user@example.com","name":"Test User","profileUrl":null}"#)
        .create();
    let org_mock = server
        .mock("GET", "/api/cli/org")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"name":"Acme","isOnlyMember":true,"onboardingCompleted":true}"#)
        .create();
    let repos_mock = server.mock("GET", "/api/cli/repos").expect(0).create();
    let onboarding_mock = server.mock("PATCH", "/api/cli/org").expect(0).create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo)
        .arg("setup")
        .assert()
        .success()
        .stderr(contains("Logged in as user@example.com"))
        .stderr(contains("Using organization: Acme"));

    me_mock.assert();
    org_mock.assert();
    repos_mock.assert();
    onboarding_mock.assert();
}

#[test]
fn setup_marks_cloud_onboarding_complete_when_org_was_not_onboarded() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    let mut server = support::mock_api_server();
    env.write_session(&server.url(), "token-123");

    let me_mock = server
        .mock("GET", "/api/cli/me")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"email":"user@example.com","name":"Test User","profileUrl":null}"#)
        .create();
    let org_mock = server
        .mock("GET", "/api/cli/org")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"name":"Acme","isOnlyMember":true,"onboardingCompleted":false}"#)
        .create();
    let onboarding_mock = server
        .mock("PATCH", "/api/cli/org")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"ok":true}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo)
        .arg("setup")
        .assert()
        .success()
        .stderr(contains("Logged in as user@example.com"))
        .stderr(contains("Using organization: Acme"));

    me_mock.assert();
    org_mock.assert();
    onboarding_mock.assert();
}

#[test]
fn setup_marks_cloud_onboarding_complete_for_non_admin_member() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    let mut server = support::mock_api_server();
    env.write_session(&server.url(), "token-123");

    let me_mock = server
        .mock("GET", "/api/cli/me")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"email":"user@example.com","name":"Test User","profileUrl":null}"#)
        .create();
    let org_mock = server
        .mock("GET", "/api/cli/org")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            r#"{"name":"Acme","isOnlyMember":false,"onboardingCompleted":false,"role":"member"}"#,
        )
        .create();
    let repos_mock = server.mock("GET", "/api/cli/repos").expect(0).create();
    let onboarding_mock = server
        .mock("PATCH", "/api/cli/org")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"ok":true}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo)
        .arg("setup")
        .assert()
        .success()
        .stderr(contains("Logged in as user@example.com"))
        .stderr(contains("Using organization: Acme"));

    me_mock.assert();
    org_mock.assert();
    repos_mock.assert();
    onboarding_mock.assert();
}

#[test]
fn init_skips_runs_import_step_for_non_admin_member() {
    let env = CliTestEnv::new();
    let repo = env.init_git_repo("repo", "feature", "https://github.com/acme/api.git");

    let mut server = support::mock_api_server();
    env.write_session(&server.url(), "token-123");

    let org_mock = server
        .mock("GET", "/api/cli/org")
        .match_header("authorization", "Bearer token-123")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            r#"{"name":"Acme","isOnlyMember":false,"onboardingCompleted":false,"role":"member"}"#,
        )
        .create();
    let repos_mock = server.mock("GET", "/api/cli/repos").expect(0).create();
    let import_mock = server.mock("POST", "/api/cli/import").expect(0).create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo)
        .arg("init")
        .assert()
        .success()
        .stderr(contains(
            "Only organization admins can import workflow history",
        ));

    org_mock.assert();
    repos_mock.assert();
    import_mock.assert();
}
