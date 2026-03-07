use std::io::{self, Write};
use std::thread;

use anyhow::{Result, anyhow};
use everr_core::auth::{AuthConfig, Session, SessionStore, login_with_prompt};

use crate::cli::LoginArgs;

const API_BASE_URL: &str = "http://localhost:5173";

pub async fn login(_args: LoginArgs) -> Result<()> {
    let config = resolve_auth_config()?;
    let store = session_store();
    login_with_prompt(&config, &store, show_device_sign_in_prompt).await?;
    println!(
        "Logged in. Session saved at {}",
        store.session_file_path()?.display()
    );
    Ok(())
}

fn show_device_sign_in_prompt(verification_url: String, user_code: &str) {
    let visit_line = format!("Auth URL: {verification_url}");
    let code_line = format!("Your code: {user_code}");
    let lines = ["Let's get you signed in", "", &visit_line, &code_line];
    let content_width = lines
        .iter()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0);
    let border = format!("+{}+", "-".repeat(content_width + 2));

    println!();
    println!("{border}");
    for line in lines {
        println!("| {:<width$} |", line, width = content_width);
    }
    println!("{border}");
    println!();
    println!("Press <Enter> to open the verification URL in your browser...");

    let _ = thread::spawn(move || {
        let mut input = String::new();
        if io::stdout().flush().is_err() {
            return;
        }
        let Ok(bytes_read) = io::stdin().read_line(&mut input) else {
            return;
        };
        if bytes_read == 0 {
            return;
        }
        if let Err(error) = webbrowser::open(&verification_url) {
            eprintln!(
                "Could not open browser automatically. Open this URL manually: {verification_url} ({error})"
            );
        }
    });
}

fn trimmed_non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn logout() -> Result<()> {
    let store = session_store();
    let had_session = store.clear_session()?;
    if had_session {
        println!("Logged out.");
    } else {
        println!("No active session.");
    }

    Ok(())
}

pub fn has_active_session() -> Result<bool> {
    session_store().has_active_session()
}

pub async fn require_session_with_refresh() -> Result<Session> {
    let store = session_store();
    match store.load_session() {
        Ok(session) => Ok(session),
        Err(error) => {
            if error.to_string().contains("no active session") {
                Err(anyhow!("no active session; run `{}`", login_command_hint()))
            } else {
                Err(error)
            }
        }
    }
}

fn resolve_auth_config() -> Result<AuthConfig> {
    let api_base_url = trimmed_non_empty(API_BASE_URL)
        .ok_or_else(|| anyhow::anyhow!("missing fixed API base URL"))?
        .to_string();

    Ok(AuthConfig { api_base_url })
}

fn login_command_hint() -> String {
    format!("{} login", command_name())
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

fn session_store() -> SessionStore {
    SessionStore::for_command(&command_name())
}

#[cfg(test)]
mod tests {
    use super::session_store;

    #[test]
    fn session_namespace_uses_dev_namespace_for_everr_dev() {
        assert_eq!(
            everr_core::auth::SessionStore::for_command("everr-dev").namespace(),
            "everr-dev"
        );
    }

    #[test]
    fn session_namespace_uses_default_namespace_for_non_dev_binaries() {
        assert_eq!(
            everr_core::auth::SessionStore::for_command("everr").namespace(),
            "everr"
        );
        assert_eq!(
            everr_core::auth::SessionStore::for_command("custom-name").namespace(),
            "everr"
        );
        let _ = session_store();
    }
}
