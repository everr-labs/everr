use std::fmt::Write as _;
use std::io::{self, Write};

use anyhow::{Context, Result, bail};
use everr_core::git::{resolve_git_context, run_git};
use serde::Serialize;
use tokio::pin;

use futures_util::StreamExt;

use crate::api::{ApiClient, StepLogEntry, WatchResponse, WatchRun, WatchState};
use crate::auth;
use crate::cli::{
    GetLogsArgs, GrepArgs, ListRunsArgs, LogPagingArgs, ShowRunArgs, SlowestJobsArgs,
    SlowestTestsArgs, StatusArgs, TestHistoryArgs, WatchArgs,
};

fn resolve_commit(explicit: Option<String>, cwd: &std::path::Path) -> Result<String> {
    match explicit {
        Some(input) => {
            run_git(["rev-parse", &input], cwd).ok_or_else(|| {
                anyhow::anyhow!(
                    "failed to resolve commit '{input}'; pass a valid commit SHA or run from a git repository"
                )
            })
        }
        None => run_git(["rev-parse", "HEAD"], cwd).ok_or_else(|| {
            anyhow::anyhow!(
                "failed to resolve target commit; pass --commit <sha> or run from a git repository"
            )
        }),
    }
}

pub async fn status(args: StatusArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
    let commit = resolve_commit(args.commit, &cwd)?;
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;
    let branch = args
        .branch
        .or(git.branch)
        .ok_or_else(|| anyhow::anyhow!("failed to resolve branch; provide --branch"))?;

    let query = vec![("repo", repo), ("branch", branch), ("commit", commit)];
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

    let mut query: Vec<(&str, String)> = vec![("repo", repo), ("pattern", args.pattern)];
    push_pagination(&mut query, args.limit, args.offset);
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
    push_pagination(&mut query, args.limit, args.offset);
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
    let paging = args.paging();
    let query = vec![
        ("jobName", args.job_name),
        ("stepNumber", args.step_number),
        ("fullLogs", args.full.to_string()),
    ];

    let logs = if let Some(paging) = paging {
        let paged_logs = get_paged_step_logs(&client, &args.trace_id, query, paging).await?;
        print_step_logs(&paged_logs.logs)?;
        if paged_logs.has_more {
            print_more_logs_notice(paged_logs.page_size, paged_logs.next_offset)?;
        }
        return Ok(());
    } else {
        client.get_step_logs(&args.trace_id, &query).await?
    };

    print_step_logs(&logs)?;
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
    push_pagination(&mut query, args.limit, args.offset);

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

    let mut query: Vec<(&str, String)> = vec![("repo", repo)];
    push_pagination(&mut query, args.limit, args.offset);
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

    let mut query: Vec<(&str, String)> = vec![("repo", repo)];
    push_pagination(&mut query, args.limit, args.offset);
    push_opt(&mut query, "branch", args.branch);
    push_opt(&mut query, "from", args.from);
    push_opt(&mut query, "to", args.to);

    let payload = client.get_slowest_jobs(&query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn watch(args: WatchArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
    let target_commit = resolve_commit(args.commit, &cwd)?;
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
    ];

    let sse_stream = client.watch_sse(&query).await?;
    pin!(sse_stream);

    let mut watch_status_lines = 0usize;
    let mut last_payload: Option<WatchResponse> = None;
    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            event = sse_stream.next() => {
                match event {
                    Some(Ok(payload)) => {
                        let watch_complete = matches!(payload.state, WatchState::Completed);

                        if watch_complete {
                            finish_watch_status_block(watch_status_lines)?;
                            print_json(&payload)?;
                            let failed_runs = failed_watch_run_names(&payload.completed);
                            if !failed_runs.is_empty() {
                                bail!(
                                    "pipeline finished with failed run(s): {}",
                                    failed_runs.join(", ")
                                );
                            }
                            return Ok(());
                        }

                        let status = format_watch_status(&target_commit, &payload.active, &payload.completed);
                        last_payload = Some(payload);
                        render_watch_status_block(&status, &mut watch_status_lines)?;
                    }
                    Some(Err(error)) => {
                        finish_watch_status_block(watch_status_lines)?;
                        return Err(error);
                    }
                    None => {
                        finish_watch_status_block(watch_status_lines)?;
                        bail!("SSE connection closed unexpectedly");
                    }
                }
            }
            _ = ticker.tick() => {
                if let Some(ref payload) = last_payload {
                    let status = format_watch_status(&target_commit, &payload.active, &payload.completed);
                    render_watch_status_block(&status, &mut watch_status_lines)?;
                }
            }
        }
    }
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn print_step_logs(logs: &[StepLogEntry]) -> Result<()> {
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    write_step_logs(&mut handle, logs)?;
    handle.flush().context("failed to flush step log output")
}

