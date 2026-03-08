mod support;

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
fn mismatched_saved_session_is_cleared_before_commands_run() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "token-123");

    env.command()
        .args(["status"])
        .assert()
        .failure()
        .stderr(contains("no active session; run `everr login`"));

    assert!(!env.session_path().exists());
}
