mod support;

use std::path::Path;
use std::process::Command as ProcessCommand;

use mockito::Matcher;
use predicates::prelude::*;
use predicates::str::contains;
use support::{CliTestEnv, mock_api_server};

#[test]
fn status_command_sends_commit_query_to_runs_endpoint() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/tests",
        "git@github.com:everr-labs/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-123");

    let mock = server
        .mock("GET", "/api/cli/runs/status")
        .match_header("authorization", "Bearer token-123")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/tests".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
        ]))
        .with_status(200)
        .with_body(r#"{"state":"completed","active":[],"completed":[]}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["status"])
        .assert()
        .success()
        .stdout(contains("\"state\": \"completed\""));

    mock.assert();
}

#[test]
fn status_uses_explicit_commit_when_provided() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/status-commit",
        "git@github.com:everr-labs/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-123");

    let mock = server
        .mock("GET", "/api/cli/runs/status")
        .match_header("authorization", "Bearer token-123")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/status-commit".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
        ]))
        .with_status(200)
        .with_body(r#"{"state":"completed","active":[],"completed":[]}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["status", "--commit", &head_sha])
        .assert()
        .success()
        .stdout(contains("\"state\": \"completed\""));

    mock.assert();
}

#[test]
fn grep_defaults_repo_from_git_and_excludes_current_branch() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/current-issue",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-grep");

    let mock = server
        .mock("GET", "/api/cli/grep")
        .match_header("authorization", "Bearer token-grep")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("pattern".into(), "Expect X to be Y".into()),
            Matcher::UrlEncoded("jobName".into(), "integration".into()),
            Matcher::UrlEncoded("stepNumber".into(), "5".into()),
            Matcher::UrlEncoded("excludeBranch".into(), "feature/current-issue".into()),
            Matcher::UrlEncoded("limit".into(), "20".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"items":[]}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args([
            "grep",
            "--job-name",
            "integration",
            "--step-number",
            "5",
            "--pattern",
            "Expect X to be Y",
        ])
        .assert()
        .success()
        .stdout(contains("\"items\": []"));

    mock.assert();
}

#[test]
fn grep_uses_explicit_branch_instead_of_auto_excluding_current_branch() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/current-issue",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-grep");

    let mock = server
        .mock("GET", "/api/cli/grep")
        .match_header("authorization", "Bearer token-grep")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("pattern".into(), "panic".into()),
            Matcher::UrlEncoded("limit".into(), "5".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
            Matcher::UrlEncoded("branch".into(), "release/1.2".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"items":[]}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args([
            "grep",
            "--pattern",
            "panic",
            "--branch",
            "release/1.2",
            "--limit",
            "5",
        ])
        .assert()
        .success()
        .stdout(contains("\"items\": []"));

    mock.assert();
}

#[test]
fn grep_requires_repo_when_git_context_is_missing() {
    let env = CliTestEnv::new();
    let server = mock_api_server();
    env.write_session(&server.url(), "token-grep");

    env.command_with_api_base_url(&server.url())
        .current_dir(&env.home_dir)
        .args(["grep", "--pattern", "panic"])
        .assert()
        .failure()
        .stderr(contains("failed to resolve repository; provide --repo"));
}

#[test]
fn runs_list_sends_filter_query_params() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/tests",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/tests".into()),
            Matcher::UrlEncoded("conclusion".into(), "failure".into()),
            Matcher::UrlEncoded("workflowName".into(), "Build & Test App".into()),
            Matcher::UrlEncoded("runId".into(), "42".into()),
            Matcher::UrlEncoded("limit".into(), "20".into()),
            Matcher::UrlEncoded("offset".into(), "20".into()),
            Matcher::UrlEncoded("from".into(), "now-2h".into()),
            Matcher::UrlEncoded("to".into(), "now".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"runs":[],"totalCount":0}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args([
            "runs",
            "--branch",
            "feature/tests",
            "--conclusion",
            "failure",
            "--workflow-name",
            "Build & Test App",
            "--run-id",
            "42",
            "--offset",
            "20",
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
fn runs_list_does_not_default_branch_without_current_branch_flag() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/default-branch",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("limit".into(), "20".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"runs":[],"totalCount":0}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["runs"])
        .assert()
        .success()
        .stdout(contains("\"runs\": []"));

    mock.assert();
}

#[test]
fn runs_list_uses_current_branch_when_flag_is_passed() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/default-branch",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/default-branch".into()),
            Matcher::UrlEncoded("limit".into(), "20".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"runs":[],"totalCount":0}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["runs", "--current-branch"])
        .assert()
        .success()
        .stdout(contains("\"runs\": []"));

    mock.assert();
}

