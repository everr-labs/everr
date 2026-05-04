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
        .stdout(predicates::str::contains("\n  install").not())
        .stdout(contains("login"))
        .stdout(contains("logout"))
        .stdout(contains("setup-assistant"))
        .stdout(contains("ai-instructions"))
        .stdout(contains("status"))
        .stdout(contains("grep"))
        .stdout(contains("slowest-tests"))
        .stdout(contains("slowest-jobs"))
        .stdout(contains("watch"))
        .stdout(predicates::str::contains("wait-pipeline").not())
        .stdout(contains("runs"))
        .stdout(contains("show"))
        .stdout(contains("logs"))
        .stdout(contains("wrap"))
        .stdout(contains("telemetry"));
}

#[test]
fn runs_help_lists_pipeline_subcommands() {
    let env = CliTestEnv::new();

    env.command()
        .args(["--help"])
        .assert()
        .success()
        .stdout(contains("runs"))
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
        .stdout(contains("--limit <LIMIT>"))
        .stdout(contains("--offset <OFFSET>"))
        .stdout(contains("--step-number <STEP_NUMBER>"))
        .stdout(predicates::str::contains("--step <STEP>").not());
}

#[test]
fn runs_list_help_lists_limit_and_offset() {
    let env = CliTestEnv::new();

    env.command()
        .args(["runs", "--help"])
        .assert()
        .success()
        .stdout(contains("--limit <LIMIT>"))
        .stdout(contains("--offset <OFFSET>"));
}

#[test]
fn runs_logs_help_lists_paging_flags_and_default_page_size() {
    let env = CliTestEnv::new();

    env.command()
        .args(["logs", "--help"])
        .assert()
        .success()
        .stdout(contains("--tail"))
        .stdout(contains("--limit <LIMIT>"))
        .stdout(contains("--offset <OFFSET>"))
        .stdout(contains("default: 1000"))
        .stdout(contains("--egrep"));
}

#[test]
fn telemetry_help_lists_start_command() {
    let env = CliTestEnv::new();

    env.command()
        .args(["telemetry", "--help"])
        .assert()
        .success()
        .stdout(contains("start"))
        .stdout(contains("query"))
        .stdout(contains("endpoint"));

    env.command()
        .args(["telemetry", "start", "--help"])
        .assert()
        .success()
        .stdout(contains("--quiet"));
}

#[test]
fn wrap_help_describes_command_capture() {
    let env = CliTestEnv::new();

    env.command()
        .args(["wrap", "--help"])
        .assert()
        .success()
        .stdout(contains("<COMMAND>"))
        .stdout(contains(
            "send its stdout/stderr logs to the local collector",
        ));
}

#[test]
fn status_help_lists_commit_based_options() {
    let env = CliTestEnv::new();

    env.command()
        .args(["status", "--help"])
        .assert()
        .success()
        .stdout(contains("--repo <REPO>"))
        .stdout(contains("--branch <BRANCH>"))
        .stdout(contains("--commit <COMMIT>"))
        .stdout(predicates::str::contains("--from").not())
        .stdout(predicates::str::contains("--to").not());
}

#[test]
fn setup_assistant_help_describes_output() {
    let env = CliTestEnv::new();

    env.command()
        .args(["setup-assistant", "--help"])
        .assert()
        .success()
        .stdout(contains(
            "Print the repo-level AGENTS.md instructions for Everr",
        ));
}

#[test]
fn ai_instructions_help_describes_full_guidance_output() {
    let env = CliTestEnv::new();

    env.command()
        .args(["ai-instructions", "--help"])
        .assert()
        .success()
        .stdout(contains(
            "Print the full AI instructions for Everr CLI usage",
        ));
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
