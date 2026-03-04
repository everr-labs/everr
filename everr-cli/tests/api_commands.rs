mod support;

use mockito::{Matcher, Server};
use predicates::str::contains;
use support::CliTestEnv;

#[test]
fn status_command_sends_expected_query_and_auth_header() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/tests",
        "git@github.com:citric-app/citric.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-123");

    let mock = server
        .mock("GET", "/api/cli/status")
        .match_header("authorization", "Bearer token-123")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "citric-app/citric".into()),
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
        "git@github.com:citric-app/citric.git",
    );
    let mut server = Server::new();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "citric-app/citric".into()),
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
fn commands_require_existing_session() {
    let env = CliTestEnv::new();

    env.command()
        .args(["runs", "list"])
        .assert()
        .failure()
        .stderr(contains("no active session; run `everr login`"));
}
