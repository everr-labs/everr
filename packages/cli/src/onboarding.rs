use std::io::IsTerminal;
use std::path::Path;

use anyhow::{Context, Result};
use crate::build;
use crate::skill_store::{self as core_skills, SkillOperationOptions, SkillProvider, SkillScope};

use crate::auth;
use crate::skills as cli_skills;

#[derive(Default)]
struct SetupOutcome {
    skills_installed: bool,
}

struct NextStep {
    label: &'static str,
    command: String,
}

fn next_steps(cmd: &str, outcome: &SetupOutcome) -> Vec<NextStep> {
    let mut steps = vec![NextStep {
        label: "Start local telemetry (keep this terminal running)",
        command: format!("{cmd} local start"),
    }];
    if outcome.skills_installed {
        steps.push(NextStep {
            label: "Instrument your repo (ask your agent)",
            command: "/everr-onboard".to_string(),
        });
    }
    steps
}

fn print_summary(outcome: &SetupOutcome) -> Result<()> {
    let steps = next_steps(build::command_name(), outcome);
    let body = steps
        .iter()
        .map(|step| format!("{}\n{}", step.label, step.command))
        .collect::<Vec<_>>()
        .join("\n\n");
    cliclack::note("You're all set", body)?;
    Ok(())
}

pub async fn run() -> Result<()> {
    crate::banner::print_banner();

    cliclack::intro("Setup")?;

    let outcome = SetupOutcome {
        skills_installed: step_install_skills()?,
    };

    auth::state_store().update_state(|state| {
        state
            .settings
            .mark_setup_complete(build::default_api_base_url());
    })?;

    print_summary(&outcome)?;
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
    fn next_steps_always_includes_local_collector() {
        let steps = super::next_steps("everr", &super::SetupOutcome::default());
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].command, "everr local start");
    }

    #[test]
    fn next_steps_includes_telemetry_skill_only_when_skills_installed() {
        let with_skills = super::SetupOutcome {
            skills_installed: true,
        };
        assert!(
            super::next_steps("everr", &with_skills)
                .iter()
                .any(|step| step.command.contains("/everr-onboard"))
        );

        let without = super::SetupOutcome::default();
        assert!(
            !super::next_steps("everr", &without)
                .iter()
                .any(|step| step.command.contains("/everr-onboard"))
        );
    }

    #[test]
    fn next_steps_prefixes_cli_commands_with_command_name() {
        let outcome = super::SetupOutcome {
            skills_installed: true,
        };
        let steps = super::next_steps("everr-dev", &outcome);
        assert!(
            steps
                .iter()
                .all(|step| step.command.starts_with("everr-dev") || step.command.starts_with('/'))
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
