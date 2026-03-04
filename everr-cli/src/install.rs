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
    install_command_binary()?;

    if !auth::has_active_session()? {
        auth::login(LoginArgs {}).await?;
    }

    let _ = assistant::refresh_existing_managed_prompts()?;

    let assistants = prompt_assistants()?;
    if !assistants.is_empty() {
        assistant::init_assistants(&assistants)?;
    }
    Ok(())
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

fn install_command_binary() -> Result<()> {
    let source = env::current_exe().context("failed to resolve current executable path")?;
    let destination_dir = command_install_dir()?;
    fs::create_dir_all(&destination_dir)
        .with_context(|| format!("failed to create {}", destination_dir.display()))?;
    let destination = destination_dir.join("everr");

    let source_canonical = fs::canonicalize(&source).ok();
    let destination_canonical = fs::canonicalize(&destination).ok();
    match (
        source_canonical.as_deref(),
        destination_canonical.as_deref(),
    ) {
        (Some(source_path), Some(destination_path)) if source_path == destination_path => {}
        _ => {
            fs::copy(&source, &destination).with_context(|| {
                format!(
                    "failed to copy binary from {} to {}",
                    source.display(),
                    destination.display()
                )
            })?;
        }
    }

    Ok(())
}

fn command_install_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("failed to resolve home dir")?;
    Ok(home.join(".local").join("bin"))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use anyhow::Result;

    use super::{AssistantSelector, assistant_defaults_with, prompt_assistants_with};
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
}
