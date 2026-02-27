use std::env;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use dialoguer::MultiSelect;

use crate::assistant;
use crate::auth;
use crate::cli::{AssistantKind, LoginArgs};

trait AssistantSelector {
    fn select(&self, labels: &[&str], defaults: &[bool]) -> Result<Vec<usize>>;
}

struct DialoguerAssistantSelector;

impl AssistantSelector for DialoguerAssistantSelector {
    fn select(&self, labels: &[&str], defaults: &[bool]) -> Result<Vec<usize>> {
        Ok(MultiSelect::new()
            .with_prompt("Select assistants to configure globally")
            .items(labels)
            .defaults(defaults)
            .interact()?)
    }
}

pub async fn run_install_wizard() -> Result<()> {
    let mut summary: Vec<String> = Vec::new();

    let command_install = install_command_binary()?;
    if command_install.installed_now {
        summary.push(format!(
            "command: installed everr at {}",
            command_install.destination.display()
        ));
    } else {
        summary.push(format!(
            "command: already installed at {}",
            command_install.destination.display()
        ));
    }
    if !command_install.in_path {
        summary.push(format!(
            "command: add {} to PATH to run `everr` from any shell",
            command_install
                .destination
                .parent()
                .map_or_else(|| "<unknown>".to_string(), |p| p.display().to_string())
        ));
    }

    if auth::has_active_session()? {
        summary.push("auth: active session found".to_string());
    } else {
        auth::login(LoginArgs {
            api_base_url: None,
            token: None,
        })
        .await?;
        summary.push("auth: logged in".to_string());
    }

    let refreshed = assistant::refresh_existing_managed_prompts()?;
    if let Some(refreshed_summary) = refreshed_assistants_summary(&refreshed) {
        summary.push(refreshed_summary);
    }

    let assistants = prompt_assistants()?;
    if !assistants.is_empty() {
        assistant::init_assistants(&assistants)?;
    }
    summary.push(assistants_summary(&assistants));

    // let daemon_result = daemon::install_if_missing()?;
    // if daemon_result.installed_now {
    //     summary.push(format!(
    //         "daemon: installed service at {}",
    //         daemon_result.service_path.display()
    //     ));
    // } else {
    //     summary.push("daemon: service already installed".to_string());
    // }
    // if daemon_result.started {
    //     summary.push("daemon: service started".to_string());
    // } else {
    //     summary.push(
    //         "daemon: service file installed but start command failed (start it manually)"
    //             .to_string(),
    //     );
    // }

    println!("\nInstall summary:");
    for item in summary {
        println!("- {item}");
    }
    Ok(())
}

fn assistant_label(assistant: AssistantKind) -> &'static str {
    match assistant {
        AssistantKind::Codex => "Codex",
        AssistantKind::Claude => "Claude",
        AssistantKind::Cursor => "Cursor",
    }
}

