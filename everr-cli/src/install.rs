use std::env;
use std::fs;
use std::io;
use std::path::PathBuf;

use anyhow::{Context, Result};
use dialoguer::MultiSelect;

use crate::assistant;
use crate::auth;
use crate::cli::{AssistantKind, LoginArgs};
use crate::notifications;

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

    let assistants = prompt_assistants()?;
    if assistants.is_empty() {
        summary.push("assistants: skipped".to_string());
    } else {
        assistant::init_assistants(&assistants)?;
        summary.push(format!("assistants: configured {}", assistants.len()));
    }

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
    if let Err(error) = run_notification_permission_prompt() {
        eprintln!("warning: failed to run notification permission prompt: {error}");
    }
    Ok(())
}

fn prompt_assistants() -> Result<Vec<AssistantKind>> {
    let choices = [
        AssistantKind::Codex,
        AssistantKind::Claude,
        AssistantKind::Cursor,
    ];
    let labels = ["Codex", "Claude", "Cursor"];
    let defaults = [
        assistant::is_assistant_installed(AssistantKind::Codex)?,
        assistant::is_assistant_installed(AssistantKind::Claude)?,
        assistant::is_assistant_installed(AssistantKind::Cursor)?,
    ];
    let indexes = MultiSelect::new()
        .with_prompt("Select assistants to configure globally")
        .items(&labels)
        .defaults(&defaults)
        .interact()?;

    let selected = indexes.into_iter().map(|idx| choices[idx]).collect();
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

    let source_canonical = fs::canonicalize(&source).unwrap_or(source.clone());
    let dest_canonical = fs::canonicalize(&destination).unwrap_or(destination.clone());
    let installed_now = if source_canonical == dest_canonical {
        false
    } else {
        fs::copy(&source, &destination).with_context(|| {
            format!(
                "failed to copy binary from {} to {}",
                source.display(),
                destination.display()
            )
        })?;
        true
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

fn run_notification_permission_prompt() -> Result<()> {
    notifications::send(
        "Everr notifications setup",
        "Follow the instructions to enable notifications for Everr.",
        "This is a test notification to verify that notifications are working.",
    )?;

    println!();
    println!("Notification permission setup:");
    println!("1. Open System Settings -> Notifications.");
    println!("2. Enable notifications for Everr/Script Editor/Terminal.");
    println!("3. Set style to Banners or Alerts and allow sounds.");
    println!("Press Enter when done, and Everr will send a second test notification.");

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .context("failed to read confirmation input")?;

    notifications::send(
        "Everr install complete",
        "Setup finished",
        "Everr CLI is ready to use.",
    )
}