fn write_step_logs(mut writer: impl Write, logs: &[StepLogEntry]) -> Result<()> {
    for log in logs {
        writer
            .write_all(log.body.as_bytes())
            .context("failed to write step log body")?;
        if !log.body.ends_with('\n') {
            writer
                .write_all(b"\n")
                .context("failed to terminate step log line")?;
        }
    }

    Ok(())
}

fn print_more_logs_notice(page_size: u32, next_offset: u32) -> Result<()> {
    let mut stderr = io::stderr().lock();
    writeln!(
        stderr,
        "More logs available. Rerun with --limit {page_size} --offset {next_offset} to continue."
    )
    .context("failed to write step log pagination hint")?;
    stderr
        .flush()
        .context("failed to flush step log pagination hint")
}

async fn get_paged_step_logs(
    client: &ApiClient,
    trace_id: &str,
    mut query: Vec<(&str, String)>,
    paging: LogPagingArgs,
) -> Result<PagedStepLogs> {
    query.push(("limit", paging.limit.saturating_add(1).to_string()));
    query.push(("offset", paging.offset.to_string()));

    let mut logs = client.get_step_logs(trace_id, &query).await?;
    let has_more = logs.len() > paging.limit as usize;
    if has_more {
        logs.truncate(paging.limit as usize);
    }

    Ok(PagedStepLogs {
        logs,
        has_more,
        page_size: paging.limit,
        next_offset: paging.offset.saturating_add(paging.limit),
    })
}

struct PagedStepLogs {
    logs: Vec<StepLogEntry>,
    has_more: bool,
    page_size: u32,
    next_offset: u32,
}

