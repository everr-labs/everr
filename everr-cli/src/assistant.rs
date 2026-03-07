use anyhow::Result;
use everr_core::assistant as core_assistant;
use everr_core::assistant::AssistantKind as CoreAssistantKind;

use crate::cli::{AssistantInitArgs, AssistantKind};

pub fn init_from_args(args: AssistantInitArgs) -> Result<()> {
    init_assistants(&args.assistants)
}

pub fn init_assistants(assistants: &[AssistantKind]) -> Result<()> {
    let assistants = assistants
        .iter()
        .copied()
        .map(to_core_assistant)
        .collect::<Vec<_>>();
    core_assistant::init_assistants(&assistants, &command_name())?;
    for assistant in assistants {
        let path = core_assistant::assistant_path(assistant)?;
        println!("Configured {:?} at {}", assistant, path.display());
    }
    Ok(())
}

pub fn is_assistant_installed(assistant: AssistantKind) -> Result<bool> {
    core_assistant::is_assistant_configured(to_core_assistant(assistant))
}

pub fn remove_managed_prompts() -> Result<()> {
    core_assistant::remove_managed_prompts()
}

pub fn refresh_existing_managed_prompts() -> Result<Vec<AssistantKind>> {
    core_assistant::refresh_existing_managed_prompts(&command_name()).map(|assistants| {
        assistants
            .into_iter()
            .map(from_core_assistant)
            .collect::<Vec<_>>()
    })
}

fn to_core_assistant(assistant: AssistantKind) -> CoreAssistantKind {
    match assistant {
        AssistantKind::Codex => CoreAssistantKind::Codex,
        AssistantKind::Claude => CoreAssistantKind::Claude,
        AssistantKind::Cursor => CoreAssistantKind::Cursor,
    }
}

fn from_core_assistant(assistant: CoreAssistantKind) -> AssistantKind {
    match assistant {
        CoreAssistantKind::Codex => AssistantKind::Codex,
        CoreAssistantKind::Claude => AssistantKind::Claude,
        CoreAssistantKind::Cursor => AssistantKind::Cursor,
    }
}

fn command_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "everr".to_string())
}

#[cfg(test)]
mod tests {
    use everr_core::assistant::AssistantKind as CoreAssistantKind;

    use super::{command_name, from_core_assistant, to_core_assistant};
    use crate::cli::AssistantKind;

    #[test]
    fn assistant_kind_mapping_round_trips() {
        for assistant in [
            AssistantKind::Codex,
            AssistantKind::Claude,
            AssistantKind::Cursor,
        ] {
            assert_eq!(from_core_assistant(to_core_assistant(assistant)), assistant);
        }
    }

    #[test]
    fn command_name_defaults_to_everr_when_executable_is_missing() {
        let current_name = command_name();
        assert!(
            current_name == "everr"
                || current_name == "everr-dev"
                || current_name
                    == std::env::current_exe()
                        .ok()
                        .and_then(|path| {
                            path.file_name()
                                .and_then(|name| name.to_str())
                                .map(str::to_owned)
                        })
                        .unwrap_or_default()
        );
    }

    #[test]
    fn core_mapping_matches_expected_variants() {
        assert_eq!(
            to_core_assistant(AssistantKind::Codex),
            CoreAssistantKind::Codex
        );
        assert_eq!(
            to_core_assistant(AssistantKind::Claude),
            CoreAssistantKind::Claude
        );
        assert_eq!(
            to_core_assistant(AssistantKind::Cursor),
            CoreAssistantKind::Cursor
        );
    }
}