#[test]
fn runs_show_calls_trace_id_endpoint() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123")
        .match_header("authorization", "Bearer token-abc")
        .with_status(200)
        .with_body(r#"{"run":{"traceId":"trace-123"},"jobs":[],"steps":{}}"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .args(["show", "--trace-id", "trace-123"])
        .assert()
        .success()
        .stdout(contains("\"traceId\": \"trace-123\""));

    mock.assert();
}

#[test]
fn runs_logs_prints_plain_text_by_default() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123/logs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("jobName".into(), "build".into()),
            Matcher::UrlEncoded("stepNumber".into(), "2".into()),
            Matcher::UrlEncoded("tail".into(), "1000".into()),
        ]))
        .with_status(200)
        .with_body(
            r#"[{"timestamp":"2026-03-10T10:00:00.000Z","body":"Starting build"},{"timestamp":"2026-03-10T10:00:01.000Z","body":"Compiling"}]"#,
        )
        .create();

    env.command_with_api_base_url(&server.url())
        .args([
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
        .stdout(predicate::str::diff("Starting build\nCompiling\n"))
        .stderr(predicate::str::is_empty());

    mock.assert();
}

#[test]
fn runs_logs_offset_without_limit_uses_tail_mode() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123/logs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("jobName".into(), "build".into()),
            Matcher::UrlEncoded("stepNumber".into(), "2".into()),
            Matcher::UrlEncoded("tail".into(), "1000".into()),
            Matcher::UrlEncoded("offset".into(), "1000".into()),
        ]))
        .with_status(200)
        .with_body(r#"[{"timestamp":"2026-03-10T10:16:40.000Z","body":"paged line"}]"#)
        .create();

    env.command_with_api_base_url(&server.url())
        .args([
            "logs",
            "--trace-id",
            "trace-123",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--offset",
            "1000",
        ])
        .assert()
        .success()
        .stdout(predicate::str::diff("paged line\n"))
        .stderr(predicate::str::is_empty());

    mock.assert();
}

#[test]
fn runs_logs_prints_more_logs_footer_when_page_is_truncated() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123/logs")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("jobName".into(), "build".into()),
            Matcher::UrlEncoded("stepNumber".into(), "2".into()),
            Matcher::UrlEncoded("limit".into(), "3".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(
            r#"[{"timestamp":"2026-03-10T10:00:00.000Z","body":"line 1"},{"timestamp":"2026-03-10T10:00:01.000Z","body":"line 2"},{"timestamp":"2026-03-10T10:00:02.000Z","body":"line 3"}]"#,
        )
        .create();

    env.command_with_api_base_url(&server.url())
        .args([
            "logs",
            "--trace-id",
            "trace-123",
            "--job-name",
            "build",
            "--step-number",
            "2",
            "--limit",
            "2",
        ])
        .assert()
        .success()
        .stdout(predicate::str::diff("line 1\nline 2\n"))
        .stderr(contains(
            "More logs available. Rerun with --limit 2 --offset 2 to continue.",
        ));

    mock.assert();
}

