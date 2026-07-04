use std::io::IsTerminal;
use std::path::Path;

#[cfg(target_os = "macos")]
use std::process::Command as ProcessCommand;

#[cfg(target_os = "macos")]
use anyhow::bail;
use anyhow::{Context, Result};
use everr_core::api::{ApiClient, MeResponse, OrgResponse};
use everr_core::build;
use everr_core::skills::{self as core_skills, SkillOperationOptions, SkillProvider, SkillScope};
use everr_core::state::Session;

use crate::auth;
use crate::skills as cli_skills;

#[derive(Default)]
struct SetupOutcome {
    collector_running: bool,
    skills_installed: bool,
    repos_imported: bool,
}

struct NextStep {
    label: &'static str,
    command: String,
}

fn next_steps(cmd: &str, outcome: &SetupOutcome) -> Vec<NextStep> {
    let mut steps = Vec::new();
    if outcome.collector_running {
        steps.push(NextStep {
            label: "Explore your telemetry",
            command: format!("{cmd} local query \"SELECT * FROM logs LIMIT 20\""),
        });
    }
    if outcome.repos_imported {
        steps.push(NextStep {
            label: "View your imported CI runs",
            command: format!("{cmd} ci runs"),
        });
    }
    if outcome.skills_installed {
        steps.push(NextStep {
            label: "Instrument your repo (ask your agent)",
            command: "/everr-setup-telemetry".to_string(),
        });
    }
    steps
}

fn print_summary(outcome: &SetupOutcome) -> Result<()> {
    let steps = next_steps(build::command_name(), outcome);
    if steps.is_empty() {
        return Ok(());
    }
    let body = steps
        .iter()
        .map(|step| format!("{}\n{}", step.label, step.command))
        .collect::<Vec<_>>()
        .join("\n\n");
    cliclack::note("You're all set", body)?;
    Ok(())
}

#[derive(Default)]
struct SetupContext {
    me: Option<MeResponse>,
    org: Option<OrgResponse>,
}

pub async fn run() -> Result<()> {
    crate::banner::print_banner();

    cliclack::intro("Setup")?;

    let mut outcome = SetupOutcome::default();

    #[cfg(target_os = "macos")]
    {
        local_observability_intro()?;
        let app = step_install_desktop_app().await?;
        if app != DesktopApp::Skipped && verify_collector().await? {
            outcome.collector_running = true;
            // Only first-timers get walked through the demo; returning users
            // (app already installed) skip straight past it.
            if app == DesktopApp::Installed {
                run_first_telemetry_demo().await;
            }
        }
    }

    outcome.skills_installed = step_install_skills()?;

    step_connect_cloud(&mut outcome).await?;

    auth::state_store().update_state(|state| {
        state
            .settings
            .mark_setup_complete(build::default_api_base_url());
    })?;

    print_summary(&outcome)?;
    cliclack::outro("Observability, simplified.")?;
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
            let session = auth::login_with_device_authorization(&config, &store).await?;
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

async fn step_import_repos(session: &Session) -> Result<bool> {
    let interactive = std::io::stdin().is_terminal();
    if !interactive {
        return Ok(false);
    }

    let client = ApiClient::from_session(session)?;
    let repos = match client.get_repos().await {
        Ok(r) => r,
        Err(_) => return Ok(false),
    };

    if repos.is_empty() {
        return Ok(false);
    }

    const MAX_REPOS: usize = 3;

    let mut prompt = cliclack::multiselect("Select repositories to import (up to 3)")
        .required(false)
        .max_rows(10)
        .filter_mode();
    for repo in &repos {
        prompt = prompt.item(repo.full_name.clone(), repo.full_name.clone(), "");
    }
    let selected: Vec<String> = prompt.interact()?;

    if selected.is_empty() {
        cliclack::log::remark("No repositories selected, skipping import.")?;
        return Ok(false);
    }

    let to_import: Vec<String> = selected.into_iter().take(MAX_REPOS).collect();

    match client.start_import_repos(&to_import).await {
        Ok(_) => {
            cliclack::log::remark(
                "Import started - your data will appear gradually on the CLI results.",
            )?;
            Ok(true)
        }
        Err(_) => {
            cliclack::log::warning("Could not start import, skipping.")?;
            Ok(false)
        }
    }
}

fn existing_cloud_session() -> Option<Session> {
    let store = auth::state_store();
    let config = auth::resolve_auth_config().ok()?;
    store
        .load_session_for_api_base_url(&config.api_base_url)
        .ok()
}

async fn step_connect_cloud(outcome: &mut SetupOutcome) -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    if !interactive {
        return Ok(());
    }

    // Already connected from a previous run — no need to ask again.
    if existing_cloud_session().is_some() {
        cliclack::log::success("Already connected to Everr Cloud.")?;
        return Ok(());
    }

    cliclack::note(
        "② Connect Everr Cloud",
        "Query your cloud Telemetry, and track the status\nof your CI",
    )?;

    let connect = cliclack::confirm("Connect now?")
        .initial_value(true)
        .interact()?;
    if !connect {
        cliclack::log::remark(format!(
            "Run `{} cloud login` whenever you want to connect.",
            build::command_name()
        ))?;
        return Ok(());
    }

    // Soft-fail: once setup has done its local work, a cloud failure (auth
    // timeout, cancelled prompt, API error) must not abort the wizard before
    // it marks setup complete and prints the summary.
    if let Err(err) = connect_cloud(outcome).await {
        cliclack::log::warning(format!(
            "Couldn't finish connecting to Everr Cloud: {err}\nRun `{} cloud login` to try again.",
            build::command_name()
        ))?;
    }
    Ok(())
}

