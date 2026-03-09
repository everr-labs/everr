use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

const BLOCK_START: &str = "<!-- EVERR_CLI_START -->";
const BLOCK_END: &str = "<!-- EVERR_CLI_END -->";
const ASSISTANT_INSTRUCTIONS: &str = include_str!("../assets/assistant-instructions.md");
const CURSOR_RULE_HEADER: &str = concat!(
    "---\n",
    "description: Use Everr CLI to inspect CI health, failures, and logs before guessing.\n",
    "globs:\n",
    "alwaysApply: true\n",
    "---\n\n"
);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistantKind {
    Codex,
    Claude,
    Cursor,
}

impl AssistantKind {
    pub const ALL: [Self; 3] = [Self::Codex, Self::Claude, Self::Cursor];
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AssistantStatus {
    pub assistant: AssistantKind,
    pub detected: bool,
    pub configured: bool,
    pub path: String,
}

pub fn init_assistants(assistants: &[AssistantKind], command_name: &str) -> Result<()> {
    if assistants.is_empty() {
        bail!("no assistants selected");
    }

    for assistant in assistants {
        let path = path_for_assistant(*assistant)?;
        write_managed_block(
            &path,
            *assistant,
            content_for_assistant(*assistant, command_name),
        )?;
    }

    Ok(())
}

pub fn sync_assistants(assistants: &[AssistantKind], command_name: &str) -> Result<()> {
    for assistant in AssistantKind::ALL {
        let path = path_for_assistant(assistant)?;
        if assistants.contains(&assistant) {
            write_managed_block(
                &path,
                assistant,
                content_for_assistant(assistant, command_name),
            )?;
            continue;
        }

        remove_managed_prompt_at(&path)?;
    }

    Ok(())
}

pub fn is_assistant_configured(assistant: AssistantKind) -> Result<bool> {
    let path = path_for_assistant(assistant)?;
    if !path.exists() {
        return Ok(false);
    }

    let current =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    Ok(current.contains(BLOCK_START) && current.contains(BLOCK_END))
}

pub fn assistant_statuses() -> Result<Vec<AssistantStatus>> {
    AssistantKind::ALL
        .into_iter()
        .map(status_for_assistant)
        .collect()
}

pub fn assistant_path(assistant: AssistantKind) -> Result<PathBuf> {
    path_for_assistant(assistant)
}

pub fn refresh_existing_managed_prompts(command_name: &str) -> Result<Vec<AssistantKind>> {
    let mut refreshed = Vec::new();

    for assistant in AssistantKind::ALL {
        let path = path_for_assistant(assistant)?;
        if !path.exists() {
            continue;
        }

        let current = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        if !(current.contains(BLOCK_START) && current.contains(BLOCK_END)) {
            continue;
        }

        let next = upsert_managed_block(
            assistant,
            &current,
            &content_for_assistant(assistant, command_name),
        );
        if next == current {
            continue;
        }

        fs::write(&path, next).with_context(|| format!("failed to write {}", path.display()))?;
        refreshed.push(assistant);
    }

    Ok(refreshed)
}

pub fn remove_managed_prompts() -> Result<()> {
    for assistant in AssistantKind::ALL {
        let path = path_for_assistant(assistant)?;
        remove_managed_prompt_at(&path)?;
    }

    Ok(())
}

fn status_for_assistant(assistant: AssistantKind) -> Result<AssistantStatus> {
    let home = resolve_home_dir()?;
    let configured = is_assistant_configured(assistant)?;
    let detected = assistant_root_for_home(&home, assistant).exists() || configured;
    let path = path_for_assistant_in(&home, assistant);

    Ok(AssistantStatus {
        assistant,
        detected,
        configured,
        path: path.display().to_string(),
    })
}

fn path_for_assistant(assistant: AssistantKind) -> Result<PathBuf> {
    let home = resolve_home_dir()?;
    Ok(path_for_assistant_in(&home, assistant))
}

fn path_for_assistant_in(home: &Path, assistant: AssistantKind) -> PathBuf {
    match assistant {
        AssistantKind::Codex => home.join(".codex").join("AGENTS.md"),
        AssistantKind::Claude => home.join(".claude").join("CLAUDE.md"),
        AssistantKind::Cursor => home.join(".cursor").join("rules").join("everr.mdc"),
    }
}

fn assistant_root_for_home(home: &Path, assistant: AssistantKind) -> PathBuf {
    match assistant {
        AssistantKind::Codex => home.join(".codex"),
        AssistantKind::Claude => home.join(".claude"),
        AssistantKind::Cursor => home.join(".cursor"),
    }
}

fn resolve_home_dir() -> Result<PathBuf> {
    dirs::home_dir().context("failed to resolve home dir")
}

fn content_for_assistant(assistant: AssistantKind, command_name: &str) -> String {
    let instructions = render_assistant_instructions(command_name);
    let managed_body = format!("{BLOCK_START}\n{}\n{BLOCK_END}\n", instructions.trim_end());

    match assistant {
        AssistantKind::Cursor => format!("{CURSOR_RULE_HEADER}{managed_body}"),
        AssistantKind::Codex | AssistantKind::Claude => managed_body,
    }
}

fn render_assistant_instructions(command_name: &str) -> String {
    ASSISTANT_INSTRUCTIONS.replace("`everr ", &format!("`{command_name} "))
}

fn remove_managed_prompt_at(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let current =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let next = remove_managed_block(&current);
    if next == current {
        return Ok(());
    }

    if next.trim().is_empty() {
        fs::remove_file(path).with_context(|| format!("failed to remove {}", path.display()))?;
    } else {
        fs::write(path, next).with_context(|| format!("failed to write {}", path.display()))?;
    }

    Ok(())
}

fn write_managed_block(path: &Path, assistant: AssistantKind, block: String) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let next = if path.exists() {
        let current = fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        upsert_managed_block(assistant, &current, &block)
    } else {
        block
    };

