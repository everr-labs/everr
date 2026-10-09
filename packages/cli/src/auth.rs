use crate::api::ApiClient;
use crate::build;
use crate::device_auth::{AuthConfig, login_with_prompt};
use crate::state::{Session, SessionStore, is_no_active_session_error};
use anyhow::{Result, anyhow};

use crate::cli::LoginArgs;

const API_BASE_URL_OVERRIDE_ENV: &str = "EVERR_API_BASE_URL_FOR_TESTS";

pub async fn login(_args: LoginArgs) -> Result<()> {
    let config = resolve_auth_config()?;
    let store = session_store();
    let session = login_with_prompt(&config, &store, open_browser_immediately).await?;
    print_session_identity(&session).await?;
    println!(
        "Logged in. Session saved at {}",
        store.session_file_path()?.display()
    );
    Ok(())
}

pub(crate) async fn print_session_identity(session: &Session) -> Result<()> {
    let Ok(client) = ApiClient::from_session(session) else {
        return Ok(());
    };

    let me = client.get_me().await.ok();
    let org = client.get_org().await.ok();
    for line in identity_summary_lines(
        me.as_ref().map(|me| me.email.as_str()),
        org.as_ref().map(|org| org.name.as_str()),
    ) {
        cliclack::log::success(line)?;
    }

    Ok(())
}

pub(crate) fn identity_summary_lines(email: Option<&str>, org_name: Option<&str>) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(email) = email {
        lines.push(format!("Logged in as {email}"));
    }
    if let Some(org_name) = org_name {
        lines.push(format!("Using organization: {org_name}"));
    }
    lines
}

pub async fn open_browser_immediately(verification_url: String, user_code: String) {
    if let Err(error) = webbrowser::open(&verification_url) {
        eprintln!(
            "Could not open browser automatically.\nOpen this URL manually: {verification_url} ({error})"
        );
    }

    let code_line = format!("  Code: {user_code}");
    let url_line = format!("  URL:  {verification_url}");
    let width = code_line.len().max(url_line.len()) + 2;
    let bar = "─".repeat(width);
    println!("┌{bar}┐");
    println!("│{:width$}│", "  Authenticate", width = width);
    println!("│{:width$}│", "", width = width);
    println!("│{code_line:<width$}│", width = width);
    println!("│{url_line:<width$}│", width = width);
    println!("└{bar}┘");
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

pub fn require_session() -> Result<Session> {
    let store = session_store();
    let api_base_url = current_api_base_url()?;
    match store.load_session_for_api_base_url(&api_base_url) {
        Ok(session) => Ok(session),
        Err(error) if is_no_active_session_error(&error) => Err(anyhow!(
            "no active session; run `{} cloud login`",
            build::command_name()
        )),
        Err(error) => Err(error),
    }
}

pub fn resolve_auth_config() -> Result<AuthConfig> {
    Ok(AuthConfig {
        api_base_url: current_api_base_url()?,
    })
}

pub fn session_store() -> SessionStore {
    SessionStore::for_namespace(build::session_namespace())
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
    use crate::build;

    use super::session_store;

    #[test]
    fn session_namespace_is_fixed() {
        let store = session_store();
        let path = store.session_file_path().unwrap();
        assert_eq!(
            path.parent().unwrap().file_name().unwrap(),
            build::session_namespace()
        );
        assert_eq!(
            path.file_name().unwrap(),
            build::default_session_file_name()
        );
    }

    #[test]
    fn auth_config_uses_current_build_default_base_url() {
        let config = super::resolve_auth_config().expect("auth config");
        assert_eq!(config.api_base_url, build::default_api_base_url());
    }

    #[test]
    fn identity_summary_lines_include_email_and_org() {
        assert_eq!(
            super::identity_summary_lines(Some("user@example.com"), Some("Acme")),
            vec![
                "Logged in as user@example.com".to_string(),
                "Using organization: Acme".to_string(),
            ]
        );
    }
}
