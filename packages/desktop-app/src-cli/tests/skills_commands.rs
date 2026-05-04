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
        .args(["telemetry", "ai-instructions"])
        .assert()
        .failure();

    env.command().arg("setup-assistant").assert().failure();
}

#[test]
fn skills_install_project_creates_canonical_skill_and_provider_symlink() {
    let env = CliTestEnv::new();
    let repo = env.home_dir.join("repo");
    fs::create_dir_all(&repo).expect("create repo");

    env.command()
        .current_dir(&repo)
        .args([
            "skills",
            "install",
            "ci-debugging",
            "--project",
            "--agent",
            "claude-code",
        ])
        .assert()
        .success()
        .stdout(contains("Installed 1 skill"));

    assert!(repo.join(".agents/skills/ci-debugging/SKILL.md").is_file());
    #[cfg(unix)]
    assert_symlink(&repo.join(".claude/skills/ci-debugging"));
}

#[test]
fn skills_install_without_selection_requires_interactive_terminal() {
    let env = CliTestEnv::new();

    env.command()
        .args(["skills", "install"])
        .assert()
        .failure()
        .stderr(contains("provide at least one skill name or use --all"));
}

#[test]
fn skills_install_global_copy_writes_provider_copy() {
    let env = CliTestEnv::new();

    env.command()
        .args([
            "skills",
            "install",
            "local-debugging",
            "--global",
            "--agent",
            "codex",
            "--copy",
        ])
        .assert()
        .success()
        .stdout(contains("Installed 1 skill"));

    assert!(
        env.home_dir
            .join(".agents/skills/local-debugging/SKILL.md")
            .is_file()
    );
    let codex_skill = env.home_dir.join(".codex/skills/local-debugging");
    assert!(codex_skill.join("SKILL.md").is_file());
    assert!(
        !fs::symlink_metadata(&codex_skill)
            .expect("read codex skill metadata")
            .file_type()
            .is_symlink()
    );
}

#[test]
fn setup_installs_project_skills_when_noninteractive_and_authenticated() {
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

    assert!(repo.join(".agents/skills/ci-debugging/SKILL.md").is_file());
    assert!(
        repo.join(".agents/skills/local-telemetry-setup/SKILL.md")
            .is_file()
    );
    assert!(
        repo.join(".agents/skills/local-debugging/SKILL.md")
            .is_file()
    );
    #[cfg(unix)]
    assert_symlink(&repo.join(".claude/skills/ci-debugging"));
}
