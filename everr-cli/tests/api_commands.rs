mod support;

use std::path::Path;
use std::process::Command as ProcessCommand;

use mockito::{Matcher, Server};
use predicates::prelude::*;
use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn status_command_sends_expected_query_and_auth_header() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/tests",
        "git@github.com:everr-dev/everr.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-123");

    let mock = server
        .mock("GET", "/api/cli/status")
        .match_header("authorization", "Bearer token-123")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/tests".into()),
            Matcher::UrlEncoded("mainBranch".into(), "main".into()),
            Matcher::UrlEncoded("from".into(), "now-1h".into()),
            Matcher::UrlEncoded("to".into(), "now".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"status":"ok"}"#)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "status",
            "--main-branch",
            "main",
            "--from",
            "now-1h",
            "--to",
            "now",
        ])
        .assert()
        .success()
        .stdout(contains("\"status\": \"ok\""));

    mock.assert();
}

#[test]
fn runs_list_sends_filter_query_params() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/tests",
        "git@github.com:everr-dev/everr.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/tests".into()),
            Matcher::UrlEncoded("conclusion".into(), "failure".into()),
            Matcher::UrlEncoded("workflowName".into(), "Build & Test App".into()),
            Matcher::UrlEncoded("runId".into(), "42".into()),
            Matcher::UrlEncoded("page".into(), "2".into()),
            Matcher::UrlEncoded("from".into(), "now-2h".into()),
            Matcher::UrlEncoded("to".into(), "now".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"runs":[],"totalCount":0}"#)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "runs",
            "list",
            "--branch",
            "feature/tests",
            "--conclusion",
            "failure",
            "--workflow-name",
            "Build & Test App",
            "--run-id",
            "42",
            "--page",
            "2",
            "--from",
            "now-2h",
            "--to",
            "now",
        ])
        .assert()
        .success()
        .stdout(contains("\"runs\": []"));

    mock.assert();
}

#[test]
fn runs_list_defaults_branch_to_current_git_branch() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/default-branch",
        "git@github.com:everr-dev/everr.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/default-branch".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"runs":[],"totalCount":0}"#)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args(["runs", "list"])
        .assert()
        .success()
        .stdout(contains("\"runs\": []"));

    mock.assert();
}

#[test]
fn runs_show_calls_trace_id_endpoint() {
    let env = CliTestEnv::new();
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123")
        .match_header("authorization", "Bearer token-abc")
        .with_status(200)
        .with_body(r#"{"run":{"traceId":"trace-123"},"jobs":[],"steps":{}}"#)
        .create();

    env.command()
        .args(["runs", "show", "--trace-id", "trace-123"])
        .assert()
        .success()
        .stdout(contains("\"traceId\": \"trace-123\""));

    mock.assert();
}

#[test]
fn runs_logs_sets_full_logs_false_by_default() {
    let env = CliTestEnv::new();
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123/logs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("jobName".into(), "build".into()),
            Matcher::UrlEncoded("stepNumber".into(), "2".into()),
            Matcher::UrlEncoded("fullLogs".into(), "false".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"logs":"short"}"#)
        .create();

    env.command()
        .args([
            "runs",
            "logs",
            "--trace-id",
            "trace-123",
            "--job-name",
            "build",
            "--step-number",
            "2",
        ])
        .assert()
        .success()
        .stdout(contains("\"logs\": \"short\""));

    mock.assert();
}

#[test]
fn runs_logs_sets_full_logs_true_when_flag_is_present() {
    let env = CliTestEnv::new();
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123/logs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("jobName".into(), "build".into()),
            Matcher::UrlEncoded("stepNumber".into(), "2".into()),
            Matcher::UrlEncoded("fullLogs".into(), "true".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"logs":"full"}"#)
        .create();

    env.command()
        .args([
            "runs",
            "logs",
            "--trace-id",
            "trace-123",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--full",
        ])
        .assert()
        .success()
        .stdout(contains("\"logs\": \"full\""));

    mock.assert();
}

#[test]
fn test_history_sends_expected_query_and_auth_header() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/test-history",
        "git@github.com:everr-dev/everr.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-xyz");

    let mock = server
        .mock("GET", "/api/cli/test-history")
        .match_header("authorization", "Bearer token-xyz")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("testModule".into(), "suite".into()),
            Matcher::UrlEncoded("testName".into(), "test".into()),
            Matcher::UrlEncoded("from".into(), "now-7d".into()),
            Matcher::UrlEncoded("to".into(), "now".into()),
        ]))
        .with_status(200)
        .with_body(r#"[{"traceId":"trace-1","testResult":"pass"}]"#)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "test-history",
            "--module",
            "suite",
            "--test-name",
            "test",
            "--from",
            "now-7d",
            "--to",
            "now",
        ])
        .assert()
        .success()
        .stdout(contains("\"traceId\": \"trace-1\""));

    mock.assert();
}

