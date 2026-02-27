use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

use crate::cli::{AssistantInitArgs, AssistantKind};

const BLOCK_START: &str = "<!-- EVERR_CLI_START -->";
const BLOCK_END: &str = "<!-- EVERR_CLI_END -->";

pub fn init_from_args(args: AssistantInitArgs) -> Result<()> {
    init_assistants(&args.assistants)
}

pub fn init_assistants(assistants: &[AssistantKind]) -> Result<()> {
    if assistants.is_empty() {
        bail!("no assistants selected");
    }

    for assistant in assistants {
        let path = path_for_assistant(*assistant)?;
        write_managed_block(&path, content_for_assistant())?;
        println!("Configured {:?} at {}", assistant, path.display());
    }
    Ok(())
}

pub fn is_assistant_installed(assistant: AssistantKind) -> Result<bool> {
    let path = path_for_assistant(assistant)?;
    if !path.exists() {
        return Ok(false);
    }

    let current =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    Ok(current.contains(BLOCK_START) && current.contains(BLOCK_END))
}

pub fn remove_managed_prompts() -> Result<()> {
    let assistants = [
        AssistantKind::Codex,
        AssistantKind::Claude,
        AssistantKind::Cursor,
    ];

    for assistant in assistants {
        let path = path_for_assistant(assistant)?;
        if !path.exists() {
            continue;
        }
        let current = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let next = remove_managed_block(&current);
        if next == current {
            continue;
        }

        if next.trim().is_empty() {
            fs::remove_file(&path)
                .with_context(|| format!("failed to remove {}", path.display()))?;
        } else {
            fs::write(&path, next)
                .with_context(|| format!("failed to write {}", path.display()))?;
        }
        println!("Removed Everr prompt from {}", path.display());
    }

    Ok(())
}

pub fn refresh_existing_managed_prompts() -> Result<Vec<AssistantKind>> {
    let assistants = [
        AssistantKind::Codex,
        AssistantKind::Claude,
        AssistantKind::Cursor,
    ];
    let managed_block = content_for_assistant();
    let mut refreshed = Vec::new();

    for assistant in assistants {
        let path = path_for_assistant(assistant)?;
        if !path.exists() {
            continue;
        }

        let current = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        if !(current.contains(BLOCK_START) && current.contains(BLOCK_END)) {
            continue;
        }

        let next = upsert_managed_block(&current, &managed_block);
        if next == current {
            continue;
        }

        fs::write(&path, next).with_context(|| format!("failed to write {}", path.display()))?;
        refreshed.push(assistant);
    }

    Ok(refreshed)
}

fn path_for_assistant(assistant: AssistantKind) -> Result<PathBuf> {
    let home = dirs::home_dir().context("failed to resolve home dir")?;
    let path = match assistant {
        AssistantKind::Codex => home.join(".codex").join("AGENTS.md"),
        AssistantKind::Claude => home.join(".claude").join("CLAUDE.md"),
        AssistantKind::Cursor => home.join(".cursor").join("rules").join("everr.mdc"),
    };
    Ok(path)
}

fn content_for_assistant() -> String {
    format!(
        "{BLOCK_START}\n#\nUse Everr CLI from the current project directory to see what is wrong with CI.\nWhen CI fails, use Everr to identify the failing workflow/job/step and inspect logs.\n\nQuick commands:\n- `everr status`: checks CI health for the current repo/branch (or the branch passed with flags).\n- `everr runs list`\n- `everr runs show --trace-id <trace_id>`\n- `everr runs logs --trace-id <trace_id> --job-name <job> --step-number <n>`\n{BLOCK_END}\n"
    )
}

fn write_managed_block(path: &Path, block: String) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let next = if path.exists() {
        let current = fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        upsert_managed_block(&current, &block)
    } else {
        block
    };

    fs::write(path, next).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn upsert_managed_block(current: &str, block: &str) -> String {
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
        _ => {
            if current.trim().is_empty() {
                block.to_string()
            } else {
                format!("{current}\n\n{block}")
            }
        }
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
        _ => current.to_string(),
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
    use super::{BLOCK_START, remove_managed_block, upsert_managed_block};

    #[test]
    fn upsert_managed_block_is_idempotent() {
        let block = format!("{BLOCK_START}\nmanaged\n<!-- EVERR_CLI_END -->\n");
        let original = "custom content";
        let once = upsert_managed_block(original, &block);
        let twice = upsert_managed_block(&once, &block);
        assert_eq!(once, twice);
    }

    #[test]
    fn remove_managed_block_removes_only_managed_content() {
        let current = "before\n<!-- EVERR_CLI_START -->\nmanaged\n<!-- EVERR_CLI_END -->\nafter";
        let updated = remove_managed_block(current);
        assert_eq!(updated, "before\nafter");
    }

    #[test]
    fn remove_managed_block_keeps_input_without_markers() {
        let current = "keep me";
        let updated = remove_managed_block(current);
        assert_eq!(updated, "keep me");
    }
}
