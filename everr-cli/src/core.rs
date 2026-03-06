use std::fmt::Write as _;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde_json::Value;
use tokio::time::sleep;

use crate::api::ApiClient;
use crate::auth;
use crate::cli::{GetLogsArgs, ListRunsArgs, ShowRunArgs, StatusArgs, TestHistoryArgs, WaitArgs};

pub async fn status(args: StatusArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let git = resolve_git_context(std::env::current_dir()?);
    let repo = args.repo.or(git.repo);
    let branch = args.branch.or(git.branch);

    let mut query: Vec<(&str, String)> = Vec::new();
    push_opt(&mut query, "repo", repo);
    push_opt(&mut query, "branch", branch);
    push_opt(&mut query, "mainBranch", args.main_branch);
    push_opt(&mut query, "from", args.from);
    push_opt(&mut query, "to", args.to);

    let payload = client.get_status(&query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn runs_list(args: ListRunsArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let git = resolve_git_context(std::env::current_dir()?);
    let repo = args.repo.or(git.repo);
    let branch = args.branch.or(git.branch);

    let mut query: Vec<(&str, String)> = Vec::new();
    push_opt(&mut query, "repo", repo);
    push_opt(&mut query, "branch", branch);
    push_opt(&mut query, "conclusion", args.conclusion);
    push_opt(&mut query, "workflowName", args.workflow_name);
    push_opt(&mut query, "runId", args.run_id);
    if let Some(page) = args.page {
        query.push(("page", page.to_string()));
    }
    push_opt(&mut query, "from", args.from);
    push_opt(&mut query, "to", args.to);

    let payload = client.get_runs_list(&query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn runs_show(args: ShowRunArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let payload = client.get_run_details(&args.trace_id).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn runs_logs(args: GetLogsArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let query = vec![
        ("jobName", args.job_name),
        ("stepNumber", args.step_number),
        ("fullLogs", args.full.to_string()),
    ];
    let payload = client.get_step_logs(&args.trace_id, &query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn test_history(args: TestHistoryArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let git = resolve_git_context(std::env::current_dir()?);
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;
    if args.test_module.is_none() && args.test_name.is_none() {
        bail!("provide at least one test filter: --module or --test-name");
    }
    let mut query: Vec<(&str, String)> = vec![("repo", repo)];
    push_opt(&mut query, "testModule", args.test_module);
    push_opt(&mut query, "testName", args.test_name);
    push_opt(&mut query, "from", args.from);
    push_opt(&mut query, "to", args.to);

    let payload = client.get_test_history(&query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn wait(args: WaitArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(cwd.clone());
    let target_commit = args
        .commit
        .or_else(|| run_git(["rev-parse", "HEAD"], &cwd))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "failed to resolve target commit; pass --commit <sha> or run from a git repository"
            )
        })?;
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;
    let branch = args
        .branch
        .or(git.branch)
        .ok_or_else(|| anyhow::anyhow!("failed to resolve branch; provide --branch"))?;

    let query = vec![
        ("repo", repo.clone()),
        ("branch", branch.clone()),
        ("commit", target_commit.clone()),
        ("waitMode", "pipeline".to_string()),
    ];
    let start = Instant::now();
    let mut wait_status_lines = 0usize;
    loop {
        let payload = match client.get_wait_pipeline_status(&query).await {
            Ok(payload) => payload,
            Err(error) => {
                finish_wait_status_block(wait_status_lines)?;
                return Err(error);
            }
        };

        let pipeline_found = payload
            .get("pipelineFound")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let active_runs = payload
            .get("activeRuns")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if pipeline_found && active_runs == 0 {
            finish_wait_status_block(wait_status_lines)?;
            print_json(&payload)?;
            return Ok(());
        }

        if let Some(timeout_seconds) = args.timeout_seconds {
            if start.elapsed() >= Duration::from_secs(timeout_seconds) {
                finish_wait_status_block(wait_status_lines)?;
                if pipeline_found {
                    bail!(
                        "timed out after {}s waiting for {} active run(s) to finish for commit {} on {repo}@{branch}",
                        timeout_seconds,
                        active_runs,
                        target_commit
                    );
                }

                bail!(
                    "timed out after {}s waiting for commit {} to appear in pipeline events for {repo}@{branch}",
                    timeout_seconds,
                    target_commit
                );
            }
        }

        let status = if pipeline_found {
            format_wait_status(
                &target_commit,
                args.interval_seconds,
                extract_wait_runs(&payload, "activeRuns"),
                extract_named_values(&payload, "completedRuns", "workflowName"),
            )
        } else {
            format_wait_status(
                &target_commit,
                args.interval_seconds,
                Vec::new(),
                Vec::new(),
            )
        };
        render_wait_status_block(&status, &mut wait_status_lines)?;

        sleep(Duration::from_secs(args.interval_seconds)).await;
    }
}

fn print_json(value: &Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

struct WaitRunStatus {
    workflow_name: String,
    duration_seconds: u64,
    active_jobs: Vec<String>,
}

fn format_wait_status(
    target_commit: &str,
    interval_seconds: u64,
    active_runs: Vec<WaitRunStatus>,
    completed_run_names: Vec<String>,
) -> String {
    let mut status = String::new();
    let short_commit = shorten_commit(target_commit);
    let _ = writeln!(status, "Waiting for pipeline for commit {short_commit}");
    let _ = writeln!(status, "Refresh rate: every {interval_seconds}s");
    if active_runs.is_empty() {
        let _ = writeln!(status, "Active runs: none");
    } else {
        let _ = writeln!(status, "Active runs:");
        for run in active_runs {
            let _ = writeln!(
                status,
                "- {} (duration: {}; active jobs: {})",
                run.workflow_name,
                format_elapsed_duration(run.duration_seconds),
                format_name_list(&run.active_jobs)
            );
        }
    }
    let _ = writeln!(
        status,
        "Completed runs: {}",
        format_name_list(&completed_run_names)
    );
    status
}

fn render_wait_status_block(message: &str, last_lines: &mut usize) -> Result<()> {
    let display = message.trim_end_matches('\n');
    clear_wait_status_block(*last_lines);
    io::stderr()
        .flush()
        .context("failed to flush wait-pipeline status block")?;

    eprint!("{display}");
    io::stderr()
        .flush()
        .context("failed to flush wait-pipeline status block")?;
    *last_lines = display.lines().count();
    Ok(())
}

fn finish_wait_status_block(last_lines: usize) -> Result<()> {
    if last_lines == 0 {
        return Ok(());
    }

    eprintln!();
    io::stderr()
        .flush()
        .context("failed to flush wait-pipeline trailing newline")
}

fn clear_wait_status_block(line_count: usize) {
    for index in 0..line_count {
        eprint!("\r\x1b[2K");
        if index + 1 < line_count {
            eprint!("\x1b[1A");
        }
    }
    if line_count > 0 {
        eprint!("\r");
    }
}

fn extract_wait_runs(payload: &Value, key: &str) -> Vec<WaitRunStatus> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| WaitRunStatus {
            workflow_name: item
                .get("workflowName")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            duration_seconds: item
                .get("durationSeconds")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            active_jobs: item
                .get("activeJobs")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect(),
        })
        .collect()
}

fn extract_named_values(payload: &Value, key: &str, field: &str) -> Vec<String> {
    payload
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get(field).and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .collect()
}

fn format_name_list(names: &[String]) -> String {
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}

fn shorten_commit(commit: &str) -> &str {
    let max_len = 12;
    if commit.len() <= max_len {
        commit
    } else {
        &commit[..max_len]
    }
}

fn format_elapsed_duration(total_seconds: u64) -> String {
    if total_seconds < 60 {
        return format!("{total_seconds}s");
    }

    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;
    format!("{minutes}m {seconds}s")
}

fn run_git<const N: usize>(args: [&str; N], cwd: &PathBuf) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_branch_name(raw: String) -> String {
    if raw == "HEAD" {
        return raw;
    }
    match raw.strip_prefix("refs/heads/") {
        Some(stripped) => stripped.to_string(),
        None => raw,
    }
}

fn parse_repo_from_remote_url(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim();
    if let Some(ssh) = regex_like_extract(trimmed, '@', ':') {
        if let Some(repo) = strip_dot_git(ssh) {
            return Some(repo);
        }
    }

    if trimmed.contains("://") {
        return parse_repo_from_http_remote_url(trimmed);
    }

    let path = trimmed.rsplit('/').take(2).collect::<Vec<_>>();
    if path.len() == 2 {
        let repo = format!("{}/{}", path[1], path[0]);
        return strip_dot_git(repo);
    }
    None
}

fn parse_repo_from_http_remote_url(remote_url: &str) -> Option<String> {
    let (_, authority_and_path) = remote_url.split_once("://")?;
    let (_, path) = authority_and_path.split_once('/')?;
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let owner = segments.next()?;
    let repo = segments.next()?;
    strip_dot_git(format!("{owner}/{repo}"))
}

fn regex_like_extract(input: &str, at: char, colon: char) -> Option<String> {
    let at_index = input.find(at)?;
    let colon_index = input[at_index..].find(colon)? + at_index;
    let repo = input.get(colon_index + 1..)?;
    Some(repo.to_string())
}

fn strip_dot_git(input: String) -> Option<String> {
    let value = input.trim().trim_end_matches(".git").to_string();
    if value.contains('/') {
        Some(value)
    } else {
        None
    }
}

fn push_opt(query: &mut Vec<(&str, String)>, key: &'static str, value: Option<String>) {
    if let Some(v) = value {
        query.push((key, v));
    }
}

struct GitContext {
    repo: Option<String>,
    branch: Option<String>,
}

fn resolve_git_context(cwd: PathBuf) -> GitContext {
    let branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"], &cwd).map(normalize_branch_name);
    let origin = run_git(["config", "--get", "remote.origin.url"], &cwd);
    let repo = origin.as_deref().and_then(parse_repo_from_remote_url);
    GitContext { repo, branch }
}

#[cfg(test)]
mod tests {
    use super::{
        WaitRunStatus, format_wait_status, normalize_branch_name, parse_repo_from_remote_url,
        push_opt,
    };

    #[test]
    fn normalize_branch_name_strips_local_ref_prefix() {
        assert_eq!(
            normalize_branch_name("refs/heads/feature/refactor".to_string()),
            "feature/refactor"
        );
        assert_eq!(normalize_branch_name("HEAD".to_string()), "HEAD");
    }

    #[test]
    fn parse_repo_from_remote_supports_ssh_and_http_urls() {
        assert_eq!(
            parse_repo_from_remote_url("git@github.com:citric-app/citric.git"),
            Some("citric-app/citric".to_string())
        );
        assert_eq!(
            parse_repo_from_remote_url("https://github.com/citric-app/citric.git"),
            Some("citric-app/citric".to_string())
        );
        assert_eq!(
            parse_repo_from_remote_url("http://github.com/citric-app/citric"),
            Some("citric-app/citric".to_string())
        );
    }

    #[test]
    fn parse_repo_from_remote_rejects_invalid_values() {
        assert_eq!(
            parse_repo_from_remote_url("https://github.com/citric-app"),
            None
        );
        assert_eq!(parse_repo_from_remote_url("citric-app"), None);
        assert_eq!(parse_repo_from_remote_url(""), None);
    }

    #[test]
    fn push_opt_only_includes_present_values() {
        let mut query = Vec::new();
        push_opt(&mut query, "repo", Some("citric-app/citric".to_string()));
        push_opt(&mut query, "branch", None);

        assert_eq!(query, vec![("repo", "citric-app/citric".to_string())]);
    }

    #[test]
    fn wait_status_output_has_no_trailing_blank_line() {
        let status = format_wait_status(
            "df0c52b63dfa0123456789",
            5,
            vec![WaitRunStatus {
                workflow_name: "Build & Test Collector".to_string(),
                duration_seconds: 139,
                active_jobs: vec!["Lint".to_string(), "Build".to_string()],
            }],
            vec!["Build & Test Ingress".to_string()],
        );

        assert!(status.ends_with('\n'));
        let display = status.trim_end_matches('\n');
        assert!(!display.ends_with('\n'));
        assert_eq!(display.lines().count(), 5);
    }
}
