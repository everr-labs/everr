mod support;

use std::fs;
use std::path::Path;

use predicates::str::contains;
use support::CliTestEnv;

const BLOCK_START: &str = "<!-- BEGIN everr -->";
const BLOCK_END: &str = "<!-- END everr -->";

#[test]
fn setup_assistant_creates_repo_agents_file() {
    let env = CliTestEnv::new();
    let repo_dir = env.home_dir.join("repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");

    env.command()
        .current_dir(&repo_dir)
        .arg("setup-assistant")
        .assert()
        .success()
        .stdout(contains("Configured Everr instructions at"));

    let agents_file = repo_dir.join("AGENTS.md");
    let content = fs::read_to_string(agents_file).expect("AGENTS.md should exist");

    assert!(content.contains(BLOCK_START));
    assert!(content.contains(BLOCK_END));
    assert!(content.contains("call `everr ai-instructions` for full usage."));
    assert!(content.contains("`everr status`"));
    assert!(!content.contains("`everr runs`"));
}

#[test]
fn setup_assistant_is_idempotent_for_existing_managed_block() {
    let env = CliTestEnv::new();
    let repo_dir = env.home_dir.join("repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");

    env.command()
        .current_dir(&repo_dir)
        .arg("setup-assistant")
        .assert()
        .success();

    env.command()
        .current_dir(&repo_dir)
        .arg("setup-assistant")
        .assert()
        .success();

    let agents_file = repo_dir.join("AGENTS.md");
    let content = fs::read_to_string(agents_file).expect("AGENTS.md should exist");
    assert_eq!(content.matches(BLOCK_START).count(), 1);
}

#[test]
fn setup_assistant_preserves_existing_repo_content() {
    let env = CliTestEnv::new();
    let repo_dir = env.home_dir.join("repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let agents_file = repo_dir.join("AGENTS.md");
    write_file(&agents_file, "# My custom instructions\n");

    env.command()
        .current_dir(&repo_dir)
        .arg("setup-assistant")
        .assert()
        .success();

    let content = fs::read_to_string(agents_file).expect("AGENTS.md should exist");
    assert!(content.contains("# My custom instructions"));
    assert!(content.contains(BLOCK_START));
}

#[test]
fn setup_assistant_replaces_existing_managed_block() {
    let env = CliTestEnv::new();
    let repo_dir = env.home_dir.join("repo");
    fs::create_dir_all(&repo_dir).expect("create repo dir");
    let agents_file = repo_dir.join("AGENTS.md");
    write_file(
        &agents_file,
        "# Notes\n\n<!-- BEGIN everr -->\nold instructions\n<!-- END everr -->\n",
    );

    env.command()
        .current_dir(&repo_dir)
        .arg("setup-assistant")
        .assert()
        .success();

    let content = fs::read_to_string(agents_file).expect("AGENTS.md should exist");
    assert!(content.contains("# Notes"));
    assert!(content.contains(BLOCK_START));
    assert!(!content.contains("old instructions"));
    assert_eq!(content.matches(BLOCK_START).count(), 1);
}

#[test]
fn ai_instructions_prints_full_guidance() {
    let env = CliTestEnv::new();

    env.command()
        .arg("ai-instructions")
        .assert()
        .success()
        .stdout(contains("Quick commands:"))
        .stdout(contains("`everr status`"))
        .stdout(contains("`everr runs`"));
}

#[test]
fn uninstall_removes_managed_block_but_keeps_unrelated_content() {
    let env = CliTestEnv::new();
    let codex_file = env.home_dir.join(".codex").join("AGENTS.md");

    write_file(
        &codex_file,
        "# Keep this\n\n<!-- BEGIN everr -->\nmanaged\n<!-- END everr -->\n",
    );

    env.command()
        .arg("uninstall")
        .write_stdin("\n")
        .assert()
        .success();

    let content = fs::read_to_string(codex_file).expect("codex file should remain");
    assert!(content.contains("# Keep this"));
    assert!(!content.contains(BLOCK_START));
    assert!(!content.contains(BLOCK_END));
}

#[test]
fn uninstall_logs_out_and_removes_managed_blocks_for_all_assistants() {
    let env = CliTestEnv::new();
    env.write_session("https://app.everr.dev", "token-123");

    let codex_file = env.home_dir.join(".codex").join("AGENTS.md");
    let claude_file = env.home_dir.join(".claude").join("CLAUDE.md");
    let cursor_file = env.home_dir.join(".cursor").join("rules").join("everr.mdc");

    write_file(
        &codex_file,
        "# Codex note\n\n<!-- BEGIN everr -->\nmanaged\n<!-- END everr -->\n",
    );
    write_file(
        &claude_file,
        "# Claude note\n\n<!-- BEGIN everr -->\nmanaged\n<!-- END everr -->\n",
    );
    write_file(
        &cursor_file,
        "# Cursor note\n\n<!-- BEGIN everr -->\nmanaged\n<!-- END everr -->\n",
    );

    env.command()
        .arg("uninstall")
        .write_stdin("\n")
        .assert()
        .success()
        .stdout(contains("The uninstall command will:"))
        .stdout(contains("Press Enter to continue, or Ctrl+C to abort."))
        .stdout(contains("Does not remove the CLI binary automatically:"))
        .stdout(contains("To remove the CLI binary, run:"))
        .stdout(contains("rm \""))
        .stdout(contains("Logged out."));

    let codex_content = fs::read_to_string(codex_file).expect("codex file should remain");
    let claude_content = fs::read_to_string(claude_file).expect("claude file should remain");
    let cursor_content = fs::read_to_string(cursor_file).expect("cursor file should remain");

    assert!(codex_content.contains("# Codex note"));
    assert!(claude_content.contains("# Claude note"));
    assert!(cursor_content.contains("# Cursor note"));
    assert!(!codex_content.contains(BLOCK_START));
    assert!(!claude_content.contains(BLOCK_START));
    assert!(!cursor_content.contains(BLOCK_START));
    assert!(!codex_content.contains(BLOCK_END));
    assert!(!claude_content.contains(BLOCK_END));
    assert!(!cursor_content.contains(BLOCK_END));
    assert!(!env.session_path().exists());
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dir");
    }
    fs::write(path, content).expect("write file");
}