#[test]
fn test_history_sends_expected_query_and_auth_header() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/test-history",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-xyz");

    let mock = server
        .mock("GET", "/api/cli/test-history")
        .match_header("authorization", "Bearer token-xyz")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("testModule".into(), "suite".into()),
            Matcher::UrlEncoded("testName".into(), "test".into()),
            Matcher::UrlEncoded("from".into(), "now-7d".into()),
            Matcher::UrlEncoded("to".into(), "now".into()),
            Matcher::UrlEncoded("limit".into(), "100".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(r#"[{"traceId":"trace-1","testResult":"pass"}]"#)
        .create();

    env.command_with_api_base_url(&server.url())
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
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-xyz");

    let mock = server
        .mock("GET", "/api/cli/test-history")
        .match_header("authorization", "Bearer token-xyz")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("testName".into(), "my-test".into()),
            Matcher::UrlEncoded("limit".into(), "100".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(r#"[]"#)
        .create();

    env.command_with_api_base_url(&server.url())
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
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-xyz");

    let mock = server
        .mock("GET", "/api/cli/test-history")
        .match_header("authorization", "Bearer token-xyz")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("testModule".into(), "suite".into()),
            Matcher::UrlEncoded("limit".into(), "100".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(r#"[]"#)
        .create();

    env.command_with_api_base_url(&server.url())
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
    let server = mock_api_server();
    env.write_session(&server.url(), "token-xyz");

    env.command_with_api_base_url(&server.url())
        .args(["test-history", "--repo", "everr-labs/everr"])
        .assert()
        .failure()
        .stderr(contains(
            "provide at least one test filter: --module or --test-name",
        ));
}

#[test]
fn test_history_requires_repo_when_git_context_is_missing() {
    let env = CliTestEnv::new();
    let server = mock_api_server();
    env.write_session(&server.url(), "token-xyz");

    env.command_with_api_base_url(&server.url())
        .current_dir(&env.home_dir)
        .args(["test-history", "--test-name", "suite/test"])
        .assert()
        .failure()
        .stderr(contains("failed to resolve repository; provide --repo"));
}

#[test]
fn slowest_tests_defaults_to_repo_wide_query_and_auth_header() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/slow-tests",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-slow");

    let mock = server
        .mock("GET", "/api/cli/slowest-tests")
        .match_header("authorization", "Bearer token-slow")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("from".into(), "now-24h".into()),
            Matcher::UrlEncoded("to".into(), "now".into()),
            Matcher::UrlEncoded("limit".into(), "15".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(
            r#"{"repo":"everr-labs/everr","branch":null,"timeRange":{"from":"now-24h","to":"now"},"limit":15,"items":[{"testFullName":"suite/test","avgDurationSeconds":12.5}]}"#,
        )
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args([
            "slowest-tests",
            "--from",
            "now-24h",
            "--to",
            "now",
            "--limit",
            "15",
        ])
        .assert()
        .success()
        .stdout(contains("\"testFullName\": \"suite/test\""));

    mock.assert();
}

#[test]
fn slowest_tests_requires_repo_when_git_context_is_missing() {
    let env = CliTestEnv::new();
    let server = mock_api_server();
    env.write_session(&server.url(), "token-slow");

    env.command_with_api_base_url(&server.url())
        .current_dir(&env.home_dir)
        .args(["slowest-tests"])
        .assert()
        .failure()
        .stderr(contains("failed to resolve repository; provide --repo"));
}

#[test]
fn slowest_tests_respects_explicit_branch_filter() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/slow-tests",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-slow-branch");

    let mock = server
        .mock("GET", "/api/cli/slowest-tests")
        .match_header("authorization", "Bearer token-slow-branch")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "main".into()),
            Matcher::UrlEncoded("limit".into(), "10".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(
            r#"{"repo":"everr-labs/everr","branch":"main","timeRange":{"from":"now-7d","to":"now"},"limit":10,"items":[]}"#,
        )
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["slowest-tests", "--branch", "main"])
        .assert()
        .success()
        .stdout(contains("\"branch\": \"main\""));

    mock.assert();
}

#[test]
fn slowest_jobs_defaults_to_repo_wide_query_and_auth_header() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/slow-jobs",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-jobs");

    let mock = server
        .mock("GET", "/api/cli/slowest-jobs")
        .match_header("authorization", "Bearer token-jobs")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("limit".into(), "5".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(
            r#"{"repo":"everr-labs/everr","branch":null,"timeRange":{"from":"now-7d","to":"now"},"limit":5,"items":[{"workflowName":"CI","jobName":"integration","avgDurationSeconds":420.0}]}"#,
        )
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["slowest-jobs", "--limit", "5"])
        .assert()
        .success()
        .stdout(contains("\"jobName\": \"integration\""));

    mock.assert();
}

