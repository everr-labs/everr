mod support;

use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn root_help_lists_main_commands() {
    let env = CliTestEnv::new();

    env.command()
        .arg("--help")
        .assert()
        .success()
        .stdout(contains("Usage: everr <COMMAND>"))
        .stdout(contains("install"))
        .stdout(contains("status"))
        .stdout(contains("runs"));
}

#[test]
fn runs_help_lists_pipeline_subcommands() {
    let env = CliTestEnv::new();

    env.command()
        .args(["runs", "--help"])
        .assert()
        .success()
        .stdout(contains("Usage: everr runs <COMMAND>"))
        .stdout(contains("list"))
        .stdout(contains("show"))
        .stdout(contains("logs"));
}

#[test]
fn assistant_init_help_lists_supported_assistants() {
    let env = CliTestEnv::new();

    env.command()
        .args(["assistant", "init", "--help"])
        .assert()
        .success()
        .stdout(contains("--assistant <ASSISTANTS>"))
        .stdout(contains("possible values: codex, claude, cursor"));
}
