use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

const BLOCK_START: &str = "<!-- BEGIN everr -->";
const BLOCK_END: &str = "<!-- END everr -->";
const ASSISTANT_INSTRUCTIONS: &str = include_str!("../assets/assistant-instructions.md");
const DISCOVERY_INSTRUCTIONS: &str = include_str!("../assets/discovery-instructions.md");
const CURSOR_RULE_HEADER: &str = concat!(
    "---\n",
    "description: Use Everr CLI only when the task involves CI, GitHub Actions workflows, pipelines, failing jobs, workflow logs, or CI test failures.\n",
    "globs:\n",
    "alwaysApply: false\n",
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

pub fn init_repo_instructions(cwd: &Path, command_name: &str) -> Result<PathBuf> {
    let path = cwd.join("AGENTS.md");
    write_generic_managed_block(&path, &repo_content(command_name))?;
    Ok(path)
}

/// Writes Everr discovery instructions to repo-level assistant files.
///
/// - If AGENTS.md or CLAUDE.md is present: writes/updates whichever exist.
/// - If neither is present: creates AGENTS.md.
/// - Returns the paths of all files written.
pub fn init_repo_instructions_auto(cwd: &Path, command_name: &str) -> Result<Vec<PathBuf>> {
    let agents_path = cwd.join("AGENTS.md");
    let claude_path = cwd.join("CLAUDE.md");

    let agents_exists = agents_path.exists();
    let claude_exists = claude_path.exists();

    let mut written = Vec::new();
    let content = repo_content(command_name);

    if agents_exists || !claude_exists {
        write_generic_managed_block(&agents_path, &content)?;
        written.push(agents_path);
    }

    if claude_exists {
        write_generic_managed_block(&claude_path, &content)?;
        written.push(claude_path);
    }

    Ok(written)
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

        remove_managed_prompt_at(assistant, &path)?;
    }

    Ok(())
}