#[test]
fn test_history_supports_test_name_without_module() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/test-history-no-module",
        "git@github.com:everr-dev/everr.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-xyz");

    let mock = server
        .mock("GET", "/api/cli/test-history")
        .match_header("authorization", "Bearer token-xyz")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("testName".into(), "my-test".into()),
        ]))
        .with_status(200)
        .with_body(r#"[]"#)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args(["test-history", "--test-name", "my-test"])
        .assert()
        .success()
        .stdout(contains("[]"));

    mock.assert();
}

#[test]
fn test_history_supports_module_without_test_name() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/test-history-module-only",
        "git@github.com:everr-dev/everr.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-xyz");

    let mock = server
        .mock("GET", "/api/cli/test-history")
        .match_header("authorization", "Bearer token-xyz")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("testModule".into(), "suite".into()),
        ]))
        .with_status(200)
        .with_body(r#"[]"#)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args(["test-history", "--module", "suite"])
        .assert()
        .success()
        .stdout(contains("[]"));

    mock.assert();
}

#[test]
fn test_history_requires_at_least_one_filter() {
    let env = CliTestEnv::new();
    let server = Server::new();
    env.write_session(&server.url(), "token-xyz");

    env.command()
        .args(["test-history", "--repo", "everr-dev/everr"])
        .assert()
        .failure()
        .stderr(contains(
            "provide at least one test filter: --module or --test-name",
        ));
}

#[test]
fn test_history_requires_repo_when_git_context_is_missing() {
    let env = CliTestEnv::new();
    let server = Server::new();
    env.write_session(&server.url(), "token-xyz");

    env.command()
        .current_dir(&env.home_dir)
        .args(["test-history", "--test-name", "suite/test"])
        .assert()
        .failure()
        .stderr(contains("failed to resolve repository; provide --repo"));
}

#[test]
fn api_errors_are_reported_to_the_user() {
    let env = CliTestEnv::new();
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123")
        .with_status(500)
        .with_body("boom")
        .create();

    env.command()
        .args(["runs", "show", "--trace-id", "trace-123"])
        .assert()
        .failure()
        .stderr(contains("CLI API request failed with 500"))
        .stderr(contains("boom"));

    mock.assert();
}

#[test]
fn wait_polls_until_head_sha_run_is_found() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-for-run",
        "git@github.com:everr-dev/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let first_poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-for-run".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(200)
        .with_body(format!(
            r#"{{"repo":"everr-dev/everr","branch":"feature/wait-for-run","commit":"{head_sha}","pipelineFound":false,"activeRuns":[],"completedRuns":[]}}"#
        ))
        .expect(1)
        .create();

    let second_poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-for-run".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(200)
        .with_body(format!(
            r#"{{"repo":"everr-dev/everr","branch":"feature/wait-for-run","commit":"{head_sha}","pipelineFound":true,"activeRuns":[{{"runId":"42","workflowName":"CI","htmlUrl":"https://github.com/everr-labs/everr/actions/runs/42","phase":"started","conclusion":"","lastEventTime":"2026-03-06T10:00:00Z","durationSeconds":125,"activeJobs":["test","lint"]}}],"completedRuns":[{{"runId":"41","workflowName":"Lint","htmlUrl":"https://github.com/everr-labs/everr/actions/runs/41","phase":"finished","conclusion":"success","lastEventTime":"2026-03-06T09:59:00Z","durationSeconds":59,"activeJobs":[]}}]}}"#
        ))
        .expect(1)
        .create();

    let third_poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-for-run".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(200)
        .with_body(format!(
            r#"{{"repo":"everr-dev/everr","branch":"feature/wait-for-run","commit":"{head_sha}","pipelineFound":true,"activeRuns":[],"completedRuns":[{{"runId":"42","workflowName":"CI","htmlUrl":"https://github.com/everr-labs/everr/actions/runs/42","phase":"finished","conclusion":"success","lastEventTime":"2026-03-06T10:01:00Z"}},{{"runId":"41","workflowName":"Lint","htmlUrl":"https://github.com/everr-labs/everr/actions/runs/41","phase":"finished","conclusion":"success","lastEventTime":"2026-03-06T09:59:00Z"}}]}}"#
        ))
        .expect(1)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "wait-pipeline",
            "--timeout-seconds",
            "2",
            "--interval-seconds",
            "0",
        ])
        .assert()
        .success()
        .stdout(contains("\"pipelineFound\": true"))
        .stdout(contains("\"runId\": \"42\""))
        .stdout(contains("\"runId\": \"41\""))
        .stderr(contains("Refresh rate: every 0s"))
        .stderr(contains(
            "Active runs:\n- CI (duration: 2m 5s; active jobs: test, lint)",
        ))
        .stderr(contains("Completed runs: Lint"))
        .stderr(predicate::str::contains("Elapsed: ").not())
        .stderr(predicate::str::contains("Last refresh: ").not());

    first_poll.assert();
    second_poll.assert();
    third_poll.assert();
}

