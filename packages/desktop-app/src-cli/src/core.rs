use std::io::{self, Write};

use anyhow::{Context, Result, bail};
use everr_core::git::{resolve_git_context, run_git};
use serde::Serialize;
use tokio::pin;

use futures_util::StreamExt;

use crate::api::{ApiClient, NotifyPayload, StepLogEntry, WatchRun, WatchState};
use crate::auth;
use crate::cli::{
    GetLogsArgs, GrepArgs, ListRunsArgs, LogPagingArgs, ShowRunArgs, SlowestJobsArgs,
    SlowestTestsArgs, StatusArgs, TestHistoryArgs, WatchArgs, WorkflowsListArgs,
};

fn resolve_commit(explicit: Option<String>, cwd: &std::path::Path) -> Result<String> {
    match explicit {
        Some(input) if looks_like_full_sha(&input) => Ok(input),
        Some(input) => {
            run_git(["rev-parse", &input], cwd).ok_or_else(|| {
                anyhow::anyhow!(
                    "failed to resolve commit '{input}'; pass a full commit SHA or run from a git repository"
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

fn looks_like_full_sha(input: &str) -> bool {
    input.len() >= 40 && input.chars().all(|c| c.is_ascii_hexdigit())
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
    let branch = if args.current_branch {
        args.branch.or(git.branch)
    } else {
        args.branch
    };

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
    let mut query = vec![];
    if args.failed {
        query.push(("failed", "true".to_string()));
    }
    let payload = client.get_run_details(&args.trace_id, &query).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn runs_logs(args: GetLogsArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let paging = args.paging();
    let mut query = vec![("jobName", args.job_name), ("stepNumber", args.step_number)];
    push_opt(&mut query, "egrep", args.egrep.clone());

    if let Some(paging) = paging {
        let paged_logs = get_paged_step_logs(&client, &args.trace_id, query, paging).await?;
        print_step_logs(&paged_logs.logs, args.color)?;
        if paged_logs.has_more {
            print_more_logs_notice(paged_logs.page_size, paged_logs.next_offset)?;
        }
        if args.egrep.is_some() && paged_logs.logs.is_empty() {
            std::process::exit(1);
        }
        return Ok(());
    }

    let tail_lines = args.tail.unwrap_or(1000);
    query.push(("tail", tail_lines.to_string()));
    if let Some(offset) = args.offset {
        query.push(("offset", offset.to_string()));
    }

    let response = client.get_step_logs(&args.trace_id, &query).await?;
    print_step_logs(&response.logs, args.color)?;
    if args.egrep.is_some() && response.logs.is_empty() {
        std::process::exit(1);
    }
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

pub async fn workflows_list(args: WorkflowsListArgs) -> Result<()> {
    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;

    let mut query: Vec<(&str, String)> = vec![("repo", repo)];
    push_opt(&mut query, "branch", args.branch);

    let payload = client.get_workflows_list(&query).await?;

    print_json(&payload)?;

    Ok(())
}

pub async fn watch(args: WatchArgs) -> Result<()> {
    use std::collections::{HashMap, HashSet};

    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let cwd = std::env::current_dir()?;
    let git = resolve_git_context(&cwd);
    let explicit_commit = args.commit.is_some();
    let target_commit = resolve_commit(args.commit, &cwd)?;
    let repo = args.repo.or(git.repo).ok_or_else(|| {
        anyhow::anyhow!("failed to resolve repository; provide --repo (for example: owner/name)")
    })?;
    let branch = if explicit_commit {
        args.branch
    } else {
        Some(
            args.branch
                .or(git.branch)
                .ok_or_else(|| anyhow::anyhow!("failed to resolve branch; provide --branch"))?,
        )
    };

    let mut query = vec![("repo", repo.clone()), ("commit", target_commit.clone())];
    if let Some(ref b) = branch {
        query.push(("branch", b.clone()));
    }
    if let Some(attempt) = args.attempt {
        query.push(("attempt", attempt.to_string()));
    }

    let initial = client.get_status(&query).await?;

    if matches!(initial.state, WatchState::Completed) {
        return check_run_conclusions(&initial.completed);
    }

    if initial.active.is_empty() && initial.completed.is_empty() {
        println!("no runs found for this commit yet, waiting...");
    }

    if args.fail_fast {
        if let Some(run) = initial
            .completed
            .iter()
            .find(|r| is_non_success_conclusion(r.conclusion.as_deref()))
        {
            bail!("run failed: {}", run.workflow_name);
        }
    }

    // Print backfill lines for already-known state
    for run in &initial.active {
        for job in &run.active_jobs {
            println!("{} → {}  in_progress", run.workflow_name, job);
        }
    }
    for run in &initial.completed {
        let conclusion = run.conclusion.as_deref().unwrap_or("completed");
        println!("{}  {}", run.workflow_name, conclusion);
    }

    // Track run states
    let mut known: HashSet<String> = initial
        .active
        .iter()
        .chain(initial.completed.iter())
        .map(|r| r.trace_id.clone())
        .collect();
    let mut terminal: HashSet<String> = initial
        .completed
        .iter()
        .map(|r| r.trace_id.clone())
        .collect();
    let mut conclusions: HashMap<String, Option<String>> = initial
        .completed
        .iter()
        .map(|r| (r.trace_id.clone(), r.conclusion.clone()))
        .collect();
    let mut run_names: HashMap<String, String> = initial
        .active
        .iter()
        .chain(initial.completed.iter())
        .map(|r| (r.trace_id.clone(), r.workflow_name.clone()))
        .collect();

    let event_stream = client.events_stream("commit", Some(&target_commit)).await?;
    pin!(event_stream);

    loop {
        match event_stream.next().await {
            Some(Ok(event)) => match event.event_type.as_str() {
                "job" => {
                    println!("{}", format_watch_event_line(&event));
                }
                "run" => {
                    known.insert(event.trace_id.clone());
                    run_names.insert(event.trace_id.clone(), event.workflow_name.clone());
                    if event.status == "completed" {
                        println!("{}", format_watch_event_line(&event));
                        if args.fail_fast
                            && is_non_success_conclusion(event.conclusion.as_deref())
                        {
                            bail!("run failed: {}", event.name);
                        }
                        conclusions.insert(event.trace_id.clone(), event.conclusion.clone());
                        terminal.insert(event.trace_id.clone());
                        let pending: Vec<&str> = known
                            .iter()
                            .filter(|id| !terminal.contains(*id))
                            .filter_map(|id| run_names.get(id).map(|s| s.as_str()))
                            .collect();
                        if !pending.is_empty() {
                            println!("  waiting for: {}", pending.join(", "));
                        }
                    }
                    if !known.is_empty() && terminal.is_superset(&known) {
                        let final_status = client.get_status(&query).await?;
                        return check_run_conclusions(&final_status.completed);
                    }
                }
                _ => {}
            },
            Some(Err(e)) => return Err(e),
            None => {
                // Stream closed — final poll to handle the race between initial status and stream open
                let final_status = client.get_status(&query).await?;
                if matches!(final_status.state, WatchState::Completed) {
                    return check_run_conclusions(&final_status.completed);
                }
                bail!("SSE connection closed unexpectedly");
            }
        }
    }
}

fn format_watch_event_line(event: &NotifyPayload) -> String {
    let status = if event.status == "completed" {
        event
            .conclusion
            .as_deref()
            .unwrap_or("completed")
            .to_string()
    } else {
        event.status.clone()
    };
    if event.event_type == "job" {
        format!("{} → {}  {}", event.workflow_name, event.name, status)
    } else {
        format!("Run completed: {}  {}", event.name, status)
    }
}

fn is_non_success_conclusion(conclusion: Option<&str>) -> bool {
    matches!(
        conclusion,
        Some("failure") | Some("timed_out") | Some("startup_failure") | Some("action_required")
    )
}

fn print_watch_summary(completed: &[WatchRun]) {
    println!("--");
    for run in completed {
        let conclusion = run.conclusion.as_deref().unwrap_or("unknown");
        let duration = run
            .duration_seconds
            .map(|s| {
                if s >= 60 {
                    format!("{}m {:02}s", s / 60, s % 60)
                } else {
                    format!("{}s", s)
                }
            })
            .unwrap_or_default();
        if duration.is_empty() {
            println!("{} | {}", run.workflow_name, conclusion);
        } else {
            println!("{} | {} | {}", run.workflow_name, conclusion, duration);
        }
        for job in &run.failing_jobs {
            if let Some(step) = &job.first_failing_step {
                println!(
                    "  {} → step {}: {}",
                    job.name, step.step_number, step.step_name
                );
                println!(
                    "  everr logs --trace-id {} --job-name {:?} --step-number {}",
                    run.trace_id, job.name, step.step_number
                );
            } else {
                println!("  {}", job.name);
                println!(
                    "  everr logs --trace-id {} --job-name {:?}",
                    run.trace_id, job.name
                );
            }
        }
    }
}

fn check_run_conclusions(completed: &[WatchRun]) -> Result<()> {
    print_watch_summary(completed);
    if completed
        .iter()
        .any(|r| is_non_success_conclusion(r.conclusion.as_deref()))
    {
        bail!("pipeline finished with failed runs");
    }
    Ok(())
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn print_step_logs(logs: &[StepLogEntry], color: bool) -> Result<()> {
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    write_step_logs(&mut handle, logs, color)?;
    handle.flush().context("failed to flush step log output")
}

fn strip_ansi_codes(s: &str) -> std::borrow::Cow<'_, str> {
    if !s.contains('\x1b') {
        return std::borrow::Cow::Borrowed(s);
    }
    match strip_ansi_escapes::strip_str(s) {
        stripped if stripped == s => std::borrow::Cow::Borrowed(s),
        stripped => std::borrow::Cow::Owned(stripped),
    }
}

fn write_step_logs(mut writer: impl Write, logs: &[StepLogEntry], color: bool) -> Result<()> {
    for log in logs {
        let body: std::borrow::Cow<'_, str> = if color {
            std::borrow::Cow::Borrowed(&log.body)
        } else {
            strip_ansi_codes(&log.body)
        };
        writer
            .write_all(body.as_bytes())
            .context("failed to write step log body")?;
        if !body.ends_with('\n') {
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

    let response = client.get_step_logs(trace_id, &query).await?;
    let mut logs = response.logs;
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

    use super::{LogPagingArgs, push_opt, push_pagination};

    #[test]
    fn format_watch_event_line_formats_job_event() {
        use crate::api::NotifyPayload;
        let event = NotifyPayload {
            tenant_id: 1,
            trace_id: "t1".to_string(),
            run_id: "42".to_string(),
            sha: "abc".to_string(),
            repo: "org/repo".to_string(),
            branch: "main".to_string(),
            author_email: None,
            workflow_name: "CI".to_string(),
            name: "build".to_string(),
            event_type: "job".to_string(),
            status: "in_progress".to_string(),
            conclusion: None,
            job_id: Some(1),
        };
        assert_eq!(super::format_watch_event_line(&event), "CI → build  in_progress");
    }

    #[test]
    fn format_watch_event_line_formats_run_event() {
        use crate::api::NotifyPayload;
        let event = NotifyPayload {
            tenant_id: 1,
            trace_id: "t1".to_string(),
            run_id: "42".to_string(),
            sha: "abc".to_string(),
            repo: "org/repo".to_string(),
            branch: "main".to_string(),
            author_email: None,
            workflow_name: "CI".to_string(),
            name: "CI".to_string(),
            event_type: "run".to_string(),
            status: "completed".to_string(),
            conclusion: Some("success".to_string()),
            job_id: None,
        };
        assert_eq!(super::format_watch_event_line(&event), "Run completed: CI  success");
    }

    #[test]
    fn is_non_success_conclusion_returns_true_for_failure() {
        assert!(super::is_non_success_conclusion(Some("failure")));
        assert!(super::is_non_success_conclusion(Some("timed_out")));
        assert!(super::is_non_success_conclusion(Some("startup_failure")));
        assert!(super::is_non_success_conclusion(Some("action_required")));
    }

    #[test]
    fn is_non_success_conclusion_returns_false_for_success() {
        assert!(!super::is_non_success_conclusion(Some("success")));
        assert!(!super::is_non_success_conclusion(Some("skipped")));
        assert!(!super::is_non_success_conclusion(Some("cancelled")));
        assert!(!super::is_non_success_conclusion(None));
    }

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
        super::write_step_logs(&mut output, &logs, false).expect("write step logs");

        assert_eq!(String::from_utf8(output).expect("utf8"), "first\nsecond\n");
    }

    #[test]
    fn write_step_logs_strips_ansi_codes_by_default() {
        let logs = vec![StepLogEntry {
            timestamp: "2026-03-10T10:00:00.000Z".to_string(),
            body: "\x1b[32mgreen text\x1b[0m".to_string(),
        }];

        let mut output = Vec::new();
        super::write_step_logs(&mut output, &logs, false).expect("write step logs");

        assert_eq!(String::from_utf8(output).expect("utf8"), "green text\n");
    }

    #[test]
    fn write_step_logs_preserves_ansi_codes_when_color_enabled() {
        let logs = vec![StepLogEntry {
            timestamp: "2026-03-10T10:00:00.000Z".to_string(),
            body: "\x1b[32mgreen text\x1b[0m".to_string(),
        }];

        let mut output = Vec::new();
        super::write_step_logs(&mut output, &logs, true).expect("write step logs");

        assert_eq!(
            String::from_utf8(output).expect("utf8"),
            "\x1b[32mgreen text\x1b[0m\n"
        );
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

}