async fn connect_cloud(outcome: &mut SetupOutcome) -> Result<()> {
    let session = step_authenticate().await?;
    let context = load_setup_context(&session).await;
    print_setup_identity(&context)?;

    if let Some(me) = context.me.as_ref() {
        auth::state_store().update_state(|state| {
            state.settings.user_profile = Some(everr_core::state::UserProfile {
                email: me.email.clone(),
                name: me.name.clone(),
                profile_url: me.profile_url.clone(),
            });
        })?;
    }

    if !should_skip_org_setup_steps(context.org.as_ref()) {
        step_rename_org(&session, context.org.as_ref()).await?;
        if OrgResponse::can_manage_runs_import_or_default(context.org.as_ref()) {
            outcome.repos_imported = step_import_repos(&session).await?;
        }
    }

    step_mark_cloud_onboarding_complete(&session, context.org.as_ref()).await?;
    Ok(())
}

async fn step_mark_cloud_onboarding_complete(
    session: &Session,
    org: Option<&OrgResponse>,
) -> Result<()> {
    let Some(org) = org else { return Ok(()) };
    if org.onboarding_completed {
        return Ok(());
    }

    let Ok(client) = ApiClient::from_session(session) else {
        return Ok(());
    };

    let _ = client.complete_org_onboarding().await;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum SkillTarget {
    #[default]
    Claude,
    Agents,
}

fn skill_target_providers(targets: &[SkillTarget]) -> Vec<SkillProvider> {
    targets
        .iter()
        .flat_map(|target| match target {
            SkillTarget::Claude => vec![SkillProvider::ClaudeCode],
            SkillTarget::Agents => vec![SkillProvider::Codex, SkillProvider::Cursor],
        })
        .collect()
}

fn default_targets(statuses: &[core_skills::SkillProviderStatus]) -> Vec<SkillTarget> {
    let detected = |provider: SkillProvider| {
        statuses
            .iter()
            .any(|status| status.provider == provider && status.detected)
    };
    let mut targets = Vec::new();
    if detected(SkillProvider::ClaudeCode) {
        targets.push(SkillTarget::Claude);
    }
    if detected(SkillProvider::Codex) || detected(SkillProvider::Cursor) {
        targets.push(SkillTarget::Agents);
    }
    targets
}

fn step_install_skills() -> Result<bool> {
    let interactive = std::io::stdin().is_terminal();
    let home_dir = dirs::home_dir().context("failed to resolve home directory")?;
    let provider_statuses = core_skills::provider_statuses(&home_dir);

    if has_global_bundled_skills_installed(&home_dir)? {
        let summary = cli_skills::install_all_for_setup(SkillScope::Global, Vec::new())?;
        cliclack::note("Everr skills installed", summary.skills.join("\n"))?;
        return Ok(true);
    }

    if interactive {
        cliclack::note(
            "Skills",
            "Everr skills teach your coding agent to instrument code and\nquery your telemetry while it works.",
        )?;
    }

    let providers = if interactive {
        let defaults = default_targets(&provider_statuses);
        let selected: Vec<SkillTarget> = cliclack::multiselect("Install skills for")
            .required(false)
            .item(SkillTarget::Claude, "Claude", "")
            .item(SkillTarget::Agents, "Agents (Codex, etc.)", "")
            .initial_values(defaults)
            .interact()?;
        skill_target_providers(&selected)
    } else {
        skill_target_providers(&default_targets(&provider_statuses))
    };

    if providers.is_empty() {
        cliclack::log::remark("Skipping Everr skills.")?;
        return Ok(false);
    }

    let summary = cli_skills::install_all_for_setup(SkillScope::Global, providers)?;
    cliclack::note("Everr skills installed", summary.skills.join("\n"))?;
    Ok(true)
}

fn has_global_bundled_skills_installed(home_dir: &Path) -> Result<bool> {
    let options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: std::env::current_dir().context("could not determine current directory")?,
        home_dir: home_dir.to_path_buf(),
        providers: Vec::new(),
        skill_names: Vec::new(),
        all: false,
        dry_run: false,
    };
    core_skills::has_installed_bundled_skill(&options)
}