fn format_watch_status(
    target_commit: &str,
    active_runs: &[WatchRun],
    completed_runs: &[WatchRun],
) -> String {
    let mut status = String::new();
    let short_commit = shorten_commit(target_commit);
    let _ = writeln!(
        status,
        "Watching pipeline for commit {short_commit}"
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
            if let Some(expected_duration_seconds) = run.expected_duration_seconds {
                details.push(format!(
                    "expected duration: {}",
                    format_elapsed_duration(expected_duration_seconds)
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
        format_completed_run_list(completed_runs)
    );
    status
}

fn render_watch_status_block(message: &str, last_lines: &mut usize) -> Result<()> {
    let display = message.trim_end_matches('\n');
    clear_watch_status_block(*last_lines);
    io::stderr()
        .flush()
        .context("failed to flush watch status block")?;

    eprint!("{display}");
    io::stderr()
        .flush()
        .context("failed to flush watch status block")?;
    *last_lines = display.lines().count();
    Ok(())
}

fn finish_watch_status_block(last_lines: usize) -> Result<()> {
    if last_lines == 0 {
        return Ok(());
    }

    eprintln!();
    io::stderr()
        .flush()
        .context("failed to flush watch trailing newline")
}

fn clear_watch_status_block(line_count: usize) {
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

fn format_name_list(names: &[String]) -> String {
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}

fn format_completed_run_list(runs: &[WatchRun]) -> String {
    if runs.is_empty() {
        return "none".to_string();
    }

    let mut formatted = String::new();
    for (index, run) in runs.iter().enumerate() {
        if index > 0 {
            formatted.push_str(", ");
        }
        formatted.push_str(&run.workflow_name);
        if is_failure_conclusion(run.conclusion.as_deref().unwrap_or_default()) {
            formatted.push_str(" (failed)");
        }
    }

    formatted
}

fn failed_watch_run_names<'a>(runs: &'a [WatchRun]) -> Vec<&'a str> {
    runs.iter()
        .filter(|run| is_failure_conclusion(run.conclusion.as_deref().unwrap_or_default()))
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

fn push_pagination(query: &mut Vec<(&str, String)>, limit: u32, offset: u32) {
    query.push(("limit", limit.to_string()));
    query.push(("offset", offset.to_string()));
}

#[cfg(test)]
mod tests {
    use everr_core::git::parse_repo_from_remote_url;

    use crate::api::StepLogEntry;

    use super::{LogPagingArgs, format_watch_status, push_opt, push_pagination};
    use crate::api::WatchRun;

    #[test]
    fn print_step_logs_terminates_lines_without_trailing_newlines() {
        let logs = vec![
            StepLogEntry {
                timestamp: "2026-03-10T10:00:00.000Z".to_string(),
                body: "first".to_string(),
            },
            StepLogEntry {
                timestamp: "2026-03-10T10:00:01.000Z".to_string(),
                body: "second\n".to_string(),
            },
        ];

        let mut output = Vec::new();
        super::write_step_logs(&mut output, &logs).expect("write step logs");

        assert_eq!(String::from_utf8(output).expect("utf8"), "first\nsecond\n");
    }

    #[test]
    fn paged_logs_notice_uses_next_requested_offset() {
        let paging = LogPagingArgs {
            limit: 1000,
            offset: 2000,
        };

        assert_eq!(paging.offset.saturating_add(paging.limit), 3000);
    }

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
    fn push_pagination_always_includes_limit_and_offset() {
        let mut query = Vec::new();
        push_pagination(&mut query, 25, 50);

        assert_eq!(
            query,
            vec![("limit", "25".to_string()), ("offset", "50".to_string())]
        );
    }

    #[test]
    fn watch_status_output_has_no_trailing_blank_line() {
        let status = format_watch_status(
            "df0c52b63dfa0123456789",
            &[WatchRun {
                run_id: "42".to_string(),
                workflow_name: "Build & Test Collector".to_string(),
                conclusion: None,
                duration_seconds: 139,
                expected_duration_seconds: None,
                active_jobs: vec!["Lint".to_string(), "Build".to_string()],
            }],
            &[WatchRun {
                run_id: "41".to_string(),
                workflow_name: "Build & Test Ingress".to_string(),
                conclusion: Some("success".to_string()),
                duration_seconds: 0,
                expected_duration_seconds: None,
                active_jobs: Vec::new(),
            }],
        );

        assert!(status.ends_with('\n'));
        let display = status.trim_end_matches('\n');
        assert!(!display.ends_with('\n'));
        assert_eq!(display.lines().count(), 4);
    }

    #[test]
    fn watch_status_output_marks_failed_completed_runs() {
        let status = format_watch_status(
            "df0c52b63dfa0123456789",
            &[],
            &[
                WatchRun {
                    run_id: "42".to_string(),
                    workflow_name: "Build & Test Collector".to_string(),
                    conclusion: Some("failure".to_string()),
                    duration_seconds: 0,
                    expected_duration_seconds: None,
                    active_jobs: Vec::new(),
                },
                WatchRun {
                    run_id: "41".to_string(),
                    workflow_name: "Build & Test App".to_string(),
                    conclusion: Some("success".to_string()),
                    duration_seconds: 0,
                    expected_duration_seconds: None,
                    active_jobs: Vec::new(),
                },
            ],
        );

        assert!(
            status.contains("Completed runs: Build & Test Collector (failed), Build & Test App")
        );
    }

    #[test]
    fn watch_status_output_includes_usual_duration_when_available() {
        let status = format_watch_status(
            "df0c52b63dfa0123456789",
            &[WatchRun {
                run_id: "99".to_string(),
                workflow_name: "CI".to_string(),
                conclusion: None,
                duration_seconds: 125,
                expected_duration_seconds: Some(118),
                active_jobs: vec!["test".to_string()],
            }],
            &[],
        );

        assert!(
            status.contains("CI (duration: 2m 5s; expected duration: 1m 58s; active jobs: test)")
        );
    }
}