#[test]
fn slowest_jobs_respects_explicit_branch_filter() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/slow-jobs",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-jobs-branch");

    let mock = server
        .mock("GET", "/api/cli/slowest-jobs")
        .match_header("authorization", "Bearer token-jobs-branch")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "release".into()),
            Matcher::UrlEncoded("limit".into(), "10".into()),
            Matcher::UrlEncoded("offset".into(), "0".into()),
        ]))
        .with_status(200)
        .with_body(
            r#"{"repo":"everr-labs/everr","branch":"release","timeRange":{"from":"now-7d","to":"now"},"limit":10,"items":[]}"#,
        )
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["slowest-jobs", "--branch", "release"])
        .assert()
        .success()
        .stdout(contains("\"branch\": \"release\""));

    mock.assert();
}

#[test]
fn api_errors_are_reported_to_the_user() {
    let env = CliTestEnv::new();
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/trace-123")
        .with_status(500)
        .with_body("boom")
        .create();

    env.command_with_api_base_url(&server.url())
        .args(["show", "--trace-id", "trace-123"])
        .assert()
        .failure()
        .stderr(contains("CLI API request failed with 500"))
        .stderr(contains("boom"));

    mock.assert();
}

#[test]
fn watch_receives_sse_events_until_completion() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-for-run",
        "git@github.com:everr-labs/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let sse_body = [
        "event: message\ndata: {\"state\":\"running\",\"active\":[{\"runId\":\"42\",\"traceId\":\"mock-trace-id-1\",\"workflowName\":\"CI\",\"conclusion\":null,\"startedAt\":\"2026-03-06T10:00:00Z\",\"durationSeconds\":null,\"expectedDurationSeconds\":118,\"activeJobs\":[\"test\",\"lint\"]}],\"completed\":[{\"runId\":\"41\",\"traceId\":\"mock-trace-id-2\",\"workflowName\":\"Lint\",\"conclusion\":\"success\",\"startedAt\":\"2026-03-06T09:58:01Z\",\"durationSeconds\":59,\"expectedDurationSeconds\":57,\"activeJobs\":[]}]}\n\n",
        "event: message\ndata: {\"state\":\"completed\",\"active\":[],\"completed\":[{\"runId\":\"42\",\"traceId\":\"mock-trace-id-1\",\"workflowName\":\"CI\",\"conclusion\":\"success\",\"startedAt\":\"2026-03-06T10:00:00Z\",\"durationSeconds\":61,\"expectedDurationSeconds\":null,\"activeJobs\":[]},{\"runId\":\"41\",\"traceId\":\"mock-trace-id-2\",\"workflowName\":\"Lint\",\"conclusion\":\"success\",\"startedAt\":\"2026-03-06T09:58:01Z\",\"durationSeconds\":59,\"expectedDurationSeconds\":null,\"activeJobs\":[]}]}\n\n",
    ].join("");

    let mock = server
        .mock("GET", "/api/cli/runs/watch")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-for-run".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
        ]))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .expect(1)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["watch"])
        .assert()
        .success()
        .stdout(contains("\"state\": \"completed\""))
        .stdout(contains("\"runId\": \"42\""))
        .stdout(contains("\"runId\": \"41\""))
        .stderr(contains("Watching pipeline for commit"))
        .stderr(contains("Active runs:\n- CI [mock-trace-id-1] (started at:"))
        .stderr(contains("expected duration: 1m 58s; active jobs: test, lint)"))
        .stderr(contains("Completed runs: Lint [mock-trace-id-2]"));

    mock.assert();
}

#[test]
fn watch_exits_when_completed_runs_exist_even_without_pipeline_found() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/watch-completed-runs",
        "git@github.com:everr-labs/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let sse_body = "event: message\ndata: {\"state\":\"completed\",\"active\":[],\"completed\":[{\"runId\":\"52\",\"traceId\":\"mock-trace-id-3\",\"workflowName\":\"CI\",\"conclusion\":\"success\",\"startedAt\":\"2026-03-06T10:00:00Z\",\"durationSeconds\":61,\"expectedDurationSeconds\":null,\"activeJobs\":[]}]}\n\n";

    let mock = server
        .mock("GET", "/api/cli/runs/watch")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/watch-completed-runs".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
        ]))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .expect(1)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["watch"])
        .assert()
        .success()
        .stdout(contains("\"state\": \"completed\""))
        .stdout(contains("\"runId\": \"52\""))
        .stderr(predicate::str::contains("Watching pipeline for commit").not());

    mock.assert();
}