fn refreshed_assistants_summary(refreshed: &[AssistantKind]) -> Option<String> {
    if refreshed.is_empty() {
        return None;
    }

    Some(format!(
        "assistants: updated stale prompts for {}",
        refreshed
            .iter()
            .map(|assistant| assistant_label(*assistant))
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn assistants_summary(selected: &[AssistantKind]) -> String {
    if selected.is_empty() {
        "assistants: skipped".to_string()
    } else {
        format!("assistants: configured {}", selected.len())
    }
}

fn prompt_assistants() -> Result<Vec<AssistantKind>> {
    let defaults = assistant_defaults()?;
    let selector = DialoguerAssistantSelector;
    prompt_assistants_with(&selector, defaults)
}

fn prompt_assistants_with(
    selector: &dyn AssistantSelector,
    defaults: [bool; 3],
) -> Result<Vec<AssistantKind>> {
    let labels = ["Codex", "Claude", "Cursor"];
    let indexes = selector.select(&labels, &defaults)?;
    selected_assistants_from_indexes(&indexes)
}

fn assistant_defaults() -> Result<[bool; 3]> {
    assistant_defaults_with(assistant::is_assistant_installed)
}

fn assistant_defaults_with<F>(mut is_assistant_installed: F) -> Result<[bool; 3]>
where
    F: FnMut(AssistantKind) -> Result<bool>,
{
    Ok([
        is_assistant_installed(AssistantKind::Codex)?,
        is_assistant_installed(AssistantKind::Claude)?,
        is_assistant_installed(AssistantKind::Cursor)?,
    ])
}

fn selected_assistants_from_indexes(indexes: &[usize]) -> Result<Vec<AssistantKind>> {
    let choices = [
        AssistantKind::Codex,
        AssistantKind::Claude,
        AssistantKind::Cursor,
    ];

    let mut selected = Vec::with_capacity(indexes.len());
    for index in indexes {
        let Some(assistant) = choices.get(*index) else {
            bail!("invalid assistant index: {index}");
        };
        selected.push(*assistant);
    }

    Ok(selected)
}

struct CommandInstallResult {
    destination: PathBuf,
    installed_now: bool,
    in_path: bool,
}

fn install_command_binary() -> Result<CommandInstallResult> {
    let source = env::current_exe().context("failed to resolve current executable path")?;
    let destination_dir = command_install_dir()?;
    fs::create_dir_all(&destination_dir)
        .with_context(|| format!("failed to create {}", destination_dir.display()))?;
    let destination = destination_dir.join("everr");

    let source_canonical = fs::canonicalize(&source).ok();
    let destination_canonical = fs::canonicalize(&destination).ok();
    let installed_now = match (
        source_canonical.as_deref(),
        destination_canonical.as_deref(),
    ) {
        (Some(source_path), Some(destination_path)) if source_path == destination_path => false,
        _ => {
            fs::copy(&source, &destination).with_context(|| {
                format!(
                    "failed to copy binary from {} to {}",
                    source.display(),
                    destination.display()
                )
            })?;
            true
        }
    };

    let in_path = is_dir_in_path(&destination_dir);
    Ok(CommandInstallResult {
        destination,
        installed_now,
        in_path,
    })
}

fn command_install_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("failed to resolve home dir")?;
    Ok(home.join(".local").join("bin"))
}

fn is_dir_in_path(dir: &PathBuf) -> bool {
    let Some(path) = env::var_os("PATH") else {
        return false;
    };
    env::split_paths(&path).any(|p| p == *dir)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use anyhow::Result;

    use super::{
        AssistantSelector, assistant_defaults_with, assistants_summary, prompt_assistants_with,
        refreshed_assistants_summary,
    };
    use crate::cli::AssistantKind;

    struct StubSelector {
        indexes: Vec<usize>,
        seen_defaults: RefCell<Vec<bool>>,
    }

    impl AssistantSelector for StubSelector {
        fn select(&self, _labels: &[&str], defaults: &[bool]) -> Result<Vec<usize>> {
            self.seen_defaults.replace(defaults.to_vec());
            Ok(self.indexes.to_vec())
        }
    }

    #[test]
    fn prompt_assistants_maps_indexes_to_assistants() {
        let selector = StubSelector {
            indexes: vec![0, 2],
            seen_defaults: RefCell::new(Vec::new()),
        };

        let selected = prompt_assistants_with(&selector, [true, false, true])
            .expect("expected selection to succeed");

        assert_eq!(selector.seen_defaults.into_inner(), vec![true, false, true]);
        assert_eq!(selected, vec![AssistantKind::Codex, AssistantKind::Cursor]);
    }

    #[test]
    fn assistant_defaults_reflect_installation_state() {
        let defaults = assistant_defaults_with(|assistant| {
            Ok(matches!(
                assistant,
                AssistantKind::Codex | AssistantKind::Cursor
            ))
        })
        .expect("expected defaults to be resolved");

        assert_eq!(defaults, [true, false, true]);
    }

    #[test]
    fn assistants_summary_reports_skipped_when_empty() {
        assert_eq!(assistants_summary(&[]), "assistants: skipped");
    }

    #[test]
    fn assistant_summaries_include_refreshed_and_configured_counts() {
        let refreshed =
            refreshed_assistants_summary(&[AssistantKind::Codex, AssistantKind::Cursor])
                .expect("expected refreshed summary");
        assert_eq!(
            refreshed,
            "assistants: updated stale prompts for Codex, Cursor"
        );

        let configured = assistants_summary(&[AssistantKind::Codex, AssistantKind::Claude]);
        assert_eq!(configured, "assistants: configured 2");
    }
}
