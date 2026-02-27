use std::path::PathBuf;
use std::process::Command;

use anyhow::Result;
use serde_json::{Value, json};

use crate::api::ApiClient;
use crate::auth;
use crate::cli::{GetLogsArgs, ListRunsArgs, ShowRunArgs, StatusArgs};

pub fn context() -> Result<()> {
    let cwd = std::env::current_dir()?;
    let git_root = run_git(["rev-parse", "--show-toplevel"], &cwd);
    let branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"], &cwd).map(normalize_branch_name);
    let origin = run_git(["config", "--get", "remote.origin.url"], &cwd);
    let repo = origin.as_deref().and_then(parse_repo_from_remote_url);

    let output = json!({
        "cwd": cwd.display().to_string(),
        "gitRoot": git_root,
        "repo": repo,
        "branch": branch,
        "origin": origin,
    });
    print_json(&output)?;
    Ok(())
}

pub async fn status(args: StatusArgs) -> Result<()> {
    let session = auth::require_session()?;
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
    let session = auth::require_session()?;
    let client = ApiClient::from_session(&session)?;
    let git = resolve_git_context(std::env::current_dir()?);
    let repo = args.repo.or(git.repo);

    let mut query: Vec<(&str, String)> = Vec::new();
    push_opt(&mut query, "repo", repo);
    push_opt(&mut query, "branch", args.branch);
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
    let session = auth::require_session()?;
    let client = ApiClient::from_session(&session)?;
    let payload = client.get_run_details(&args.trace_id).await?;
    print_json(&payload)?;
    Ok(())
}

pub async fn runs_logs(args: GetLogsArgs) -> Result<()> {
    let session = auth::require_session()?;
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

fn print_json(value: &Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
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
    let ssh = regex_like_extract(trimmed, '@', ':')?;
    if let Some(repo) = strip_dot_git(ssh) {
        return Some(repo);
    }
    let http = trimmed.rsplit('/').take(2).collect::<Vec<_>>();
    if http.len() == 2 {
        let repo = format!("{}/{}", http[1], http[0]);
        return strip_dot_git(repo);
    }
    None
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
