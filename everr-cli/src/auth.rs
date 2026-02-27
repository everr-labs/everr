use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use dialoguer::{Input, Password};
use serde::{Deserialize, Serialize};

use crate::cli::LoginArgs;

const DEFAULT_API_BASE_URL: &str = "https://app.everr.dev";

#[derive(Debug, Deserialize, Serialize)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

pub async fn login(args: LoginArgs) -> Result<()> {
    let session = login_interactive(args.api_base_url, args.token)?;
    save_session(&session)?;
    println!(
        "Logged in. Session saved at {}",
        session_file_path()?.display()
    );
    Ok(())
}

pub fn login_interactive(api_base_url: Option<String>, token: Option<String>) -> Result<Session> {
    let api_base_url = match api_base_url {
        Some(url) => url,
        None => Input::new()
            .with_prompt("Everr API base URL")
            .default(DEFAULT_API_BASE_URL.to_string())
            .interact_text()
            .context("failed to read API base URL")?,
    };

    let mcp_setup_url = mcp_setup_url_from_api_base(&api_base_url);
    println!();
    println!("To create an access token:");
    println!("1. Open: {mcp_setup_url}");
    println!("2. In Step 1, click 'Generate token'.");
    println!("3. Copy the token (it is shown once).");
    println!("4. Paste it below.");
    println!();

    let token = match token {
        Some(value) => value,
        None => Password::new()
            .with_prompt("Paste your Everr MCP token")
            .allow_empty_password(false)
            .interact()
            .context("failed to read token")?,
    };

    if token.trim().is_empty() {
        bail!("token cannot be empty");
    }

    Ok(Session {
        api_base_url,
        token,
    })
}

fn mcp_setup_url_from_api_base(api_base_url: &str) -> String {
    let trimmed = api_base_url.trim().trim_end_matches('/');
    format!("{trimmed}/dashboard/mcp-server")
}

pub fn logout() -> Result<()> {
    let path = session_file_path()?;
    let had_session = path.exists();
    if had_session {
        fs::remove_file(&path).with_context(|| format!("failed to remove {}", path.display()))?;
        println!("Logged out.");
    } else {
        println!("No active session.");
    }

    Ok(())
}

pub fn has_active_session() -> Result<bool> {
    Ok(session_file_path()?.exists())
}

pub fn require_session() -> Result<Session> {
    let path = session_file_path()?;
    if !path.exists() {
        bail!("no active session; run `everr auth login`");
    }
    let raw =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    let session = serde_json::from_str::<Session>(&raw).context("failed to parse saved session")?;
    Ok(session)
}

fn save_session(session: &Session) -> Result<()> {
    let path = session_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let serialized =
        serde_json::to_string_pretty(session).context("failed to serialize session")?;
    fs::write(&path, serialized).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn session_file_path() -> Result<PathBuf> {
    let config_dir = dirs::config_dir().context("failed to resolve user config dir")?;
    Ok(config_dir.join("everr").join("session.json"))
}
