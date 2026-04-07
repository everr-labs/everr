use std::fmt::Write as _;
use std::io::IsTerminal;
use std::path::Path;
use std::process::Command as ProcessCommand;

use anyhow::{Context, Result, bail};
use everr_core::api::ApiClient;
use everr_core::assistant::{self as core_assistant, AssistantKind};
use everr_core::auth::login_with_prompt;
use everr_core::build;
use everr_core::state::Session;

use crate::auth;

const LOGO_LINES: &[&str] = &["⢠⡾⢻⣦⡀", "⣿⠁⣾⣉⣻⣦⡀", "⣿ ⣿⣉⣽⢿⡿⣦⡀", "⠘⣧⡈⠻⣧⣼⣧⡼⠿⣦", " ⠈⠛⠶⣤⣤⣤⣴⠾⠋"];
const WORDMARK_LINES: &[&str] = &[
    "░████████ ░██    ░██  ░███████  ░██░████ ░██░████",
    "░██       ░██    ░██ ░██    ░██ ░███     ░███",
    "░███████   ░██  ░██  ░█████████ ░██      ░██",
    "░██         ░██░██   ░██        ░██      ░██",
    "░████████    ░███     ░███████  ░██      ░██",
];
const LOGO_COLUMN_WIDTH: usize = 10;
const BANNER_COLOR: &str = "\x1b[38;2;223;255;0m";
const ANSI_RESET: &str = "\x1b[0m";

pub async fn run() -> Result<()> {
    println!();
    print_banner();

    cliclack::intro("Onboarding")?;

    let session = step_authenticate().await?;
    step_rename_org(&session).await?;
    step_import_repos(&session).await?;
    step_configure_notification_emails(&session).await?;
    let assistants_configured = step_configure_assistants()?;
    let desktop_installed = step_install_desktop_app().await?;

    cliclack::outro(outro_message(assistants_configured, desktop_installed))?;
    Ok(())
}

pub(crate) fn clean_org_name(name: &str) -> String {
    name.trim().to_string()
}

async fn step_authenticate() -> Result<Session> {
    let store = auth::state_store();
    let config = auth::resolve_auth_config()?;

    match store.load_session_for_api_base_url(&config.api_base_url) {
        Ok(session) => {
            cliclack::log::success("Already logged in.")?;
            Ok(session)
        }
        Err(_) => {
            let session =
                login_with_prompt(&config, &store, auth::show_device_sign_in_prompt).await?;
            cliclack::log::success("Logged in.")?;
            Ok(session)
        }
    }
}

async fn step_rename_org(session: &Session) -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    if !interactive {
        return Ok(());
    }

    let client = ApiClient::from_session(session)?;
    let org = match client.get_org().await {
        Ok(org) => org,
        Err(_) => return Ok(()), // non-fatal: skip if API unavailable
    };

    if !org.is_only_member {
        return Ok(());
    }

    let input: String = cliclack::input("Organization name")
        .default_input(&org.name)
        .interact()?;

    let new_name = clean_org_name(&input);
    if new_name == org.name || new_name.is_empty() {
        return Ok(());
    }

    if let Err(_) = client.patch_org_name(&new_name).await {
        return Ok(());
    }
    cliclack::log::success(format!("Organization name set to \"{new_name}\""))?;
    Ok(())
}

