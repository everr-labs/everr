use std::io::{self, Write};
use std::thread;

use anyhow::{Result, anyhow};
use everr_core::auth::{AuthConfig, login_with_prompt};
use everr_core::build;
use everr_core::state::{AppStateStore, Session};

use crate::cli::LoginArgs;

const API_BASE_URL_OVERRIDE_ENV: &str = "EVERR_API_BASE_URL_FOR_TESTS";

pub async fn login(_args: LoginArgs) -> Result<()> {
    let config = resolve_auth_config()?;
    let store = state_store();
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
    let store = state_store();
    let had_session = store.clear_session()?;
    if had_session {
        println!("Logged out.");
    } else {
        println!("No active session.");
    }

    Ok(())
}

pub async fn require_session_with_refresh() -> Result<Session> {
    let store = state_store();
    let api_base_url = current_api_base_url()?;
    match store.load_session_for_api_base_url(&api_base_url) {
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
    Ok(AuthConfig {
        api_base_url: current_api_base_url()?,
    })
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

fn state_store() -> AppStateStore {
    AppStateStore::for_namespace(build::session_namespace())
}

fn current_api_base_url() -> Result<String> {
    if let Ok(value) = std::env::var(API_BASE_URL_OVERRIDE_ENV) {
        let trimmed = trimmed_non_empty(&value)
            .ok_or_else(|| anyhow!("missing CLI API base URL override"))?;
        return Ok(trimmed.to_owned());
    }

    Ok(build::default_api_base_url().to_string())
}

#[cfg(test)]
mod tests {
    use everr_core::build;

    use super::state_store;

    #[test]
    fn session_namespace_is_fixed() {
        let store = state_store();

        assert_eq!(store.namespace(), build::session_namespace());
        assert_eq!(
            store.session_file_name(),
            build::default_session_file_name()
        );
    }

    #[test]
    fn auth_config_uses_current_build_default_base_url() {
        let config = super::resolve_auth_config().expect("auth config");
        assert_eq!(config.api_base_url, build::default_api_base_url());
    }
}
