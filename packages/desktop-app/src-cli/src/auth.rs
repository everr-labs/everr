use std::future::Future;
use std::io::{self, IsTerminal};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use crossterm::event::{Event, EventStream, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};
use everr_core::api::ApiClient;
use everr_core::auth::{
    AuthConfig, DeviceAuthorization, DevicePollStatus, build_auth_http_client, login_with_prompt,
    poll_device_authorization, session_from_device_token, start_device_authorization,
};
use everr_core::build;
use everr_core::state::{AppStateStore, Session};
use futures_util::StreamExt;
use tokio::time::sleep;

use crate::cli::LoginArgs;

const API_BASE_URL_OVERRIDE_ENV: &str = "EVERR_API_BASE_URL_FOR_TESTS";

pub async fn login(_args: LoginArgs) -> Result<()> {
    let config = resolve_auth_config()?;
    let store = state_store();
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

pub async fn login_with_enter_to_open_browser(
    config: &AuthConfig,
    store: &AppStateStore,
) -> Result<Session> {
    let client = build_auth_http_client()?;
    let authorization = start_device_authorization(&client, config).await?;
    show_device_sign_in_note(&authorization.verification_url, &authorization.user_code)?;
    cliclack::log::remark("Press Enter to open in your browser")?;

    complete_setup_device_authorization_with_enter_prompt(
        config,
        store,
        &client,
        authorization,
        wait_for_browser_prompt_action(),
        open_browser_with_warning,
    )
    .await
}

fn show_device_sign_in_note(verification_url: &str, user_code: &str) -> Result<()> {
    cliclack::note(
        "Authenticate",
        format!("Code: {user_code}\nURL:  {verification_url}"),
    )?;
    Ok(())
}

async fn complete_setup_device_authorization_with_enter_prompt<Enter, OpenBrowser>(
    config: &AuthConfig,
    store: &AppStateStore,
    client: &reqwest::Client,
    authorization: DeviceAuthorization,
    enter_prompt: Enter,
    mut open_browser: OpenBrowser,
) -> Result<Session>
where
    Enter: Future<Output = BrowserPromptAction>,
    OpenBrowser: FnMut(&str) -> Result<()>,
{
    let deadline = Instant::now() + Duration::from_secs(authorization.expires_in);
    let mut poll_interval = authorization.interval;
    let mut enter_prompt = Box::pin(enter_prompt);
    let mut listen_for_enter = true;

    loop {
        if Instant::now() >= deadline {
            bail!("device authentication expired before completion");
        }

        tokio::select! {
            action = &mut enter_prompt, if listen_for_enter => {
                listen_for_enter = false;
                match action {
                    BrowserPromptAction::OpenBrowser => {
                        open_browser(&authorization.verification_url)?;
                    }
                    BrowserPromptAction::Cancel => bail!("cancelled"),
                    BrowserPromptAction::Unavailable => {}
                }
            }
            _ = sleep(Duration::from_secs(poll_interval)) => {
                match poll_device_authorization(client, config, &authorization).await? {
                    DevicePollStatus::Authorized(token) => {
                        let session = session_from_device_token(config, token)?;
                        store.save_session(&session)?;
                        return Ok(session);
                    }
                    DevicePollStatus::Pending => {}
                    DevicePollStatus::SlowDown => {
                        poll_interval += 5;
                    }
                    DevicePollStatus::Denied => bail!("device authentication was denied"),
                    DevicePollStatus::Expired => bail!("device authentication token expired"),
                }
            }
        }
    }
}

async fn wait_for_browser_prompt_action() -> BrowserPromptAction {
    if !io::stdin().is_terminal() {
        return BrowserPromptAction::Unavailable;
    }

    let _raw_mode = match RawModeGuard::enable() {
        Ok(guard) => guard,
        Err(_) => return BrowserPromptAction::Unavailable,
    };

    let mut events = EventStream::new();
    while let Some(event) = events.next().await {
        match event {
            Ok(Event::Key(key)) => {
                if let Some(action) = browser_prompt_action_for_key(key) {
                    return action;
                }
            }
            Ok(_) => {}
            Err(_) => return BrowserPromptAction::Unavailable,
        }
    }

    BrowserPromptAction::Unavailable
}

fn browser_prompt_action_for_key(key: KeyEvent) -> Option<BrowserPromptAction> {
    if key.kind != KeyEventKind::Press {
        return None;
    }

    match key.code {
        KeyCode::Enter => Some(BrowserPromptAction::OpenBrowser),
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            Some(BrowserPromptAction::Cancel)
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum BrowserPromptAction {
    OpenBrowser,
    Cancel,
    Unavailable,
}

struct RawModeGuard;

impl RawModeGuard {
    fn enable() -> Result<Self> {
        enable_raw_mode().context("failed to enable terminal raw mode")?;
        Ok(Self)
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
    }
}

fn open_browser_with_warning(verification_url: &str) -> Result<()> {
    if let Err(error) = webbrowser::open(verification_url) {
        cliclack::log::warning(format!(
            "Could not open browser automatically.\nOpen this URL manually: {verification_url} ({error})"
        ))?;
    }
    Ok(())
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

pub fn resolve_auth_config() -> Result<AuthConfig> {
    Ok(AuthConfig {
        api_base_url: current_api_base_url()?,
    })
}

fn login_command_hint() -> String {
    format!("{} cloud login", command_name())
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

pub fn state_store() -> AppStateStore {
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
    use std::future;
    use std::sync::Mutex;

    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyEventState, KeyModifiers};
    use everr_core::auth::{AuthConfig, DeviceAuthorization};
    use everr_core::build;
    use mockito::Server;
    use tempfile::tempdir;

    use super::state_store;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct TempConfigEnv {
        original_home: Option<std::ffi::OsString>,
        original_xdg: Option<std::ffi::OsString>,
    }

    impl TempConfigEnv {
        fn set(temp_dir: &std::path::Path) -> Self {
            let config_home = temp_dir.join("config");
            std::fs::create_dir_all(&config_home).expect("create config dir");
            let original_home = std::env::var_os("HOME");
            let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
            unsafe {
                std::env::set_var("HOME", temp_dir);
                std::env::set_var("XDG_CONFIG_HOME", &config_home);
            }

            Self {
                original_home,
                original_xdg,
            }
        }
    }

    impl Drop for TempConfigEnv {
        fn drop(&mut self) {
            match self.original_home.take() {
                Some(value) => unsafe { std::env::set_var("HOME", value) },
                None => unsafe { std::env::remove_var("HOME") },
            }
            match self.original_xdg.take() {
                Some(value) => unsafe { std::env::set_var("XDG_CONFIG_HOME", value) },
                None => unsafe { std::env::remove_var("XDG_CONFIG_HOME") },
            }
        }
    }

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

    #[tokio::test(flavor = "current_thread")]
    async fn setup_login_finishes_when_enter_is_never_pressed() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut server = Server::new_async().await;
        let token_mock = server
            .mock("POST", "/api/auth/device/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"access_token":"token-123"}"#)
            .create_async()
            .await;
        let config = AuthConfig {
            api_base_url: server.url(),
        };
        let temp_dir = tempdir().expect("temp dir");
        let _env = TempConfigEnv::set(temp_dir.path());
        let store = everr_core::state::AppStateStore::for_namespace("everr-auth-test");
        let client = everr_core::auth::build_auth_http_client().expect("http client");
        let authorization = DeviceAuthorization {
            device_code: "device-123".to_string(),
            user_code: "CODE-123".to_string(),
            verification_url: "https://example.com/device".to_string(),
            expires_in: 60,
            interval: 0,
        };

        let session = super::complete_setup_device_authorization_with_enter_prompt(
            &config,
            &store,
            &client,
            authorization,
            future::pending(),
            |_| Ok(()),
        )
        .await
        .expect("setup login should finish");

        token_mock.assert_async().await;
        assert_eq!(session.api_base_url, config.api_base_url);
        assert_eq!(session.token, "token-123");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn setup_login_opens_browser_once_when_enter_is_pressed() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut server = Server::new_async().await;
        let token_mock = server
            .mock("POST", "/api/auth/device/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"access_token":"token-123"}"#)
            .create_async()
            .await;
        let config = AuthConfig {
            api_base_url: server.url(),
        };
        let temp_dir = tempdir().expect("temp dir");
        let _env = TempConfigEnv::set(temp_dir.path());
        let store = everr_core::state::AppStateStore::for_namespace("everr-auth-test");
        let client = everr_core::auth::build_auth_http_client().expect("http client");
        let authorization = DeviceAuthorization {
            device_code: "device-123".to_string(),
            user_code: "CODE-123".to_string(),
            verification_url: "https://example.com/device".to_string(),
            expires_in: 60,
            interval: 0,
        };
        let mut opened_urls = Vec::new();

        let session = super::complete_setup_device_authorization_with_enter_prompt(
            &config,
            &store,
            &client,
            authorization,
            future::ready(super::BrowserPromptAction::OpenBrowser),
            |url| {
                opened_urls.push(url.to_string());
                Ok(())
            },
        )
        .await
        .expect("setup login should finish");

        token_mock.assert_async().await;
        assert_eq!(session.token, "token-123");
        assert_eq!(opened_urls, vec!["https://example.com/device"]);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn setup_login_stops_when_authorization_is_denied() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut server = Server::new_async().await;
        let token_mock = server
            .mock("POST", "/api/auth/device/token")
            .with_status(400)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error":"access_denied"}"#)
            .create_async()
            .await;
        let config = AuthConfig {
            api_base_url: server.url(),
        };
        let temp_dir = tempdir().expect("temp dir");
        let _env = TempConfigEnv::set(temp_dir.path());
        let store = everr_core::state::AppStateStore::for_namespace("everr-auth-test");
        let client = everr_core::auth::build_auth_http_client().expect("http client");
        let authorization = DeviceAuthorization {
            device_code: "device-123".to_string(),
            user_code: "CODE-123".to_string(),
            verification_url: "https://example.com/device".to_string(),
            expires_in: 60,
            interval: 0,
        };

        let error = super::complete_setup_device_authorization_with_enter_prompt(
            &config,
            &store,
            &client,
            authorization,
            future::pending(),
            |_| Ok(()),
        )
        .await
        .expect_err("denied auth should fail");

        token_mock.assert_async().await;
        assert_eq!(error.to_string(), "device authentication was denied");
    }

    #[test]
    fn enter_key_opens_browser_and_ctrl_c_cancels() {
        assert_eq!(
            super::browser_prompt_action_for_key(
                KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE,)
            ),
            Some(super::BrowserPromptAction::OpenBrowser)
        );
        assert_eq!(
            super::browser_prompt_action_for_key(KeyEvent::new(
                KeyCode::Char('c'),
                KeyModifiers::CONTROL,
            )),
            Some(super::BrowserPromptAction::Cancel)
        );
        assert_eq!(
            super::browser_prompt_action_for_key(KeyEvent {
                code: KeyCode::Enter,
                modifiers: KeyModifiers::NONE,
                kind: KeyEventKind::Release,
                state: KeyEventState::NONE,
            }),
            None
        );
    }
}