async fn step_import_repos(session: &Session) -> Result<()> {
    let interactive = std::io::stdin().is_terminal();

    let client = ApiClient::from_session(session)?;
    let repos = match client.get_repos().await {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };

    if repos.is_empty() {
        return Ok(());
    }

    if !interactive {
        return Ok(());
    }

    const MAX_REPOS: usize = 3;

    let mut prompt = cliclack::multiselect("Select repositories to import (up to 3)").required(false);
    for repo in &repos {
        prompt = prompt.item(repo.full_name.clone(), repo.full_name.clone(), "");
    }
    let selected: Vec<String> = prompt.interact()?;

    if selected.is_empty() {
        cliclack::log::remark("No repositories selected, skipping import.")?;
        return Ok(());
    }

    let to_import: Vec<String> = selected.into_iter().take(MAX_REPOS).collect();

    let pb = cliclack::progress_bar(100);
    pb.start("Importing workflow history…");

    let mut done_result: Option<(u32, u32)> = None;
    let mut current_repo_index = 0u32;
    let mut current_repos_total = 1u32;

    let result = client
        .import_repos_streaming(&to_import, |event| match event {
            everr_core::api::ImportEvent::RepoStart {
                repo_full_name,
                repo_index,
                repos_total,
            } => {
                current_repo_index = repo_index;
                current_repos_total = repos_total;
                if repos_total > 1 {
                    pb.set_message(format!(
                        "Importing {repo_full_name} ({repo_index}/{repos_total})…"
                    ));
                } else {
                    pb.set_message(format!("Importing {repo_full_name}…"));
                }
            }
            everr_core::api::ImportEvent::Progress { progress } => {
                if progress.jobs_quota > 0 {
                    pb.set_position(import_progress_position(
                        current_repo_index,
                        current_repos_total,
                        progress.jobs_enqueued,
                        progress.jobs_quota,
                    ));
                }
                if progress.runs_processed > 0 {
                    pb.set_message(format!("{} runs imported…", progress.runs_processed));
                }
            }
            everr_core::api::ImportEvent::Done {
                total_jobs,
                total_errors,
            } => {
                done_result = Some((total_jobs, total_errors));
            }
            everr_core::api::ImportEvent::RepoError { .. } => {}
        })
        .await;

    if result.is_err() {
        pb.stop("Import skipped (API error).");
        return Ok(());
    }

    match done_result {
        Some((jobs, 0)) => pb.stop(format!("Imported {jobs} workflow runs.")),
        Some((jobs, errors)) => pb.stop(format!(
            "Imported {jobs} runs ({errors} errors — some repos may be incomplete)."
        )),
        None => pb.stop("Import complete."),
    }
    cliclack::log::remark(
        "Your data is being processed and will appear gradually on the CLI results.",
    )?;

    Ok(())
}

const ADD_EMAIL_SENTINEL: &str = "__add_email__";

