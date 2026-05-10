use std::fmt::Write as _;
use std::io::IsTerminal;
use std::path::Path;
use std::process::Command as ProcessCommand;

use anyhow::{Context, Result, bail};
use everr_core::api::{ApiClient, MeResponse, OrgResponse};
use everr_core::auth::login_with_prompt;
use everr_core::build;
use everr_core::skills::{self as core_skills, SkillProvider, SkillScope};
use everr_core::state::Session;

use crate::auth;
use crate::skills as cli_skills;

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
const INSTALL_SKILLS_DEFAULT: bool = true;
const NOTIFICATION_EMAILS_NOTE: &str = "These emails are used to detect your own runs.";

#[derive(Default)]
struct SetupContext {
    me: Option<MeResponse>,
    org: Option<OrgResponse>,
}

pub async fn run() -> Result<()> {
    println!();
    print_banner();

    cliclack::intro("Setup")?;

    let session = step_authenticate().await?;
    let setup_context = load_setup_context(&session).await;
    print_setup_identity(&setup_context)?;

    if !should_skip_org_setup_steps(setup_context.org.as_ref()) {
        step_rename_org(&session, setup_context.org.as_ref()).await?;
        if OrgResponse::can_manage_runs_import_or_default(setup_context.org.as_ref()) {
            step_import_repos(&session).await?;
        }
    }

    step_configure_notification_emails(setup_context.me.as_ref()).await?;
    let skills_installed = step_install_skills()?;
    let desktop_installed = step_install_desktop_app().await?;
    step_mark_cloud_onboarding_complete(&session, setup_context.org.as_ref()).await?;

    auth::state_store().update_state(|state| {
        state
            .settings
            .mark_setup_complete(build::default_api_base_url());
    })?;

    print_next_steps()?;
    cliclack::outro(outro_message(skills_installed, desktop_installed))?;
    Ok(())
}

async fn load_setup_context(session: &Session) -> SetupContext {
    let Ok(client) = ApiClient::from_session(session) else {
        return SetupContext::default();
    };

    let (me, org) = tokio::join!(client.get_me(), client.get_org());
    SetupContext {
        me: me.ok(),
        org: org.ok(),
    }
}

fn print_setup_identity(context: &SetupContext) -> Result<()> {
    for line in auth::identity_summary_lines(
        context.me.as_ref().map(|me| me.email.as_str()),
        context.org.as_ref().map(|org| org.name.as_str()),
    ) {
        cliclack::log::success(line)?;
    }

    Ok(())
}

pub(crate) fn clean_org_name(name: &str) -> String {
    name.trim().to_string()
}

fn should_skip_org_setup_steps(org: Option<&OrgResponse>) -> bool {
    org.is_some_and(|org| org.onboarding_completed)
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
            Ok(session)
        }
    }
}

async fn step_rename_org(session: &Session, org: Option<&OrgResponse>) -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    if !interactive {
        return Ok(());
    }

    let Some(org) = org else { return Ok(()) };
    if org.onboarding_completed || !org.is_only_member {
        return Ok(());
    }

    let input: String = cliclack::input("Organization name")
        .default_input(&org.name)
        .interact()?;

    let new_name = clean_org_name(&input);
    if new_name == org.name || new_name.is_empty() {
        return Ok(());
    }

    let Ok(client) = ApiClient::from_session(session) else {
        return Ok(());
    };
    if client.patch_org_name(&new_name).await.is_err() {
        return Ok(());
    }
    cliclack::log::success(format!("Organization name set to \"{new_name}\""))?;
    Ok(())
}

async fn step_import_repos(session: &Session) -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    if !interactive {
        return Ok(());
    }

    let client = ApiClient::from_session(session)?;
    let repos = match client.get_repos().await {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };

    if repos.is_empty() {
        return Ok(());
    }

    const MAX_REPOS: usize = 3;

    let mut prompt =
        cliclack::multiselect("Select repositories to import (up to 3)").required(false);
    for repo in &repos {
        prompt = prompt.item(repo.full_name.clone(), repo.full_name.clone(), "");
    }
    let selected: Vec<String> = prompt.interact()?;

    if selected.is_empty() {
        cliclack::log::remark("No repositories selected, skipping import.")?;
        return Ok(());
    }

    let to_import: Vec<String> = selected.into_iter().take(MAX_REPOS).collect();

    match client.start_import_repos(&to_import).await {
        Ok(_) => cliclack::log::remark(
            "Import started - your data will appear gradually on the CLI results.",
        )?,
        Err(_) => cliclack::log::warning("Could not start import, skipping.")?,
    }

    Ok(())
}

const ADD_EMAIL_SENTINEL: &str = "__add_email__";

