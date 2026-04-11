mod support;

use std::fs;
use std::path::Path;

use predicates::str::contains;
use support::CliTestEnv;

const BLOCK_START: &str = "<!-- BEGIN everr -->";
const BLOCK_END: &str = "<!-- END everr -->";

#[test]
fn setup_assistant_prints_repo_instructions() {
    let env = CliTestEnv::new();

    env.command()
        .arg("setup-assistant")
        .assert()
        .success()
        .stdout(contains("call `everr ai-instructions` for full usage."))
        .stdout(contains("`everr status`"));
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
        .stdout(contains("rm \""));

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

#[test]
fn setup_configures_assistants_when_detected() {
    let env = CliTestEnv::new();
    let claude_dir = env.home_dir.join(".claude");
    fs::create_dir_all(&claude_dir).expect("create .claude dir");

    env.write_session("http://127.0.0.1:0", "token-123");

    env.command_with_api_base_url("http://127.0.0.1:0")
        .arg("setup")
        .write_stdin("\n")
        .assert()
        .success()
        .stderr(contains("Already logged in"));

    let claude_file = env.home_dir.join(".claude").join("CLAUDE.md");
    assert!(claude_file.exists(), "CLAUDE.md should be created");
    let content = fs::read_to_string(claude_file).expect("read CLAUDE.md");
    assert!(content.contains(BLOCK_START));
    assert!(content.contains("call `everr ai-instructions` for full usage."));
    assert!(content.contains("`everr status`"));
    assert!(!content.contains("`everr runs`"));
}

#[test]
fn setup_skips_login_when_already_authenticated() {
    let env = CliTestEnv::new();
    env.write_session("http://127.0.0.1:0", "token-123");

    env.command_with_api_base_url("http://127.0.0.1:0")
        .arg("setup")
        .write_stdin("\n")
        .assert()
        .success()
        .stderr(contains("Already logged in"));
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dir");
    }
    fs::write(path, content).expect("write file");
}