#[cfg(target_os = "macos")]
fn local_observability_intro() -> Result<()> {
    cliclack::note(
        "① Local observability",
        "The Everr desktop app comes with a local collector\nand a way to look at the telemetry you collect locally.\n\nWhen authenticated it notifies you when one of your pipelines fails.",
    )?;
    Ok(())
}

#[cfg(target_os = "macos")]
async fn verify_collector() -> Result<bool> {
    use std::time::Duration;

    let spinner = cliclack::spinner();
    spinner.start("Starting the local collector…");

    let endpoint = format!(
        "{}/",
        everr_core::build::healthcheck_origin().trim_end_matches('/')
    );
    let result =
        everr_core::collector::wait_healthcheck_result(&endpoint, Duration::from_secs(15)).await;

    match result {
        everr_core::collector::HealthcheckResult::Running => {
            spinner.stop(format!(
                "Collector running — {}",
                everr_core::build::otlp_http_origin()
            ));
            Ok(true)
        }
        _ => {
            spinner.stop("The collector is still starting — it'll come online shortly.");
            Ok(false)
        }
    }
}

#[cfg(target_os = "macos")]
async fn run_first_telemetry_demo() -> bool {
    let spinner = cliclack::spinner();
    spinner.start("Capturing your first telemetry…");

    let Ok(exe) = std::env::current_exe() else {
        spinner.stop("Skipped the first-telemetry demo.");
        return false;
    };

    let status = tokio::process::Command::new(exe)
        .args(["wrap", "--", "echo", "hello, everr"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    match status {
        Ok(status) if status.success() => {
            spinner.stop("First telemetry captured: \"hello, everr\"");
            true
        }
        _ => {
            spinner.stop("Couldn't capture demo telemetry — skipping.");
            false
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopApp {
    /// Freshly installed during this run.
    Installed,
    /// Already installed or running before setup.
    AlreadyPresent,
    /// Not installed (declined or non-interactive).
    Skipped,
}

#[cfg(target_os = "macos")]
async fn step_install_desktop_app() -> Result<DesktopApp> {
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
        return Ok(DesktopApp::AlreadyPresent);
    }

    if already_installed {
        let _ = ProcessCommand::new("open").args(["-a", "Everr"]).status();
        cliclack::log::success("Desktop app is now running in the menu bar.")?;
        return Ok(DesktopApp::AlreadyPresent);
    }

    if !interactive {
        cliclack::log::remark("Install the desktop app from https://everr.dev")?;
        return Ok(DesktopApp::Skipped);
    }

    let install: bool = cliclack::confirm("Do you want to install the Everr desktop app?\n\nThe desktop app runs in the menu bar and notifies you\nwhen your CI/CD pipelines fail or need attention.")
        .initial_value(true)
        .interact()?;

    if !install {
        cliclack::log::remark("You can install it later from https://everr.dev")?;
        return Ok(DesktopApp::Skipped);
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
            .and_then(|line| line.split('\t').next_back())
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

    Ok(DesktopApp::Installed)
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
    fn claude_target_maps_to_claude_code() {
        use everr_core::skills::SkillProvider;
        assert_eq!(
            super::skill_target_providers(&[super::SkillTarget::Claude]),
            vec![SkillProvider::ClaudeCode]
        );
    }

    #[test]
    fn agents_target_maps_to_codex_and_cursor() {
        use everr_core::skills::SkillProvider;
        assert_eq!(
            super::skill_target_providers(&[super::SkillTarget::Agents]),
            vec![SkillProvider::Codex, SkillProvider::Cursor]
        );
    }

    #[test]
    fn both_targets_map_to_all_providers() {
        use everr_core::skills::SkillProvider;
        assert_eq!(
            super::skill_target_providers(&[
                super::SkillTarget::Claude,
                super::SkillTarget::Agents
            ]),
            vec![
                SkillProvider::ClaudeCode,
                SkillProvider::Codex,
                SkillProvider::Cursor
            ]
        );
    }

    #[test]
    fn no_targets_map_to_empty() {
        assert!(super::skill_target_providers(&[]).is_empty());
    }

    #[test]
    fn default_targets_selects_only_detected_groups() {
        use everr_core::skills::{SkillProvider, SkillProviderStatus};
        let statuses = vec![
            SkillProviderStatus {
                provider: SkillProvider::ClaudeCode,
                detected: true,
                path: String::new(),
            },
            SkillProviderStatus {
                provider: SkillProvider::Codex,
                detected: false,
                path: String::new(),
            },
            SkillProviderStatus {
                provider: SkillProvider::Cursor,
                detected: false,
                path: String::new(),
            },
        ];
        assert_eq!(
            super::default_targets(&statuses),
            vec![super::SkillTarget::Claude]
        );
    }

    #[test]
    fn next_steps_includes_local_query_when_collector_running() {
        let outcome = super::SetupOutcome {
            collector_running: true,
            skills_installed: false,
            repos_imported: false,
        };
        let steps = super::next_steps("everr", &outcome);
        assert_eq!(steps.len(), 1);
        assert_eq!(
            steps[0].command,
            "everr local query \"SELECT * FROM logs LIMIT 20\""
        );
    }

    #[test]
    fn next_steps_includes_ci_runs_only_when_imported() {
        let imported = super::SetupOutcome {
            collector_running: false,
            skills_installed: false,
            repos_imported: true,
        };
        assert!(
            super::next_steps("everr", &imported)
                .iter()
                .any(|step| step.command.contains("ci runs"))
        );

        let not_imported = super::SetupOutcome::default();
        assert!(
            !super::next_steps("everr", &not_imported)
                .iter()
                .any(|step| step.command.contains("ci runs"))
        );
    }

    #[test]
    fn next_steps_includes_telemetry_skill_only_when_skills_installed() {
        let with_skills = super::SetupOutcome {
            collector_running: false,
            skills_installed: true,
            repos_imported: false,
        };
        assert!(
            super::next_steps("everr", &with_skills)
                .iter()
                .any(|step| step.command.contains("/everr-setup-telemetry"))
        );

        let without = super::SetupOutcome::default();
        assert!(
            !super::next_steps("everr", &without)
                .iter()
                .any(|step| step.command.contains("/everr-setup-telemetry"))
        );
    }

    #[test]
    fn next_steps_empty_when_nothing_done() {
        assert!(super::next_steps("everr", &super::SetupOutcome::default()).is_empty());
    }

    #[test]
    fn next_steps_prefixes_cli_commands_with_command_name() {
        let outcome = super::SetupOutcome {
            collector_running: true,
            skills_installed: true,
            repos_imported: true,
        };
        let steps = super::next_steps("everr-dev", &outcome);
        assert!(
            steps
                .iter()
                .all(|step| step.command.starts_with("everr-dev") || step.command.starts_with('/'))
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
        use everr_core::build;
        use everr_core::state::AppStateStore;

        let _guard = crate::test_support::ENV_LOCK
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