async fn step_configure_notification_emails(session: &Session) -> Result<()> {
    let store = auth::state_store();
    let saved: Vec<String> = store
        .load_state()
        .map(|s| s.settings.notification_emails)
        .unwrap_or_default();
    let mut detected: Vec<String> = Vec::new();

    if let Ok(client) = everr_core::api::ApiClient::from_session(session) {
        if let Ok(me) = client.get_me().await {
            detected.push(me.email.clone());
            store.update_state(|state| {
                state.settings.user_profile = Some(everr_core::state::UserProfile {
                    email: me.email,
                    name: me.name,
                    profile_url: me.profile_url,
                });
            })?;
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let git = everr_core::git::resolve_git_context(&cwd);
        if let Some(git_email) = git.email {
            if !detected.contains(&git_email) {
                detected.push(git_email);
            }
        }
    }

    let mut all_emails = saved.clone();
    for email in &detected {
        if !all_emails.contains(email) {
            all_emails.push(email.clone());
        }
    }

    let initial: Vec<String> = if saved.is_empty() {
        detected.clone()
    } else {
        saved.clone()
    };

    let interactive = std::io::stdin().is_terminal();

    if !interactive {
        if !all_emails.is_empty() {
            store.update_state(|state| {
                state.settings.notification_emails = all_emails;
            })?;
        }
        return Ok(());
    }

    cliclack::note(
        "Notification emails",
        "These emails are used to detect which updates are related to you, we never send them to our servers because the logic is applied locally.",
    )?;

    let mut prompt = cliclack::multiselect("Select notification emails");
    for email in &all_emails {
        prompt = prompt.item(email.clone(), email.clone(), "");
    }
    prompt = prompt.item(ADD_EMAIL_SENTINEL.to_string(), "Add email…", "");

    let mut selected: Vec<String> = prompt.initial_values(initial).interact()?;

    let add_requested = selected.contains(&ADD_EMAIL_SENTINEL.to_string());
    selected.retain(|e| e != ADD_EMAIL_SENTINEL);

    if add_requested {
        let custom: String = cliclack::input("Email address").interact()?;
        let custom = custom.trim().to_string();
        if !custom.is_empty() && !selected.contains(&custom) {
            selected.push(custom);
        }
    }

    let notification_emails = if selected.is_empty() { detected } else { selected };

    store.update_state(|state| {
        state.settings.notification_emails = notification_emails;
    })?;

    cliclack::log::success("Notification emails configured")?;
    Ok(())
}

fn step_configure_assistants() -> Result<bool> {
    let interactive = std::io::stdin().is_terminal();
    let statuses = core_assistant::assistant_statuses()?;

    let all_configured = statuses.iter().all(|s| !s.detected || s.configured);

    if all_configured && statuses.iter().any(|s| s.configured) {
        let configured_list: Vec<String> = statuses
            .iter()
            .filter(|s| s.configured)
            .map(|s| format!("{} ({})", display_name(s.assistant), s.path))
            .collect();
        cliclack::log::success(format!(
            "Assistants already configured:\n{}",
            configured_list.join("\n")
        ))?;

        if !interactive {
            return Ok(true);
        }

        let reconfigure: bool = cliclack::confirm("Re-configure assistants?")
            .initial_value(false)
            .interact()?;

        if !reconfigure {
            return Ok(true);
        }
    }

    if interactive {
        cliclack::note(
            "Agent integrations",
            "Each selected assistant gets a small instruction block (under 300 bytes) added to its global context file.",
        )?;
    }

    let selected_assistants: Vec<AssistantKind> = if interactive {
        let mut prompt = cliclack::multiselect("Select assistants to configure");
        for (i, s) in statuses.iter().enumerate() {
            let label = display_name(s.assistant);
            let hint = &s.path;
            prompt = prompt.item(i, label, hint);
        }
        prompt = prompt.initial_values(
            statuses
                .iter()
                .enumerate()
                .filter(|(_, s)| s.detected)
                .map(|(i, _)| i)
                .collect(),
        );

        let selected_indices: Vec<usize> = prompt.interact()?;
        selected_indices
            .iter()
            .map(|&i| statuses[i].assistant)
            .collect()
    } else {
        statuses
            .iter()
            .filter(|s| s.detected)
            .map(|s| s.assistant)
            .collect()
    };

    if selected_assistants.is_empty() {
        cliclack::log::remark("No assistants selected.")?;
        return Ok(false);
    }

    core_assistant::sync_discovery_assistants(&selected_assistants, build::command_name())?;

    cliclack::log::success("Assistants configured")?;

    Ok(true)
}

async fn step_install_desktop_app() -> Result<bool> {
    let interactive = std::io::stdin().is_terminal();
    let app_path = Path::new("/Applications/Everr.app");
    let already_installed = app_path.exists();

    let running = ProcessCommand::new("pgrep")
        .args(["-x", "Everr"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if running {
        cliclack::log::success("Desktop app is already running in the menu bar.")?;
        return Ok(true);
    }

    if already_installed {
        let _ = ProcessCommand::new("open").args(["-a", "Everr"]).status();
        cliclack::log::success("Desktop app is now running in the menu bar.")?;
        return Ok(true);
    }

    if !interactive {
        cliclack::log::remark("Install the desktop app from https://everr.dev")?;
        return Ok(false);
    }

    let install: bool = cliclack::confirm("Do you want to install the Everr desktop app?\n\nThe desktop app runs in the menu bar and notifies you\nwhen your CI/CD pipelines fail or need attention.")
        .initial_value(true)
        .interact()?;

    if !install {
        cliclack::log::remark("You can install it later from https://everr.dev")?;
        return Ok(false);
    }

    {
        let dmg_url = format!(
            "{}/everr-app/everr-macos-arm64.dmg",
            build::default_docs_base_url()
        );

        let spinner = cliclack::spinner();
        spinner.start("Downloading desktop app...");

        let tmp_dir = tempfile::tempdir().context("failed to create temp dir")?;
        let dmg_path = tmp_dir.path().join("Everr.dmg");

        let response = reqwest::get(&dmg_url)
            .await
            .context("failed to download desktop app")?;
        let bytes = response.bytes().await.context("failed to read download")?;
        std::fs::write(&dmg_path, &bytes).context("failed to write DMG")?;

        spinner.set_message("Mounting disk image...");

        let mount_output = ProcessCommand::new("hdiutil")
            .args(["attach", "-nobrowse", "-noautoopen"])
            .arg(&dmg_path)
            .output()
            .context("failed to mount DMG")?;

        let stdout = String::from_utf8_lossy(&mount_output.stdout);
        let mount_point = stdout
            .lines()
            .last()
            .and_then(|line| line.split('\t').last())
            .map(|s| s.trim().to_string())
            .context("failed to find mount point")?;

        spinner.set_message("Extracting app to Applications...");

        let copy_result = ProcessCommand::new("cp")
            .args(["-R"])
            .arg(format!("{mount_point}/Everr.app"))
            .arg("/Applications/")
            .status();

        let _ = ProcessCommand::new("hdiutil")
            .args(["detach", &mount_point, "-quiet"])
            .status();

        let copy_status = copy_result.context("failed to copy app to /Applications")?;
        if !copy_status.success() {
            bail!("cp failed with {copy_status}");
        }

        spinner.stop("Desktop app installed to /Applications/Everr.app");
    }

    let _ = ProcessCommand::new("open").args(["-a", "Everr"]).status();
    cliclack::log::success("Desktop app is now running in the menu bar.")?;

    Ok(true)
}

fn outro_message(assistants_configured: bool, desktop_installed: bool) -> &'static str {
    if assistants_configured && desktop_installed {
        "Your AI assistant is set up for Everr — ask it about CI pipelines, failing jobs, or workflow logs.\nOr break something in CI — Everr will notify you with a ready-to-use fix prompt."
    } else if assistants_configured {
        "Your AI assistant is set up for Everr — ask it about CI pipelines, failing jobs, or workflow logs."
    } else {
        "Run `everr init` in a repo to setup the agents instructions."
    }
}

fn display_name(kind: AssistantKind) -> &'static str {
    match kind {
        AssistantKind::Claude => "Claude Code",
        AssistantKind::Codex => "Codex",
        AssistantKind::Cursor => "Cursor",
    }
}

fn print_banner() {
    let banner = render_banner();
    if should_use_color() {
        print!("{BANNER_COLOR}{banner}{ANSI_RESET}");
    } else {
        print!("{banner}");
    }
    println!();
}

fn render_banner() -> String {
    let mut banner = String::new();
    let total_lines = LOGO_LINES.len().max(WORDMARK_LINES.len());
    for line_index in 0..total_lines {
        let logo = LOGO_LINES.get(line_index).copied().unwrap_or("");
        let wordmark = WORDMARK_LINES.get(line_index).copied().unwrap_or("");
        if wordmark.is_empty() {
            writeln!(&mut banner, "{logo}").expect("banner line");
        } else {
            writeln!(&mut banner, "{logo:<width$}   {wordmark}", width = LOGO_COLUMN_WIDTH)
                .expect("banner line");
        }
    }
    banner
}

fn should_use_color() -> bool {
    std::io::stdout().is_terminal()
        && std::env::var_os("NO_COLOR").is_none()
        && std::env::var("TERM")
            .map(|term| term != "dumb")
            .unwrap_or(true)
}

/// Maps per-repo import progress onto a single 0–100 bar covering all repos.
/// `repo_index` is 0-based; `repos_total` is the total number of repos.
fn import_progress_position(
    repo_index: u32,
    repos_total: u32,
    jobs_enqueued: u32,
    jobs_quota: u32,
) -> u64 {
    if repos_total == 0 || jobs_quota == 0 {
        return 0;
    }
    let repo_fraction = (jobs_enqueued as f64 / jobs_quota as f64).min(1.0);
    let overall = (repo_index as f64 + repo_fraction) / repos_total as f64;
    (overall * 100.0) as u64
}

#[cfg(test)]
mod tests {
    use super::import_progress_position;

    #[test]
    fn import_progress_does_not_panic_before_repo_start() {
        // repo_index=0 (default before any RepoStart), quota>0 must not panic
        assert_eq!(import_progress_position(0, 2, 0, 10), 0);
    }

    #[test]
    fn import_progress_first_repo_half_done() {
        // repo 0 of 2, 5/10 → 25%
        assert_eq!(import_progress_position(0, 2, 5, 10), 25);
    }

    #[test]
    fn import_progress_second_repo_fully_done() {
        // repo 1 of 2, 10/10 → 100%
        assert_eq!(import_progress_position(1, 2, 10, 10), 100);
    }

    #[test]
    fn import_progress_single_repo_half_done() {
        assert_eq!(import_progress_position(0, 1, 5, 10), 50);
    }

    #[test]
    fn import_progress_clamps_enqueued_above_quota() {
        // jobs_enqueued > jobs_quota should not exceed the repo's slice
        assert_eq!(import_progress_position(0, 1, 20, 10), 100);
    }

    #[test]
    fn import_progress_zero_repos_total_returns_zero() {
        assert_eq!(import_progress_position(0, 0, 5, 10), 0);
    }

    #[test]
    fn import_progress_zero_quota_returns_zero() {
        assert_eq!(import_progress_position(0, 2, 0, 0), 0);
    }

    #[test]
    fn clean_org_name_trims_whitespace() {
        assert_eq!(super::clean_org_name("  Acme Inc.  "), "Acme Inc.");
    }

    #[test]
    fn clean_org_name_preserves_inner_spaces() {
        assert_eq!(super::clean_org_name("Acme Corp"), "Acme Corp");
    }

    #[test]
    fn outro_message_with_assistants_and_desktop() {
        let msg = super::outro_message(true, true);
        assert!(msg.contains("AI assistant"));
        assert!(msg.contains("break something in CI"));
    }

    #[test]
    fn outro_message_with_assistants_no_desktop() {
        let msg = super::outro_message(true, false);
        assert!(msg.contains("AI assistant"));
        assert!(!msg.contains("break something in CI"));
    }

    #[test]
    fn outro_message_without_assistants_configured() {
        assert!(super::outro_message(false, false).contains("everr init"));
    }
}