    fs::write(path, next).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn upsert_managed_block(assistant: AssistantKind, current: &str, block: &str) -> String {
    match assistant {
        AssistantKind::Cursor => {
            let remaining = remove_managed_block(current);
            if remaining.trim().is_empty() {
                block.to_string()
            } else {
                format!("{}\n\n{}\n", block.trim_end(), remaining.trim())
            }
        }
        AssistantKind::Codex | AssistantKind::Claude => match managed_block_range(current) {
            Some((start, end)) => {
                let mut out = String::with_capacity(current.len() + block.len());
                out.push_str(&current[..start]);
                out.push_str(block);
                if end < current.len() {
                    out.push_str(&current[end..]);
                }
                out
            }
            None => {
                if current.trim().is_empty() {
                    block.to_string()
                } else {
                    format!("{current}\n\n{block}")
                }
            }
        },
    }
}

fn remove_managed_block(current: &str) -> String {
    match managed_block_range(current) {
        Some((start, end)) => {
            let mut out = String::with_capacity(current.len());
            out.push_str(&current[..start]);
            if end < current.len() {
                out.push_str(&current[end..]);
            }
            out.trim().to_string()
        }
        None => current.to_string(),
    }
}

fn managed_block_range(current: &str) -> Option<(usize, usize)> {
    let start = current.find(BLOCK_START)?;
    let end_marker = current.find(BLOCK_END)?;
    if end_marker < start {
        return None;
    }

    let mut end = end_marker + BLOCK_END.len();
    if current[end..].starts_with("\r\n") {
        end += 2;
    } else if current[end..].starts_with('\n') {
        end += 1;
    }

    Some((start, end))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::tempdir;

    use super::{
        AssistantKind, assistant_root_for_home, content_for_assistant, path_for_assistant_in,
        remove_managed_block, render_assistant_instructions, upsert_managed_block,
    };

    #[test]
    fn path_mapping_uses_expected_home_locations() {
        let home = tempdir().expect("tempdir");
        let home_path = home.path();

        assert_eq!(
            path_for_assistant_in(home_path, AssistantKind::Codex),
            home_path.join(".codex").join("AGENTS.md")
        );
        assert_eq!(
            path_for_assistant_in(home_path, AssistantKind::Claude),
            home_path.join(".claude").join("CLAUDE.md")
        );
        assert_eq!(
            path_for_assistant_in(home_path, AssistantKind::Cursor),
            home_path.join(".cursor").join("rules").join("everr.mdc")
        );
        assert_eq!(
            assistant_root_for_home(home_path, AssistantKind::Cursor),
            home_path.join(".cursor")
        );
    }

    #[test]
    fn upsert_managed_block_is_idempotent() {
        let block = "<!-- EVERR_CLI_START -->\nmanaged\n<!-- EVERR_CLI_END -->\n";
        let original = "custom content";
        let once = upsert_managed_block(AssistantKind::Codex, original, block);
        let twice = upsert_managed_block(AssistantKind::Codex, &once, block);
        assert_eq!(once, twice);
    }

    #[test]
    fn cursor_upsert_keeps_managed_rule_at_top_with_frontmatter() {
        let block = content_for_assistant(AssistantKind::Cursor, "everr");
        let updated = upsert_managed_block(AssistantKind::Cursor, "# custom note\n", &block);

        assert!(updated.starts_with("---\n"));
        assert!(updated.contains("alwaysApply: true"));
        assert!(updated.contains("`everr slowest-tests`"));
        assert!(updated.trim_end().ends_with("# custom note"));
    }

    #[test]
    fn remove_managed_block_removes_only_managed_content() {
        let current = "before\n<!-- EVERR_CLI_START -->\nmanaged\n<!-- EVERR_CLI_END -->\nafter";
        let updated = remove_managed_block(current);
        assert_eq!(updated, "before\nafter");
    }

    #[test]
    fn sync_assistants_updates_only_selected_targets() {
        let home = tempdir().expect("tempdir");
        let codex_path = path_for_assistant_in(home.path(), AssistantKind::Codex);
        let cursor_path = path_for_assistant_in(home.path(), AssistantKind::Cursor);

        fs::create_dir_all(codex_path.parent().expect("codex parent")).expect("codex dir");
        fs::create_dir_all(cursor_path.parent().expect("cursor parent")).expect("cursor dir");
        fs::write(
            &cursor_path,
            "custom\n\n<!-- EVERR_CLI_START -->\nold\n<!-- EVERR_CLI_END -->\n",
        )
        .expect("seed cursor file");

        sync_assistants_for_home(home.path(), &[AssistantKind::Codex], "everr")
            .expect("sync assistants");

        let codex = fs::read_to_string(&codex_path).expect("read codex");
        let cursor = fs::read_to_string(&cursor_path).expect("read cursor");

        assert!(codex.contains("everr status"));
        assert_eq!(cursor, "custom");
    }

    #[test]
    fn assistant_instructions_use_requested_command_name() {
        let rendered = render_assistant_instructions("everr");
        assert!(rendered.contains("`everr status`"));
        assert!(rendered.contains("`everr runs list`"));
    }

    fn sync_assistants_for_home(
        home: &Path,
        assistants: &[AssistantKind],
        command_name: &str,
    ) -> anyhow::Result<()> {
        for assistant in AssistantKind::ALL {
            let path = path_for_assistant_in(home, assistant);
            if assistants.contains(&assistant) {
                super::write_managed_block(
                    &path,
                    assistant,
                    super::content_for_assistant(assistant, command_name),
                )?;
                continue;
            }

            super::remove_managed_prompt_at(&path)?;
        }

        Ok(())
    }
}
