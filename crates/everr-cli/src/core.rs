use std::fmt::Write as _;
use std::io::{self, Write};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use everr_core::git::{resolve_git_context, run_git};
use serde_json::Value;
use tokio::time::sleep;

use crate::api::ApiClient;
use crate::auth;
use crate::cli::{
    GetLogsArgs, GrepArgs, ListRunsArgs, ShowRunArgs, SlowestJobsArgs, SlowestTestsArgs,
    StatusArgs, TestHistoryArgs, WaitArgs,
};

pub async fn status(args: StatusArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
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

pub async fn grep(args: GrepArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;
    let branch = args.branch;
    let exclude_branch = if branch.is_some() { None } else { git.branch };

    let mut query: Vec<(&str, String)> = vec![
        ("repo", repo),
        ("pattern", args.pattern),
        ("limit", args.limit.to_string()),
    ];
    push_opt(&mut query, "jobName", args.job_name);
    push_opt(&mut query, "stepNumber", args.step_number);
    push_opt(&mut query, "branch", branch);
    push_opt(&mut query, "excludeBranch", exclude_branch);
    push_opt(&mut query, "from", args.from);
    push_opt(&mut query, "to", args.to);

    let payload = client.get_grep(&query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn runs_list(args: ListRunsArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
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
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
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

pub async fn slowest_tests(args: SlowestTestsArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;

    let mut query: Vec<(&str, String)> = vec![("repo", repo), ("limit", args.limit.to_string())];
    push_opt(&mut query, "branch", args.branch);
    push_opt(&mut query, "from", args.from);
    push_opt(&mut query, "to", args.to);

    let payload = client.get_slowest_tests(&query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn slowest_jobs(args: SlowestJobsArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;

    let mut query: Vec<(&str, String)> = vec![("repo", repo), ("limit", args.limit.to_string())];
    push_opt(&mut query, "branch", args.branch);
    push_opt(&mut query, "from", args.from);
    push_opt(&mut query, "to", args.to);

    let payload = client.get_slowest_jobs(&query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn wait(args: WaitArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
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
        let active_runs = extract_wait_runs(&payload, "activeRuns");
        let completed_runs = extract_wait_runs(&payload, "completedRuns");

        if pipeline_found && active_runs.is_empty() {
            finish_wait_status_block(wait_status_lines)?;
            print_json(&payload)?;
            let failed_runs = failed_wait_run_names(&completed_runs);
            if !failed_runs.is_empty() {
                bail!(
                    "pipeline finished with failed run(s): {}",
                    failed_runs.join(", ")
                );
            }
            return Ok(());
        }

        if let Some(timeout_seconds) = args.timeout_seconds {
            if start.elapsed() >= Duration::from_secs(timeout_seconds) {
                finish_wait_status_block(wait_status_lines)?;
                if pipeline_found {
                    bail!(
                        "timed out after {}s waiting for {} active run(s) to finish for commit {} on {repo}@{branch}",
                        timeout_seconds,
                        active_runs.len(),
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
                active_runs,
                completed_runs,
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
    conclusion: String,
    duration_seconds: u64,
    usual_duration_seconds: Option<u64>,
    active_jobs: Vec<String>,
}

fn format_wait_status(
    target_commit: &str,
    interval_seconds: u64,
    active_runs: Vec<WaitRunStatus>,
    completed_runs: Vec<WaitRunStatus>,
) -> String {
    let mut status = String::new();
    let short_commit = shorten_commit(target_commit);
    let _ = writeln!(
        status,
        "Waiting for pipeline for commit {short_commit} (refresh: {interval_seconds}s)"
    );
    if active_runs.is_empty() {
        let _ = writeln!(status, "Active runs: none");
    } else {
        let _ = writeln!(status, "Active runs:");
        for run in active_runs {
            let mut details = vec![format!(
                "duration: {}",
                format_elapsed_duration(run.duration_seconds)
            )];
            if let Some(usual_duration_seconds) = run.usual_duration_seconds {
                details.push(format!(
                    "usually takes: {}",
                    format_elapsed_duration(usual_duration_seconds)
                ));
            }
            details.push(format!(
                "active jobs: {}",
                format_name_list(&run.active_jobs)
            ));
            let _ = writeln!(status, "- {} ({})", run.workflow_name, details.join("; "));
        }
    }
    let _ = writeln!(
        status,
        "Completed runs: {}",
        format_completed_run_list(&completed_runs)
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
            conclusion: item
                .get("conclusion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            duration_seconds: item
                .get("durationSeconds")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            usual_duration_seconds: item.get("usualDurationSeconds").and_then(Value::as_u64),
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

fn format_name_list(names: &[String]) -> String {
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}

fn format_completed_run_list(runs: &[WaitRunStatus]) -> String {
    if runs.is_empty() {
        return "none".to_string();
    }

    let mut formatted = String::new();
    for (index, run) in runs.iter().enumerate() {
        if index > 0 {
            formatted.push_str(", ");
        }
        formatted.push_str(&run.workflow_name);
        if is_failure_conclusion(&run.conclusion) {
            formatted.push_str(" (failed)");
        }
    }

    formatted
}

fn failed_wait_run_names<'a>(runs: &'a [WaitRunStatus]) -> Vec<&'a str> {
    runs.iter()
        .filter(|run| is_failure_conclusion(&run.conclusion))
        .map(|run| run.workflow_name.as_str())
        .collect()
}

fn is_failure_conclusion(conclusion: &str) -> bool {
    let normalized = conclusion.trim();
    normalized.eq_ignore_ascii_case("failure") || normalized.eq_ignore_ascii_case("failed")
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

fn push_opt(query: &mut Vec<(&str, String)>, key: &'static str, value: Option<String>) {
    if let Some(v) = value {
        query.push((key, v));
    }
}

#[cfg(test)]
mod tests {
    use everr_core::git::parse_repo_from_remote_url;

    use super::{WaitRunStatus, format_wait_status, push_opt};

    #[test]
    fn parse_repo_from_remote_rejects_invalid_values() {
        assert_eq!(
            parse_repo_from_remote_url("https://github.com/everr-app"),
            None
        );
        assert_eq!(parse_repo_from_remote_url("everr-app"), None);
        assert_eq!(parse_repo_from_remote_url(""), None);
    }

    #[test]
    fn push_opt_only_includes_present_values() {
        let mut query = Vec::new();
        push_opt(&mut query, "repo", Some("everr-labs/everr".to_string()));
        push_opt(&mut query, "branch", None);

        assert_eq!(query, vec![("repo", "everr-labs/everr".to_string())]);
    }

    #[test]
    fn wait_status_output_has_no_trailing_blank_line() {
        let status = format_wait_status(
            "df0c52b63dfa0123456789",
            5,
            vec![WaitRunStatus {
                workflow_name: "Build & Test Collector".to_string(),
                conclusion: String::new(),
                duration_seconds: 139,
                usual_duration_seconds: None,
                active_jobs: vec!["Lint".to_string(), "Build".to_string()],
            }],
            vec![WaitRunStatus {
                workflow_name: "Build & Test Ingress".to_string(),
                conclusion: "success".to_string(),
                duration_seconds: 0,
                usual_duration_seconds: None,
                active_jobs: Vec::new(),
            }],
        );

        assert!(status.ends_with('\n'));
        let display = status.trim_end_matches('\n');
        assert!(!display.ends_with('\n'));
        assert_eq!(display.lines().count(), 4);
    }

    #[test]
    fn wait_status_output_marks_failed_completed_runs() {
        let status = format_wait_status(
            "df0c52b63dfa0123456789",
            5,
            Vec::new(),
            vec![
                WaitRunStatus {
                    workflow_name: "Build & Test Collector".to_string(),
                    conclusion: "failure".to_string(),
                    duration_seconds: 0,
                    usual_duration_seconds: None,
                    active_jobs: Vec::new(),
                },
                WaitRunStatus {
                    workflow_name: "Build & Test App".to_string(),
                    conclusion: "success".to_string(),
                    duration_seconds: 0,
                    usual_duration_seconds: None,
                    active_jobs: Vec::new(),
                },
            ],
        );

        assert!(
            status.contains("Completed runs: Build & Test Collector (failed), Build & Test App")
        );
    }

    #[test]
    fn wait_status_output_includes_usual_duration_when_available() {
        let status = format_wait_status(
            "df0c52b63dfa0123456789",
            5,
            vec![WaitRunStatus {
                workflow_name: "CI".to_string(),
                conclusion: String::new(),
                duration_seconds: 125,
                usual_duration_seconds: Some(118),
                active_jobs: vec!["test".to_string()],
            }],
            Vec::new(),
        );

        assert!(status.contains("CI (duration: 2m 5s; usually takes: 1m 58s; active jobs: test)"));
    }
}
