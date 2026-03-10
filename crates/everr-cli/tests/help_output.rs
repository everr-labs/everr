mod support;

use predicates::prelude::*;
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
        .stdout(contains("login"))
        .stdout(contains("logout"))
        .stdout(contains("setup-assistant"))
        .stdout(contains("status"))
        .stdout(contains("grep"))
        .stdout(contains("slowest-tests"))
        .stdout(contains("slowest-jobs"))
        .stdout(contains("wait-pipeline"))
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
fn grep_help_lists_job_name_and_step_number_filters() {
    let env = CliTestEnv::new();

    env.command()
        .args(["grep", "--help"])
        .assert()
        .success()
        .stdout(contains("--job-name <JOB_NAME>"))
        .stdout(contains("--step-number <STEP_NUMBER>"))
        .stdout(predicates::str::contains("--step <STEP>").not());
}

#[test]
fn setup_assistant_help_lists_supported_assistants() {
    let env = CliTestEnv::new();

    env.command()
        .args(["setup-assistant", "--help"])
        .assert()
        .success()
        .stdout(contains("--assistant <ASSISTANTS>"))
        .stdout(contains("possible values: codex, claude, cursor"));
}

#[test]
fn auth_login_help_does_not_list_removed_config_flags() {
    let env = CliTestEnv::new();

    env.command()
        .args(["login", "--help"])
        .assert()
        .success()
        .stdout(predicates::str::contains("--token").not());
}

#[test]
fn version_output_includes_build_type() {
    let env = CliTestEnv::new();

    env.command()
        .arg("--version")
        .assert()
        .success()
        .stdout(contains("everr"))
        .stdout(contains("debug build"));
}