async fn step_configure_notification_emails(me: Option<&MeResponse>) -> Result<()> {
    let store = auth::state_store();
    let saved: Vec<String> = store
        .load_state()
        .map(|s| s.settings.notification_emails)
        .unwrap_or_default();
    let mut detected: Vec<String> = Vec::new();

    if let Some(me) = me {
        detected.push(me.email.clone());
        store.update_state(|state| {
            state.settings.user_profile = Some(everr_core::state::UserProfile {
                email: me.email.clone(),
                name: me.name.clone(),
                profile_url: me.profile_url.clone(),
            });
        })?;
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

    cliclack::note("Notification emails", NOTIFICATION_EMAILS_NOTE)?;

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

    let notification_emails = if selected.is_empty() {
        detected
    } else {
        selected
    };

    store.update_state(|state| {
        state.settings.notification_emails = notification_emails;
    })?;

    cliclack::log::success("Notification emails configured")?;
    Ok(())
}

async fn step_mark_cloud_onboarding_complete(
    session: &Session,
    org: Option<&OrgResponse>,
) -> Result<()> {
    let Some(org) = org else { return Ok(()) };
    if org.onboarding_completed || !org.can_manage_runs_import() {
        return Ok(());
    }

    let Ok(client) = ApiClient::from_session(session) else {
        return Ok(());
    };

    let _ = client.complete_org_onboarding().await;
    Ok(())
}

fn step_install_skills() -> Result<bool> {
    let interactive = std::io::stdin().is_terminal();
    let home_dir = dirs::home_dir().context("failed to resolve home directory")?;
    let provider_statuses = core_skills::provider_statuses(&home_dir);

    if interactive {
        cliclack::note(
            "Everr skills",
            "Everr can install skills that teach compatible agents how to debug CI and local telemetry.",
        )?;

        let install: bool = cliclack::confirm("Install Everr skills?")
            .initial_value(INSTALL_SKILLS_DEFAULT)
            .interact()?;
        if !install {
            cliclack::log::remark("Skipping Everr skills.")?;
            return Ok(false);
        }
    }

    let scope = if interactive {
        let global: bool = cliclack::confirm("Install skills globally instead of in this project?")
            .initial_value(cli_skills::GLOBAL_SKILL_SCOPE_DEFAULT)
            .interact()?;
        if global {
            SkillScope::Global
        } else {
            SkillScope::Project
        }
    } else {
        SkillScope::Project
    };

    let selected_providers: Vec<SkillProvider> = if interactive {
        let mut prompt = cliclack::multiselect("Select providers");
        for (i, status) in provider_statuses.iter().enumerate() {
            let label = status.provider.display_name();
            let hint = if status.detected {
                "detected"
            } else {
                "not detected"
            };
            prompt = prompt.item(i, label, hint);
        }
        let mut defaults: Vec<usize> = provider_statuses
            .iter()
            .enumerate()
            .filter(|(_, status)| status.detected)
            .map(|(i, _)| i)
            .collect();
        if defaults.is_empty() {
            defaults = (0..provider_statuses.len()).collect();
        }
        prompt = prompt.initial_values(defaults);

        let selected_indices: Vec<usize> = prompt.interact()?;
        selected_indices
            .iter()
            .map(|&i| provider_statuses[i].provider)
            .collect()
    } else {
        let detected: Vec<SkillProvider> = provider_statuses
            .iter()
            .filter(|status| status.detected)
            .map(|status| status.provider)
            .collect();
        if detected.is_empty() {
            SkillProvider::ALL.to_vec()
        } else {
            detected
        }
    };

    if selected_providers.is_empty() {
        cliclack::log::remark("No providers selected.")?;
        return Ok(false);
    }

    cli_skills::install_all_for_setup(scope, selected_providers, false)?;
    cliclack::log::success("Everr skills installed")?;

    Ok(true)
}

fn print_next_steps() -> Result<()> {
    let Some(home_dir) = dirs::home_dir() else {
        return Ok(());
    };

    let detected_agents: Vec<&'static str> = core_skills::provider_statuses(&home_dir)
        .into_iter()
        .filter(|status| status.detected)
        .map(|status| status.provider.display_name())
        .collect();

    cliclack::note("Try it out", next_steps_message(&detected_agents))?;
    Ok(())
}

fn next_steps_message(detected_agents: &[&str]) -> String {
    let cmd = build::command_name();
    if detected_agents.is_empty() {
        format!("Run `{cmd} ci runs` to view your imported runs.")
    } else {
        format!(
            "Run `{cmd} ci runs` to view your imported runs.\nOr ask {} to summarize them.",
            format_agent_list(detected_agents),
        )
    }
}

fn format_agent_list(agents: &[&str]) -> String {
    match agents {
        [] => String::new(),
        [a] => (*a).to_string(),
        [a, b] => format!("{a} or {b}"),
        [head @ .., last] => format!("{}, or {last}", head.join(", ")),
    }
}

fn outro_message(skills_installed: bool, desktop_installed: bool) -> &'static str {
    if skills_installed && desktop_installed {
        "Everr skills are installed - ask your agent about CI pipelines, failing jobs, workflow logs, or local telemetry.\nOr break something in CI - Everr will notify you with a ready-to-use fix prompt."
    } else if skills_installed {
        "Everr skills are installed - ask your agent about CI pipelines, failing jobs, workflow logs, or local telemetry."
    } else {
        "Run `everr skills install --all` in a repo to install Everr skills later."
    }
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
        let spinner = cliclack::spinner();
        spinner.start("Resolving latest desktop app...");

        let manifest_url = format!("{}/everr-app/latest.json", build::default_docs_base_url());
        let manifest: serde_json::Value = reqwest::get(&manifest_url)
            .await
            .context("failed to fetch latest.json")?
            .json()
            .await
            .context("failed to parse latest.json")?;
        let updater_url = manifest
            .pointer("/platforms/darwin-aarch64/url")
            .and_then(|v| v.as_str())
            .context("latest.json missing darwin-aarch64 url")?;
        let dmg_url = updater_url.replace(".app.tar.gz", ".dmg");

        spinner.set_message("Downloading desktop app...");

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

#[cfg(test)]
mod tests {
    #[test]
    fn clean_org_name_trims_whitespace() {
        assert_eq!(super::clean_org_name("  Acme Inc.  "), "Acme Inc.");
    }

    #[test]
    fn clean_org_name_preserves_inner_spaces() {
        assert_eq!(super::clean_org_name("Acme Corp"), "Acme Corp");
    }

    #[test]
    fn outro_message_with_skills_and_desktop() {
        let msg = super::outro_message(true, true);
        assert!(msg.contains("Everr skills"));
        assert!(msg.contains("break something in CI"));
    }

    #[test]
    fn outro_message_with_skills_no_desktop() {
        let msg = super::outro_message(true, false);
        assert!(msg.contains("Everr skills"));
        assert!(!msg.contains("break something in CI"));
    }

    #[test]
    fn outro_message_without_skills_installed() {
        assert!(super::outro_message(false, false).contains("everr skills install --all"));
    }

    #[test]
    fn next_steps_without_agents_only_suggests_cli_command() {
        let msg = super::next_steps_message(&[]);
        assert!(msg.contains("ci runs"));
        assert!(!msg.contains("ask "));
    }

    #[test]
    fn next_steps_with_one_agent_names_it() {
        let msg = super::next_steps_message(&["Claude Code"]);
        assert!(msg.contains("ci runs"));
        assert!(msg.contains("ask Claude Code"));
    }

    #[test]
    fn next_steps_with_two_agents_joins_with_or() {
        let msg = super::next_steps_message(&["Claude Code", "Codex"]);
        assert!(msg.contains("ask Claude Code or Codex"));
    }

    #[test]
    fn next_steps_with_three_agents_uses_oxford_comma() {
        let msg = super::next_steps_message(&["Codex", "Claude Code", "Cursor"]);
        assert!(msg.contains("ask Codex, Claude Code, or Cursor"));
    }

    #[test]
    fn setup_defaults_to_installing_skills() {
        assert!(super::INSTALL_SKILLS_DEFAULT);
    }

    #[test]
    fn setup_defaults_to_global_skill_scope() {
        assert!(super::cli_skills::GLOBAL_SKILL_SCOPE_DEFAULT);
    }

    #[test]
    fn email_note_says_emails_detect_own_runs() {
        assert_eq!(
            super::NOTIFICATION_EMAILS_NOTE,
            "These emails are used to detect your own runs."
        );
    }

    #[test]
    fn onboarded_org_skips_org_setup_steps() {
        let org = everr_core::api::OrgResponse {
            name: "Acme".to_string(),
            is_only_member: true,
            onboarding_completed: true,
            role: Some("admin".to_string()),
        };

        assert!(super::should_skip_org_setup_steps(Some(&org)));
    }

    #[test]
    fn not_onboarded_org_runs_org_setup_steps() {
        let org = everr_core::api::OrgResponse {
            name: "Acme".to_string(),
            is_only_member: true,
            onboarding_completed: false,
            role: Some("admin".to_string()),
        };

        assert!(!super::should_skip_org_setup_steps(Some(&org)));
    }

    #[test]
    fn setup_marks_desktop_wizard_complete() {
        use std::sync::Mutex;

        use everr_core::build;
        use everr_core::state::AppStateStore;

        static ENV_LOCK: Mutex<()> = Mutex::new(());

        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let temp = tempfile::tempdir().expect("tempdir");
        let config_home = temp.path().join("config");
        std::fs::create_dir_all(&config_home).expect("create config dir");

        let original_home = std::env::var_os("HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        unsafe {
            std::env::set_var("HOME", temp.path());
            std::env::set_var("XDG_CONFIG_HOME", &config_home);
        }

        let store = AppStateStore::for_namespace(build::session_namespace());
        store
            .update_state(|state| {
                state
                    .settings
                    .mark_setup_complete(build::default_api_base_url());
            })
            .expect("mark setup complete");

        let state = store.load_state().expect("loaded state");
        assert!(state.settings.wizard_state.wizard_completed);
        assert_eq!(
            state.settings.completed_base_url.as_deref(),
            Some(build::default_api_base_url())
        );

        match original_home {
            Some(value) => unsafe { std::env::set_var("HOME", value) },
            None => unsafe { std::env::remove_var("HOME") },
        }
        match original_xdg {
            Some(value) => unsafe { std::env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { std::env::remove_var("XDG_CONFIG_HOME") },
        }
    }
}