#[test]
fn wait_uses_explicit_commit_when_provided() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-explicit-commit",
        "git@github.com:everr-dev/everr.git",
    );
    let target_commit = "deadbeefcafebabefeedface1234567890abcdef";
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded(
                "branch".into(),
                "feature/wait-explicit-commit".into(),
            ),
            Matcher::UrlEncoded("commit".into(), target_commit.into()),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(200)
        .with_body(format!(
            r#"{{"repo":"everr-dev/everr","branch":"feature/wait-explicit-commit","commit":"{target_commit}","pipelineFound":true,"activeRuns":[],"completedRuns":[{{"runId":"77","workflowName":"CI","htmlUrl":"https://github.com/everr-labs/everr/actions/runs/77","phase":"finished","conclusion":"success","lastEventTime":"2026-03-06T10:01:00Z"}}]}}"#
        ))
        .expect(1)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "wait-pipeline",
            "--commit",
            target_commit,
            "--timeout-seconds",
            "2",
            "--interval-seconds",
            "0",
        ])
        .assert()
        .success()
        .stdout(contains(
            "\"commit\": \"deadbeefcafebabefeedface1234567890abcdef\"",
        ))
        .stdout(contains("\"runId\": \"77\""));

    poll.assert();
}

#[test]
fn wait_accepts_short_commit_sha_prefix() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-short-commit",
        "git@github.com:everr-dev/everr.git",
    );
    let short_commit = "7f14b13";
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-short-commit".into()),
            Matcher::UrlEncoded("commit".into(), short_commit.into()),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(200)
        .with_body(format!(
            r#"{{"repo":"everr-dev/everr","branch":"feature/wait-short-commit","commit":"{short_commit}","pipelineFound":true,"activeRuns":[],"completedRuns":[{{"runId":"88","workflowName":"CI","htmlUrl":"https://github.com/everr-labs/everr/actions/runs/88","phase":"finished","conclusion":"success","lastEventTime":"2026-03-06T10:01:00Z"}}]}}"#
        ))
        .expect(1)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "wait-pipeline",
            "--commit",
            short_commit,
            "--timeout-seconds",
            "2",
            "--interval-seconds",
            "0",
        ])
        .assert()
        .success()
        .stdout(contains("\"commit\": \"7f14b13\""))
        .stdout(contains("\"runId\": \"88\""));

    poll.assert();
}

#[test]
fn wait_times_out_when_head_sha_is_not_found() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-timeout",
        "git@github.com:everr-dev/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-timeout".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(200)
        .with_body(format!(
            r#"{{"repo":"everr-dev/everr","branch":"feature/wait-timeout","commit":"{head_sha}","pipelineFound":true,"activeRuns":[{{"runId":"99","workflowName":"CI","htmlUrl":"https://github.com/everr-labs/everr/actions/runs/99","phase":"started","conclusion":"","lastEventTime":"2026-03-06T10:00:00Z","durationSeconds":3,"activeJobs":["test"]}}],"completedRuns":[]}}"#
        ))
        .expect(1)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "wait-pipeline",
            "--timeout-seconds",
            "0",
            "--interval-seconds",
            "0",
        ])
        .assert()
        .failure()
        .stderr(contains("timed out after 0s"))
        .stderr(contains("1 active run(s)"))
        .stderr(contains(&head_sha));

    poll.assert();
}

#[test]
fn wait_finishes_status_row_before_api_error() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-api-error",
        "git@github.com:everr-dev/everr.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let first_poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-api-error".into()),
            Matcher::UrlEncoded("commit".into(), git_head_sha(&repo_dir)),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(200)
        .with_body(format!(
            r#"{{"repo":"everr-dev/everr","branch":"feature/wait-api-error","commit":"{}","pipelineFound":false,"activeRuns":[],"completedRuns":[]}}"#,
            git_head_sha(&repo_dir)
        ))
        .expect(1)
        .create();

    let second_poll = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-dev/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-api-error".into()),
            Matcher::UrlEncoded("commit".into(), git_head_sha(&repo_dir)),
            Matcher::UrlEncoded("waitMode".into(), "pipeline".into()),
        ]))
        .with_status(500)
        .with_body("boom")
        .expect(1)
        .create();

    env.command()
        .current_dir(&repo_dir)
        .args([
            "wait-pipeline",
            "--timeout-seconds",
            "2",
            "--interval-seconds",
            "0",
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Elapsed: ").not())
        .stderr(contains(
            "\nError: CLI API request failed with 500 Internal Server Error: boom",
        ));

    first_poll.assert();
    second_poll.assert();
}

fn git_head_sha(repo_dir: &Path) -> String {
    let output = ProcessCommand::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_dir)
        .output()
        .expect("run git rev-parse");
    assert!(output.status.success(), "git rev-parse failed");
    String::from_utf8(output.stdout)
        .expect("head sha is utf8")
        .trim()
        .to_string()
}

#[test]
fn commands_require_existing_session() {
    let env = CliTestEnv::new();

    env.command()
        .args(["runs", "list"])
        .assert()
        .failure()
        .stderr(contains("no active session; run `everr login`"));
}
