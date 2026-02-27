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
        "{BLOCK_START}\n#\nUse Everr CLI from the current project directory to get CI/CD status and logs.\n\nQuick commands:- `everr current-branch-status`\n- `everr runs list`\n- `everr runs show --trace-id <trace_id>`\n- `everr runs logs --trace-id <trace_id> --job-name <job> --step-number <n>`\n{BLOCK_END}\n"
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
    match (current.find(BLOCK_START), current.find(BLOCK_END)) {
        (Some(start), Some(end_marker)) if end_marker >= start => {
            let end = end_marker + BLOCK_END.len();
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
    match (current.find(BLOCK_START), current.find(BLOCK_END)) {
        (Some(start), Some(end_marker)) if end_marker >= start => {
            let end = end_marker + BLOCK_END.len();
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
