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
        .stdout(contains(
            "Query telemetry, inspect CI, and manage resources as code in Everr",
        ))
        .stdout(contains("Usage: everr <COMMAND>"))
        .stdout(predicates::str::contains("\n  install").not())
        .stdout(predicates::str::contains("\n  login").not())
        .stdout(predicates::str::contains("\n  logout").not())
        .stdout(predicates::str::contains("setup-assistant").not())
        .stdout(predicates::str::contains("ai-instructions").not())
        .stdout(contains("cloud"))
        .stdout(contains("ci"))
        .stdout(contains("local"))
        .stdout(predicates::str::contains("\n  status").not())
        .stdout(predicates::str::contains("\n  grep").not())
        .stdout(predicates::str::contains("slowest-tests").not())
        .stdout(predicates::str::contains("slowest-jobs").not())
        .stdout(predicates::str::contains("\n  watch").not())
        .stdout(predicates::str::contains("wait-pipeline").not())
        .stdout(predicates::str::contains("\n  runs").not())
        .stdout(predicates::str::contains("\n  show").not())
        .stdout(predicates::str::contains("\n  logs").not())
        .stdout(contains("wrap"))
        .stdout(contains("skills"))
        .stdout(contains("upgrade"))
        .stdout(contains("apply"))
        .stdout(contains("resources"))
        .stdout(contains("Authenticate with and query Everr Cloud"))
        .stdout(contains("Run and query the local telemetry Collector"))
        .stdout(contains("Reconcile a directory of as-code resources"));
}

#[test]
fn ci_help_lists_ci_subcommands() {
    let env = CliTestEnv::new();

    env.command()
        .args(["ci", "--help"])
        .assert()
        .success()
        .stdout(contains("status"))
        .stdout(contains("watch"))
        .stdout(contains("runs"))
        .stdout(contains("show"))
        .stdout(contains("logs"))
        .stdout(contains("Show CI status for a commit or run ID"))
        .stdout(contains("List recent CI runs"));
}

#[test]
fn cloud_help_lists_cloud_subcommands() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "--help"])
        .assert()
        .success()
        .stdout(contains("login"))
        .stdout(contains("logout"))
        .stdout(predicates::str::contains("\n  grep").not())
        .stdout(predicates::str::contains("\n  logs").not());
}

#[test]
fn cloud_help_lists_query_subcommand() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "--help"])
        .assert()
        .success()
        .stdout(contains("query"));
}

#[test]
fn cloud_query_help_lists_format_option() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "query", "--help"])
        .assert()
        .success()
        .stdout(contains(
            "Run read-only SQL against CI and Production telemetry",
        ))
        .stdout(contains("<SQL>"))
        .stdout(contains("--format <FORMAT>"));
}

#[test]
fn runs_list_help_lists_limit_and_offset() {
    let env = CliTestEnv::new();

    env.command()
        .args(["ci", "runs", "--help"])
        .assert()
        .success()
        .stdout(contains("--limit <LIMIT>"))
        .stdout(contains("--offset <OFFSET>"));
}

#[test]
fn runs_logs_help_lists_paging_flags_and_default_page_size() {
    let env = CliTestEnv::new();

    env.command()
        .args(["ci", "logs", "--help"])
        .assert()
        .success()
        .stdout(contains("--tail"))
        .stdout(contains("--limit <LIMIT>"))
        .stdout(contains("--offset <OFFSET>"))
        .stdout(contains("default: 1000"))
        .stdout(contains("--egrep"))
        .stdout(contains("Trace ID of the CI run"))
        .stdout(contains("Job name"))
        .stdout(contains("Step number"));
}

#[test]
fn local_help_lists_collector_commands() {
    let env = CliTestEnv::new();

    env.command()
        .args(["local", "--help"])
        .assert()
        .success()
        .stdout(contains("start"))
        .stdout(contains("query"))
        .stdout(contains("status"))
        .stdout(predicates::str::contains("\n  endpoint").not());

    env.command()
        .args(["local", "start", "--help"])
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
        .stdout(contains("capture its output as local logs"));
}

#[test]
fn status_help_lists_commit_based_options() {
    let env = CliTestEnv::new();

    env.command()
        .args(["ci", "status", "--help"])
        .assert()
        .success()
        .stdout(contains("--repo <REPO>"))
        .stdout(contains("--branch <BRANCH>"))
        .stdout(contains("--commit <COMMIT>"))
        .stdout(contains("--run-id <RUN_ID>"))
        .stdout(predicates::str::contains("--from").not())
        .stdout(predicates::str::contains("--to").not());
}

#[test]
fn skills_help_describes_skill_management() {
    let env = CliTestEnv::new();

    env.command()
        .args(["skills", "--help"])
        .assert()
        .success()
        .stdout(contains("Manage bundled Everr skills"))
        .stdout(contains("list"))
        .stdout(contains("install"))
        .stdout(contains("update"))
        .stdout(contains("uninstall"))
        .stdout(predicates::str::contains("--json").not());
}

#[test]
fn resource_help_describes_reconciliation_and_live_resource_management() {
    let env = CliTestEnv::new();

    env.command()
        .args(["apply", "--help"])
        .assert()
        .success()
        .stdout(contains(
            "Reconcile a directory of as-code resources with Everr",
        ))
        .stdout(contains("--preview [<NAME>]"))
        .stdout(contains("--dry-run"))
        .stdout(contains("--adopt"));

    env.command()
        .args(["resources", "--help"])
        .assert()
        .success()
        .stdout(contains(
            "Inspect and manage live dashboards, runbooks, and alerts",
        ))
        .stdout(contains("list"))
        .stdout(contains("show"))
        .stdout(contains("delete"))
        .stdout(contains("adopt"));
}

#[test]
fn auth_login_help_does_not_list_removed_config_flags() {
    let env = CliTestEnv::new();

    env.command()
        .args(["cloud", "login", "--help"])
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
