use std::path::PathBuf;
use std::process::Command;

use anyhow::Result;
use serde_json::{Value, json};

use crate::api::ApiClient;
use crate::auth;
use crate::cli::{ConnectArgs, GetLogsArgs, ListRunsArgs, ShowRunArgs, StatusArgs};

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

pub fn connect(args: ConnectArgs) -> Result<()> {
    let git = resolve_git_context(std::env::current_dir()?);
    let repo = args.repo.or(git.repo);
    let api_base_url = resolve_api_base_url(args.api_base_url)?;
    let install_url = github_install_start_url(&api_base_url);

    println!("Connect Everr to your GitHub repository");
    println!();
    println!("1. Open: {install_url}");
    println!("2. Sign in and make sure the correct Everr organization is active.");
    if let Some(repo_name) = repo {
        println!("3. In GitHub, choose \"Only select repositories\" and select: {repo_name}");
    } else {
        println!("3. In GitHub, choose the repository you want to observe.");
        println!(
            "   Tip: rerun inside a git repo or pass --repo owner/name for repo-specific guidance."
        );
    }
    println!("4. Complete the installation.");
    println!("5. Verify CI visibility with: everr status");

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

fn resolve_api_base_url(override_api_base_url: Option<String>) -> Result<String> {
    if let Some(api_base_url) = override_api_base_url {
        return Ok(api_base_url.trim().trim_end_matches('/').to_string());
    }

    if auth::has_active_session()? {
        let session = auth::require_session()?;
        return Ok(session
            .api_base_url
            .trim()
            .trim_end_matches('/')
            .to_string());
    }

    Ok(auth::DEFAULT_API_BASE_URL.to_string())
}

fn github_install_start_url(api_base_url: &str) -> String {
    format!("{}/api/github/install/start", api_base_url)
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
        github_install_start_url, normalize_branch_name, parse_repo_from_remote_url, push_opt,
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
    fn github_install_start_url_joins_path() {
        assert_eq!(
            github_install_start_url("https://app.everr.dev"),
            "https://app.everr.dev/api/github/install/start"
        );
    }
}
