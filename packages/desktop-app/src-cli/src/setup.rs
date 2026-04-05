use std::fmt::Write as _;
use std::io::IsTerminal;
use std::path::Path;
use std::process::Command as ProcessCommand;

use anyhow::{Context, Result};
use everr_core::assistant::{self as core_assistant, AssistantKind};
use everr_core::auth::login_with_prompt;
use everr_core::build;

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

    cliclack::intro("Setup")?;

    step_authenticate().await?;
    step_configure_notification_emails().await?;
    step_configure_assistants()?;
    step_install_desktop_app().await?;

    cliclack::outro("Everr is ready.")?;
    Ok(())
}

const ADD_EMAIL_SENTINEL: &str = "__add_email__";

async fn step_configure_notification_emails() -> Result<()> {
    let store = auth::state_store();
    let saved: Vec<String> = store
        .load_state()
        .map(|s| s.settings.notification_emails)
        .unwrap_or_default();
    let mut detected: Vec<String> = Vec::new();

    // Fetch Everr account email from /me
    if let Ok(session) = store.load_session() {
        if let Ok(client) = everr_core::api::ApiClient::from_session(&session) {
            if let Ok(me) = client.get_me().await {
                detected.push(me.email.clone());
                // Cache user profile while we have it
                store.update_state(|state| {
                    state.settings.user_profile = Some(everr_core::state::UserProfile {
                        email: me.email,
                        name: me.name,
                        profile_url: me.profile_url,
                    });
                })?;
            }
        }
    }

    // Add git config email if different
    if let Ok(cwd) = std::env::current_dir() {
        let git = everr_core::git::resolve_git_context(&cwd);
        if let Some(git_email) = git.email {
            if !detected.contains(&git_email) {
                detected.push(git_email);
            }
        }
    }

    // Union of saved + detected, preserving saved order first
    let mut all_emails = saved.clone();
    for email in &detected {
        if !all_emails.contains(email) {
            all_emails.push(email.clone());
        }
    }

    // Pre-select: current saved selection (or all detected if first run)
    let initial: Vec<String> = if saved.is_empty() {
        detected.clone()
    } else {
        saved.clone()
    };

    cliclack::note(
        "Notification emails",
        "These emails are used to detect which updates are related to you, we never send them to our servers because the logic is applied locally.",
    )?;

    // Build multiselect with union of all known emails + "Add email…" sentinel
    let mut prompt = cliclack::multiselect("Select notification emails");
    for email in &all_emails {
        prompt = prompt.item(email.clone(), email.clone(), "");
    }
    prompt = prompt.item(ADD_EMAIL_SENTINEL.to_string(), "Add email…", "");

    let mut selected: Vec<String> = prompt.initial_values(initial).interact()?;

    // If the sentinel was selected, prompt for a custom email
    let add_requested = selected.contains(&ADD_EMAIL_SENTINEL.to_string());
    selected.retain(|e| e != ADD_EMAIL_SENTINEL);

    if add_requested {
        let custom: String = cliclack::input("Email address").interact()?;
        let custom = custom.trim().to_string();
        if !custom.is_empty() && !selected.contains(&custom) {
            selected.push(custom);
        }
    }

    // Fall back to detected list if user deselected everything
    let notification_emails = if selected.is_empty() { detected } else { selected };

    store.update_state(|state| {
        state.settings.notification_emails = notification_emails;
    })?;

    cliclack::log::success("Notification emails configured")?;
    Ok(())
}

async fn step_authenticate() -> Result<()> {
    let store = auth::state_store();
    let config = auth::resolve_auth_config()?;

    match store.load_session_for_api_base_url(&config.api_base_url) {
        Ok(_session) => {
            cliclack::log::success("Already logged in.")?;
        }
        Err(_) => {
            login_with_prompt(&config, &store, auth::show_device_sign_in_prompt).await?;
            cliclack::log::success("Logged in.")?;
        }
    }

    Ok(())
}

fn step_configure_assistants() -> Result<()> {
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
            return Ok(());
        }

        let reconfigure: bool = cliclack::confirm("Re-configure assistants?")
            .initial_value(false)
            .interact()?;

        if !reconfigure {
            return Ok(());
        }
    }

    // In non-interactive mode, auto-select detected assistants
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
        return Ok(());
    }

    core_assistant::sync_discovery_assistants(&selected_assistants, build::command_name())?;

    cliclack::log::success("Assistants configured")?;

    Ok(())
}

async fn step_install_desktop_app() -> Result<()> {
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
        return Ok(());
    }

    if already_installed {
        let _ = ProcessCommand::new("open").args(["-a", "Everr"]).status();
        cliclack::log::success("Desktop app is now running in the menu bar.")?;
        return Ok(());
    }

    if !interactive {
        cliclack::log::remark("Install the desktop app from https://everr.dev")?;
        return Ok(());
    }

    let install: bool = cliclack::confirm("Do you want to install the Everr desktop app?\n\nThe desktop app runs in the menu bar and notifies you\nwhen your CI/CD pipelines fail or need attention.")
        .initial_value(true)
        .interact()?;

    if !install {
        cliclack::log::remark("You can install it later from https://everr.dev")?;
        return Ok(());
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

        copy_result.context("failed to copy app to /Applications")?;

        spinner.stop("Desktop app installed to /Applications/Everr.app");
    }

    let _ = ProcessCommand::new("open").args(["-a", "Everr"]).status();
    cliclack::log::success("Desktop app is now running in the menu bar.")?;

    Ok(())
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
            writeln!(
                &mut banner,
                "{logo:<width$}   {wordmark}",
                width = LOGO_COLUMN_WIDTH
            )
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
