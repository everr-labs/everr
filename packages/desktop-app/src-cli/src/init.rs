use std::process::Command as ProcessCommand;

use anyhow::{Context, Result, bail};
use everr_core::api::ApiClient;
use everr_core::build;

use crate::auth;

pub async fn run() -> Result<()> {
    // Step 1: require auth
    let session = auth::require_session_with_refresh().await?;

    // Step 2: detect repo
    let cwd = std::env::current_dir().context("could not determine current directory")?;
    let repo_full_name = detect_repo_full_name(&cwd)?;

    let client = ApiClient::from_session(&session)?;

    // Step 3: import if GitHub App installed and no existing runs
    let repos = client.get_repos().await.unwrap_or_default();
    let github_installed = repos.iter().any(|r| r.full_name == repo_full_name);

    if !github_installed {
        cliclack::log::remark(format!(
            "GitHub App not installed for this repo.\nInstall it from https://everr.dev, then re-run `{} init`.",
            build::command_name()
        ))?;
    } else {
        let has_runs = has_existing_runs(&client, &repo_full_name).await;

        if has_runs {
            cliclack::log::success(format!(
                "Runs already imported for {repo_full_name}, skipping."
            ))?;
        } else {
            let import =
                cliclack::confirm(format!("Import workflow history for {repo_full_name}?"))
                    .initial_value(true)
                    .interact()?;

            if import {
                match client.start_import_repos(&[repo_full_name.clone()]).await {
                    Ok(_) => cliclack::log::remark(
                        "Import started — your data will appear gradually on the CLI results.",
                    )?,
                    Err(e) => cliclack::log::warning(format!("Could not start import: {e}"))?,
                }
            } else {
                cliclack::log::remark("Skipping import.")?;
            }
        }
    }

    cliclack::outro(format!("{} init complete.", build::command_name()))?;

    Ok(())
}

fn detect_repo_full_name(cwd: &std::path::Path) -> Result<String> {
    let output = ProcessCommand::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(cwd)
        .output()
        .context("failed to run git remote get-url origin")?;

    if !output.status.success() {
        bail!("could not detect git remote; make sure this directory has a remote named 'origin'");
    }

    let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_repo_from_remote(&remote)
        .ok_or_else(|| anyhow::anyhow!("remote '{remote}' does not appear to be a GitHub repo"))
}

pub(crate) fn parse_repo_from_remote(remote: &str) -> Option<String> {
    let without_git = remote.trim_end_matches(".git");

    // https://github.com/owner/repo
    if let Some(rest) = without_git.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Some(format!("{}/{}", parts[0], parts[1]));
        }
    }

    // git@github.com:owner/repo
    if let Some(rest) = without_git.strip_prefix("git@github.com:") {
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Some(format!("{}/{}", parts[0], parts[1]));
        }
    }

    None
}

async fn has_existing_runs(client: &ApiClient, repo_full_name: &str) -> bool {
    // Reuse the existing runs-list endpoint with limit=1 to check for any data.
    let query = [
        ("repo", repo_full_name.to_string()),
        ("limit", "1".to_string()),
    ];
    match client.get_runs_list(&query).await {
        Ok(value) => value
            .get("runs")
            .and_then(|r| r.as_array())
            .map(|arr| !arr.is_empty())
            .unwrap_or(false),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_repo_from_remote;

    #[test]
    fn parses_https_remote() {
        assert_eq!(
            parse_repo_from_remote("https://github.com/acme/api.git"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn parses_ssh_remote() {
        assert_eq!(
            parse_repo_from_remote("git@github.com:acme/api.git"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn parses_ssh_remote_without_git_suffix() {
        assert_eq!(
            parse_repo_from_remote("git@github.com:acme/api"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn returns_none_for_non_github_remote() {
        assert_eq!(
            parse_repo_from_remote("https://gitlab.com/acme/api.git"),
            None
        );
    }

    #[test]
    fn returns_none_for_malformed_remote() {
        assert_eq!(parse_repo_from_remote("not-a-url"), None);
    }
}