#[test]
fn watch_uses_explicit_commit_when_provided() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-explicit-commit",
        "git@github.com:everr-labs/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let sse_body = "event: message\ndata: {\"state\":\"completed\",\"active\":[],\"completed\":[{\"runId\":\"77\",\"traceId\":\"mock-trace-id-4\",\"workflowName\":\"CI\",\"conclusion\":\"success\",\"startedAt\":\"2026-03-06T10:00:00Z\",\"durationSeconds\":61,\"expectedDurationSeconds\":null,\"activeJobs\":[]}]}\n\n";

    let mock = server
        .mock("GET", "/api/cli/runs/watch")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
        ]))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .expect(1)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["watch", "--commit", &head_sha])
        .assert()
        .success()
        .stdout(contains("\"state\": \"completed\""))
        .stdout(contains("\"runId\": \"77\""));

    mock.assert();
}

#[test]
fn watch_resolves_short_commit_sha_to_full() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-short-commit",
        "git@github.com:everr-labs/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let short_sha = &head_sha[..7];
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let sse_body = "event: message\ndata: {\"state\":\"completed\",\"active\":[],\"completed\":[{\"runId\":\"88\",\"traceId\":\"mock-trace-id-5\",\"workflowName\":\"CI\",\"conclusion\":\"success\",\"startedAt\":\"2026-03-06T10:00:00Z\",\"durationSeconds\":61,\"expectedDurationSeconds\":null,\"activeJobs\":[]}]}\n\n";

    let mock = server
        .mock("GET", "/api/cli/runs/watch")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
        ]))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .expect(1)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["watch", "--commit", short_sha])
        .assert()
        .success()
        .stdout(contains("\"state\": \"completed\""))
        .stdout(contains("\"runId\": \"88\""));

    mock.assert();
}

#[test]
fn watch_fails_when_completed_runs_include_failure() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-failed-run",
        "git@github.com:everr-labs/everr.git",
    );
    let head_sha = git_head_sha(&repo_dir);
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let sse_body = "event: message\ndata: {\"state\":\"completed\",\"active\":[],\"completed\":[{\"runId\":\"88\",\"traceId\":\"mock-trace-id-6\",\"workflowName\":\"CI\",\"conclusion\":\"failure\",\"startedAt\":\"2026-03-06T10:00:00Z\",\"durationSeconds\":61,\"expectedDurationSeconds\":null,\"activeJobs\":[]}]}\n\n";

    let mock = server
        .mock("GET", "/api/cli/runs/watch")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-failed-run".into()),
            Matcher::UrlEncoded("commit".into(), head_sha.clone()),
        ]))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body)
        .expect(1)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["watch"])
        .assert()
        .failure()
        .stdout(contains("\"conclusion\": \"failure\""))
        .stderr(contains("pipeline finished with failed run(s): CI"));

    mock.assert();
}

#[test]
fn watch_fails_on_sse_connection_error() {
    let env = CliTestEnv::new();
    let repo_dir = env.init_git_repo(
        "repo",
        "feature/wait-api-error",
        "git@github.com:everr-labs/everr.git",
    );
    let mut server = mock_api_server();

    env.write_session(&server.url(), "token-abc");

    let mock = server
        .mock("GET", "/api/cli/runs/watch")
        .match_header("authorization", "Bearer token-abc")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("repo".into(), "everr-labs/everr".into()),
            Matcher::UrlEncoded("branch".into(), "feature/wait-api-error".into()),
            Matcher::UrlEncoded("commit".into(), git_head_sha(&repo_dir)),
        ]))
        .with_status(500)
        .with_body("boom")
        .expect(1)
        .create();

    env.command_with_api_base_url(&server.url())
        .current_dir(&repo_dir)
        .args(["watch"])
        .assert()
        .failure()
        .stderr(contains("SSE connection failed with 500"))
        .stderr(contains("boom"));

    mock.assert();
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
        .args(["runs"])
        .assert()
        .failure()
        .stderr(contains("no active session; run `everr login`"));
}
