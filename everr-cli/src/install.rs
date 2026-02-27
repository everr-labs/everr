use anyhow::{Result, bail};
use dialoguer::MultiSelect;

use crate::assistant;
use crate::auth;
use crate::cli::{AssistantKind, LoginArgs};
use crate::daemon;

pub async fn run_install_wizard() -> Result<()> {
    let mut summary: Vec<String> = Vec::new();

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
    assistant::init_assistants(&assistants)?;
    summary.push(format!("assistants: configured {}", assistants.len()));

    let daemon_result = daemon::install_if_missing()?;
    if daemon_result.installed_now {
        summary.push(format!(
            "daemon: installed service at {}",
            daemon_result.service_path.display()
        ));
    } else {
        summary.push("daemon: service already installed".to_string());
    }
    if daemon_result.started {
        summary.push("daemon: service started".to_string());
    } else {
        summary.push(
            "daemon: service file installed but start command failed (start it manually)"
                .to_string(),
        );
    }

    println!("\nInstall summary:");
    for item in summary {
        println!("- {item}");
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
    let indexes = MultiSelect::new()
        .with_prompt("Select assistants to configure globally")
        .items(&labels)
        .interact()?;

    if indexes.is_empty() {
        bail!("at least one assistant must be selected");
    }

    let selected = indexes.into_iter().map(|idx| choices[idx]).collect();
    Ok(selected)
}
