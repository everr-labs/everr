use std::io::IsTerminal;
use std::path::Path;

use crate::build;
use crate::skill_store::{self as core_skills, SkillOperationOptions, SkillProvider, SkillScope};
use anyhow::{Context, Result};

use crate::auth;
use crate::skills as cli_skills;

fn print_summary() -> Result<()> {
    let cmd = build::command_name();
    cliclack::note(
        "You're all set",
        format!("Start local telemetry (keep this terminal running)\n{cmd} local start"),
    )?;
    Ok(())
}

pub async fn run() -> Result<()> {
    crate::banner::print_banner();

    cliclack::intro("Setup")?;

    step_install_skills()?;

    auth::state_store().update_state(|state| {
        state
            .settings
            .mark_setup_complete(build::default_api_base_url());
    })?;

    print_summary()?;
    cliclack::outro("Observability, simplified.")?;
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

fn step_install_skills() -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    let home_dir = dirs::home_dir().context("failed to resolve home directory")?;
    let provider_statuses = core_skills::provider_statuses(&home_dir);

    if has_global_bundled_skills_installed(&home_dir)? {
        let summary = cli_skills::install_all_for_setup(SkillScope::Global, Vec::new())?;
        cliclack::note("Everr skills installed", summary.skills.join("\n"))?;
        return Ok(());
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
        return Ok(());
    }

    let summary = cli_skills::install_all_for_setup(SkillScope::Global, providers)?;
    cliclack::note("Everr skills installed", summary.skills.join("\n"))?;
    Ok(())
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

#[cfg(test)]
mod tests {
    #[test]
    fn claude_target_maps_to_claude_code() {
        use crate::skill_store::SkillProvider;
        assert_eq!(
            super::skill_target_providers(&[super::SkillTarget::Claude]),
            vec![SkillProvider::ClaudeCode]
        );
    }

    #[test]
    fn agents_target_maps_to_codex_and_cursor() {
        use crate::skill_store::SkillProvider;
        assert_eq!(
            super::skill_target_providers(&[super::SkillTarget::Agents]),
            vec![SkillProvider::Codex, SkillProvider::Cursor]
        );
    }

    #[test]
    fn both_targets_map_to_all_providers() {
        use crate::skill_store::SkillProvider;
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
        use crate::skill_store::{SkillProvider, SkillProviderStatus};
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
    fn setup_marks_wizard_complete() {
        use crate::build;
        use crate::state::AppStateStore;

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
