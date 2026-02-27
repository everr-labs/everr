mod support;

use std::fs;
use std::path::Path;

use predicates::str::contains;
use support::CliTestEnv;

const BLOCK_START: &str = "<!-- EVERR_CLI_START -->";
const BLOCK_END: &str = "<!-- EVERR_CLI_END -->";

#[test]
fn assistant_init_codex_creates_managed_block() {
    let env = CliTestEnv::new();

    env.command()
        .args(["assistant", "init", "--assistant", "codex"])
        .assert()
        .success()
        .stdout(contains("Configured Codex at"));

    let codex_file = env.home_dir.join(".codex").join("AGENTS.md");
    let content = fs::read_to_string(codex_file).expect("codex file should exist");

    assert!(content.contains(BLOCK_START));
    assert!(content.contains(BLOCK_END));
}

#[test]
fn assistant_init_is_idempotent_for_existing_managed_block() {
    let env = CliTestEnv::new();

    env.command()
        .args(["assistant", "init", "--assistant", "codex"])
        .assert()
        .success();

    env.command()
        .args(["assistant", "init", "--assistant", "codex"])
        .assert()
        .success();

    let codex_file = env.home_dir.join(".codex").join("AGENTS.md");
    let content = fs::read_to_string(codex_file).expect("codex file should exist");
    assert_eq!(content.matches(BLOCK_START).count(), 1);
}

#[test]
fn assistant_init_preserves_existing_user_content() {
    let env = CliTestEnv::new();
    let codex_file = env.home_dir.join(".codex").join("AGENTS.md");
    write_file(&codex_file, "# My custom instructions\n");

    env.command()
        .args(["assistant", "init", "--assistant", "codex"])
        .assert()
        .success();

    let content = fs::read_to_string(codex_file).expect("codex file should exist");
    assert!(content.contains("# My custom instructions"));
    assert!(content.contains(BLOCK_START));
}

#[test]
fn assistant_init_multiple_assistants_creates_all_files() {
    let env = CliTestEnv::new();

    env.command()
        .args([
            "assistant",
            "init",
            "--assistant",
            "codex",
            "--assistant",
            "claude",
        ])
        .assert()
        .success();

    let codex_file = env.home_dir.join(".codex").join("AGENTS.md");
    let claude_file = env.home_dir.join(".claude").join("CLAUDE.md");
    assert!(codex_file.exists());
    assert!(claude_file.exists());
}

#[test]
fn uninstall_removes_managed_block_but_keeps_unrelated_content() {
    let env = CliTestEnv::new();
    let codex_file = env.home_dir.join(".codex").join("AGENTS.md");

    write_file(
        &codex_file,
        "# Keep this\n\n<!-- EVERR_CLI_START -->\nmanaged\n<!-- EVERR_CLI_END -->\n",
    );

    env.command().arg("uninstall").assert().success();

    let content = fs::read_to_string(codex_file).expect("codex file should remain");
    assert!(content.contains("# Keep this"));
    assert!(!content.contains(BLOCK_START));
    assert!(!content.contains(BLOCK_END));
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dir");
    }
    fs::write(path, content).expect("write file");
}