pub fn sync_discovery_assistants(assistants: &[AssistantKind], command_name: &str) -> Result<()> {
    for assistant in AssistantKind::ALL {
        let path = path_for_assistant(assistant)?;
        if assistants.contains(&assistant) {
            write_managed_block(
                &path,
                assistant,
                content_for_assistant_discovery(assistant, command_name),
            )?;
            continue;
        }

        remove_managed_prompt_at(assistant, &path)?;
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
    Ok(managed_block_range(&current).is_some())
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
    let home = resolve_home_dir()?;
    refresh_existing_managed_prompts_in(&home, command_name)
}

fn refresh_existing_managed_prompts_in(
    home: &Path,
    command_name: &str,
) -> Result<Vec<AssistantKind>> {
    let mut refreshed = Vec::new();

    for assistant in AssistantKind::ALL {
        let path = path_for_assistant_in(home, assistant);
        if !path.exists() {
            continue;
        }

        let current = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        if managed_block_range(&current).is_none() {
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
        remove_managed_prompt_at(assistant, &path)?;
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

fn content_for_assistant(assistant: AssistantKind, _command_name: &str) -> String {
    make_assistant_block(assistant, render_assistant_instructions())
}

fn content_for_assistant_discovery(assistant: AssistantKind, _command_name: &str) -> String {
    make_assistant_block(assistant, render_discovery_instructions())
}

fn make_assistant_block(assistant: AssistantKind, instructions: &str) -> String {
    let managed_body = format!("{BLOCK_START}\n{}\n{BLOCK_END}\n", instructions.trim_end());
    match assistant {
        AssistantKind::Cursor => format!("{CURSOR_RULE_HEADER}{managed_body}"),
        AssistantKind::Codex | AssistantKind::Claude => managed_body,
    }
}

fn repo_content(_command_name: &str) -> String {
    format!(
        "{BLOCK_START}\n{}\n{BLOCK_END}\n",
        render_discovery_instructions().trim_end()
    )
}

pub fn render_assistant_instructions() -> &'static str {
    ASSISTANT_INSTRUCTIONS
}

pub fn render_discovery_instructions() -> &'static str {
    DISCOVERY_INSTRUCTIONS
}

fn remove_managed_prompt_at(assistant: AssistantKind, path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let current =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let next = remove_managed_block_for_assistant(assistant, &current);
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

fn write_generic_managed_block(path: &Path, block: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let next = if path.exists() {
        let current = fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        upsert_generic_managed_block(&current, block)
    } else {
        block.to_string()
    };

    fs::write(path, next).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn upsert_managed_block(assistant: AssistantKind, current: &str, block: &str) -> String {
    match assistant {
        AssistantKind::Cursor => {
            let remaining = remove_managed_block_for_assistant(assistant, current);
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

fn upsert_generic_managed_block(current: &str, block: &str) -> String {
    match managed_block_range(current) {
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
    }
}

fn remove_managed_block_for_assistant(assistant: AssistantKind, current: &str) -> String {
    match managed_block_range_for_assistant(assistant, current) {
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

fn managed_block_range_for_assistant(
    assistant: AssistantKind,
    current: &str,
) -> Option<(usize, usize)> {
    match assistant {
        AssistantKind::Cursor => {
            cursor_managed_block_range(current).or_else(|| managed_block_range(current))
        }
        AssistantKind::Codex | AssistantKind::Claude => managed_block_range(current),
    }
}

fn managed_block_range(current: &str) -> Option<(usize, usize)> {
    managed_block_range_with_markers(current, BLOCK_START, BLOCK_END)
}

fn managed_block_range_with_markers(
    current: &str,
    start_marker: &str,
    end_marker: &str,
) -> Option<(usize, usize)> {
    let start = current.find(start_marker)?;
    let end_marker_index = current[start..].find(end_marker)? + start;
    if end_marker_index < start {
        return None;
    }

    let mut end = end_marker_index + end_marker.len();
    if current[end..].starts_with("\r\n") {
        end += 2;
    } else if current[end..].starts_with('\n') {
        end += 1;
    }

    Some((start, end))
}

fn cursor_managed_block_range(current: &str) -> Option<(usize, usize)> {
    let (managed_start, managed_end) = managed_block_range(current)?;
    let frontmatter_end = cursor_frontmatter_end(current)?;
    if managed_start < frontmatter_end {
        return None;
    }

    if current[frontmatter_end..managed_start].trim().is_empty() {
        Some((0, managed_end))
    } else {
        None
    }
}

fn cursor_frontmatter_end(current: &str) -> Option<usize> {
    let (frontmatter_start_len, closing_delimiter) = if current.starts_with("---\r\n") {
        ("---\r\n".len(), "\r\n---\r\n")
    } else if current.starts_with("---\n") {
        ("---\n".len(), "\n---\n")
    } else {
        return None;
    };

    let closing_start = current[frontmatter_start_len..].find(closing_delimiter)?;
    Some(frontmatter_start_len + closing_start + closing_delimiter.len())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::tempdir;

    use super::{
        AssistantKind, assistant_root_for_home, content_for_assistant, init_repo_instructions,
        path_for_assistant_in, refresh_existing_managed_prompts_in,
        remove_managed_block_for_assistant, render_assistant_instructions,
        render_discovery_instructions, upsert_generic_managed_block, upsert_managed_block,
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
        let block = "<!-- BEGIN everr -->\nmanaged\n<!-- END everr -->\n";
        let original = "custom content";
        let once = upsert_managed_block(AssistantKind::Codex, original, block);
        let twice = upsert_managed_block(AssistantKind::Codex, &once, block);
        assert_eq!(once, twice);
    }

    #[test]
    fn cursor_upsert_keeps_managed_rule_at_top_with_agent_requested_frontmatter() {
        let block = content_for_assistant(AssistantKind::Cursor, "everr");
        let updated = upsert_managed_block(AssistantKind::Cursor, "# custom note\n", &block);

        assert!(updated.starts_with("---\n"));
        assert!(updated.contains("alwaysApply: false"));
        assert!(updated.contains("`everr slowest-tests`"));
        assert!(updated.trim_end().ends_with("# custom note"));
    }

    #[test]
    fn cursor_upsert_replaces_existing_managed_rule_without_duplicating_frontmatter() {
        let block = content_for_assistant(AssistantKind::Cursor, "everr");
        let updated = upsert_managed_block(AssistantKind::Cursor, &block, &block);

        assert_eq!(updated, block);
    }

    #[test]
    fn remove_managed_block_removes_only_managed_content() {
        let current = "before\n<!-- BEGIN everr -->\nmanaged\n<!-- END everr -->\nafter";
        let updated = remove_managed_block_for_assistant(AssistantKind::Codex, current);
        assert_eq!(updated, "before\nafter");
    }

    #[test]
    fn remove_managed_block_for_cursor_removes_frontmatter_and_instructions() {
        let current = format!(
            "{}# custom note\n",
            content_for_assistant(AssistantKind::Cursor, "everr")
        );
        let updated = remove_managed_block_for_assistant(AssistantKind::Cursor, &current);

        assert_eq!(updated, "# custom note");
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
            "custom\n\n<!-- BEGIN everr -->\nold\n<!-- END everr -->\n",
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
        let rendered = render_assistant_instructions();
        assert!(rendered.contains("`everr status`"));
        assert!(rendered.contains("`everr runs`"));
    }

    #[test]
    fn repo_assistant_instructions_use_requested_command_name() {
        let rendered = render_discovery_instructions();
        assert!(rendered.contains("call `everr ai-instructions` for full usage."));
        assert!(rendered.contains("`everr status`"));
        assert!(!rendered.contains("`everr runs`"));
    }

    #[test]
    fn assistant_instructions_describe_status_failure_handoff() {
        let rendered = render_assistant_instructions();
        assert!(rendered.contains("`everr status`"));
        assert!(rendered.contains("Use Everr CLI guidance when the task involves CI"));
        assert!(rendered.contains("`everr show --trace-id <trace_id>`"));
    }

    #[test]
    fn refresh_existing_managed_prompts_updates_only_managed_files() {
        let home = tempdir().expect("tempdir");
        let codex_path = path_for_assistant_in(home.path(), AssistantKind::Codex);
        let claude_path = path_for_assistant_in(home.path(), AssistantKind::Claude);

        fs::create_dir_all(codex_path.parent().expect("codex parent")).expect("codex dir");
        fs::create_dir_all(claude_path.parent().expect("claude parent")).expect("claude dir");
        fs::write(
            &codex_path,
            "<!-- BEGIN everr -->\nold\n<!-- END everr -->\n",
        )
        .expect("seed managed codex file");
        fs::write(&claude_path, "# unmanaged note\n").expect("seed unmanaged claude file");

        let refreshed =
            refresh_existing_managed_prompts_in(home.path(), "everr").expect("refresh prompts");

        assert_eq!(refreshed, vec![AssistantKind::Codex]);
        assert!(
            fs::read_to_string(&codex_path)
                .expect("read codex")
                .contains("`everr status`")
        );
        assert_eq!(
            fs::read_to_string(&claude_path).expect("read claude"),
            "# unmanaged note\n"
        );
    }

    #[test]
    fn repo_init_writes_managed_block_into_project_agents_file() {
        let repo = tempdir().expect("tempdir");

        let path = init_repo_instructions(repo.path(), "everr").expect("init repo instructions");

        assert_eq!(path, repo.path().join("AGENTS.md"));
        let content = fs::read_to_string(path).expect("read AGENTS");
        assert!(content.contains("<!-- BEGIN everr -->"));
        assert!(content.contains("call `everr ai-instructions` for full usage."));
    }

    #[test]
    fn generic_upsert_replaces_existing_managed_block() {
        let current = "# notes\n\n<!-- BEGIN everr -->\nold\n<!-- END everr -->\n";
        let next = upsert_generic_managed_block(
            current,
            "<!-- BEGIN everr -->\nnew\n<!-- END everr -->\n",
        );

        assert!(next.contains("<!-- BEGIN everr -->"));
        assert!(next.contains("new"));
        assert!(!next.contains("\nold\n"));
        assert!(next.contains("# notes"));
    }

    #[test]
    fn init_repo_instructions_auto_creates_agents_when_neither_file_exists() {
        let repo = tempdir().expect("tempdir");
        let written = super::init_repo_instructions_auto(repo.path(), "everr")
            .expect("init repo instructions");
        assert_eq!(written, vec![repo.path().join("AGENTS.md")]);
        let content = fs::read_to_string(repo.path().join("AGENTS.md")).expect("read");
        assert!(content.contains("<!-- BEGIN everr -->"));
    }

    #[test]
    fn init_repo_instructions_auto_writes_agents_when_agents_exists() {
        let repo = tempdir().expect("tempdir");
        fs::write(repo.path().join("AGENTS.md"), "# existing\n").expect("seed");
        let written = super::init_repo_instructions_auto(repo.path(), "everr")
            .expect("init repo instructions");
        assert_eq!(written.len(), 1);
        assert!(written[0].ends_with("AGENTS.md"));
        let content = fs::read_to_string(repo.path().join("AGENTS.md")).expect("read");
        assert!(content.contains("# existing"));
        assert!(content.contains("<!-- BEGIN everr -->"));
    }

    #[test]
    fn init_repo_instructions_auto_writes_claude_when_claude_exists() {
        let repo = tempdir().expect("tempdir");
        fs::write(repo.path().join("CLAUDE.md"), "# existing claude\n").expect("seed");
        let written = super::init_repo_instructions_auto(repo.path(), "everr")
            .expect("init repo instructions");
        assert_eq!(written.len(), 1);
        assert!(written[0].ends_with("CLAUDE.md"));
        let content = fs::read_to_string(repo.path().join("CLAUDE.md")).expect("read");
        assert!(content.contains("<!-- BEGIN everr -->"));
        assert!(!repo.path().join("AGENTS.md").exists());
    }

    #[test]
    fn init_repo_instructions_auto_writes_both_when_both_exist() {
        let repo = tempdir().expect("tempdir");
        fs::write(repo.path().join("AGENTS.md"), "# agents\n").expect("seed agents");
        fs::write(repo.path().join("CLAUDE.md"), "# claude\n").expect("seed claude");
        let written = super::init_repo_instructions_auto(repo.path(), "everr")
            .expect("init repo instructions");
        assert_eq!(written.len(), 2);
        let agents = fs::read_to_string(repo.path().join("AGENTS.md")).expect("read agents");
        let claude = fs::read_to_string(repo.path().join("CLAUDE.md")).expect("read claude");
        assert!(agents.contains("<!-- BEGIN everr -->"));
        assert!(claude.contains("<!-- BEGIN everr -->"));
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

            super::remove_managed_prompt_at(assistant, &path)?;
        }

        Ok(())
    }
}
