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

trait LoginPrompter {
    fn prompt_api_base_url(&self, default_api_base_url: &str) -> Result<String>;
    fn prompt_token(&self) -> Result<String>;
}

struct DialoguerLoginPrompter;

impl LoginPrompter for DialoguerLoginPrompter {
    fn prompt_api_base_url(&self, default_api_base_url: &str) -> Result<String> {
        Input::new()
            .with_prompt("Everr API base URL")
            .default(default_api_base_url.to_string())
            .interact_text()
            .context("failed to read API base URL")
    }

    fn prompt_token(&self) -> Result<String> {
        Password::new()
            .with_prompt("Paste your Everr MCP token")
            .allow_empty_password(false)
            .interact()
            .context("failed to read token")
    }
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
    let prompter = DialoguerLoginPrompter;
    login_interactive_with(api_base_url, token, &prompter)
}

fn login_interactive_with(
    api_base_url: Option<String>,
    token: Option<String>,
    prompter: &dyn LoginPrompter,
) -> Result<Session> {
    let api_base_url = match api_base_url {
        Some(url) => url,
        None => prompter.prompt_api_base_url(DEFAULT_API_BASE_URL)?,
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
        None => prompter.prompt_token()?,
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

#[cfg(test)]
mod tests {
    use anyhow::{Result, anyhow};

    use super::{LoginPrompter, login_interactive_with, mcp_setup_url_from_api_base};

    struct StubPrompter {
        api_base_url: Option<String>,
        token: Option<String>,
    }

    impl LoginPrompter for StubPrompter {
        fn prompt_api_base_url(&self, _default_api_base_url: &str) -> Result<String> {
            self.api_base_url
                .as_ref()
                .map(|value| value.to_string())
                .ok_or_else(|| anyhow!("missing api base url"))
        }

        fn prompt_token(&self) -> Result<String> {
            self.token
                .as_ref()
                .map(|value| value.to_string())
                .ok_or_else(|| anyhow!("missing token"))
        }
    }

    struct PanicPrompter;

    impl LoginPrompter for PanicPrompter {
        fn prompt_api_base_url(&self, _default_api_base_url: &str) -> Result<String> {
            panic!("prompt_api_base_url should not be called")
        }

        fn prompt_token(&self) -> Result<String> {
            panic!("prompt_token should not be called")
        }
    }

    #[test]
    fn mcp_setup_url_trims_space_and_trailing_slash() {
        let url = mcp_setup_url_from_api_base(" https://app.everr.dev/ ");
        assert_eq!(url, "https://app.everr.dev/dashboard/mcp-server");
    }

    #[test]
    fn login_interactive_rejects_empty_token() {
        let err = login_interactive_with(
            Some("https://app.everr.dev".to_string()),
            Some("   ".to_string()),
            &PanicPrompter,
        )
        .expect_err("expected empty token to fail");

        assert!(err.to_string().contains("token cannot be empty"));
    }

    #[test]
    fn login_interactive_uses_prompter_values_when_missing_cli_args() {
        let session = login_interactive_with(
            None,
            None,
            &StubPrompter {
                api_base_url: Some("https://dev.everr.dev".to_string()),
                token: Some("token-123".to_string()),
            },
        )
        .expect("expected prompt-driven login to succeed");

        assert_eq!(session.api_base_url, "https://dev.everr.dev");
        assert_eq!(session.token, "token-123");
    }
}
