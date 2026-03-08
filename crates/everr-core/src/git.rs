use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitContext {
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub email: Option<String>,
}

pub fn resolve_git_context(cwd: &Path) -> GitContext {
    let branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).map(normalize_branch_name);
    let origin = run_git(["config", "--get", "remote.origin.url"], cwd);
    let repo = origin.as_deref().and_then(parse_repo_from_remote_url);
    let email = resolve_git_email(cwd);
    GitContext {
        repo,
        branch,
        email,
    }
}

pub fn resolve_git_email(cwd: &Path) -> Option<String> {
    run_git(["config", "--get", "user.email"], cwd)
        .or_else(|| run_git(["config", "--global", "--get", "user.email"], cwd))
}

pub fn run_git<const N: usize>(args: [&str; N], cwd: &Path) -> Option<String> {
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

pub fn normalize_branch_name(raw: String) -> String {
    if raw == "HEAD" {
        return raw;
    }
    match raw.strip_prefix("refs/heads/") {
        Some(stripped) => stripped.to_string(),
        None => raw,
    }
}

pub fn parse_repo_from_remote_url(remote_url: &str) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::{normalize_branch_name, parse_repo_from_remote_url};

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
            parse_repo_from_remote_url("git@github.com:everr-dev/everr.git"),
            Some("everr-dev/everr".to_string())
        );
        assert_eq!(
            parse_repo_from_remote_url("https://github.com/everr-labs/everr.git"),
            Some("everr-dev/everr".to_string())
        );
        assert_eq!(
            parse_repo_from_remote_url("http://github.com/everr-labs/everr"),
            Some("everr-dev/everr".to_string())
        );
    }
}
