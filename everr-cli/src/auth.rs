use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};

use crate::cli::LoginArgs;

const BUILT_API_BASE_URL: Option<&str> = option_env!("EVERR_API_BASE_URL");

#[derive(Debug)]
struct AuthConfig {
    api_base_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

#[derive(Debug, Deserialize)]
struct DeviceAuthorizationResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DeviceTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct DeviceErrorResponse {
    error: String,
}

pub async fn login(_args: LoginArgs) -> Result<()> {
    let config = resolve_auth_config()?;
    let client = build_http_client()?;
    let token = exchange_device_flow(&client, &config).await?;
    let session = build_session(config.api_base_url, token)?;

    save_session(&session)?;
    println!(
        "Logged in. Session saved at {}",
        session_file_path()?.display()
    );
    Ok(())
}

async fn exchange_device_flow(
    client: &reqwest::Client,
    config: &AuthConfig,
) -> Result<DeviceTokenResponse> {
    let authorization_response = client
        .post(format!("{}/api/cli/auth/device/start", config.api_base_url))
        .header(CONTENT_TYPE, "application/json")
        .send()
        .await
        .context("failed to start CLI device authorization")?;

    if !authorization_response.status().is_success() {
        let status = authorization_response.status();
        let body = authorization_response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        bail!("device authorization failed with {status}: {body}");
    }

    let authorization_body = authorization_response
        .json::<DeviceAuthorizationResponse>()
        .await
        .context("failed to parse device authorization response")?;

    show_device_sign_in_prompt(&authorization_body);
    println!("Waiting for authentication...");

    let deadline = Instant::now() + Duration::from_secs(authorization_body.expires_in);
    let mut poll_interval = authorization_body.interval.unwrap_or(5);

    loop {
        if Instant::now() >= deadline {
            bail!("device authentication expired before completion");
        }

        thread::sleep(Duration::from_secs(poll_interval));

        let token_response = client
            .post(format!("{}/api/cli/auth/device/poll", config.api_base_url))
            .header(CONTENT_TYPE, "application/json")
            .body(format!(
                "{{\"device_code\":\"{}\"}}",
                authorization_body.device_code
            ))
            .send()
            .await
            .context("failed while polling for CLI access token")?;

        if token_response.status().is_success() {
            let token_body = token_response
                .json::<DeviceTokenResponse>()
                .await
                .context("failed to parse authentication response")?;
            return Ok(token_body);
        }

        let error_body = token_response
            .json::<DeviceErrorResponse>()
            .await
            .unwrap_or(DeviceErrorResponse {
                error: "unknown_error".to_string(),
            });

        match error_body.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                poll_interval += 5;
                continue;
            }
            "access_denied" => bail!("device authentication was denied"),
            "expired_token" => bail!("device authentication token expired"),
            _ => bail!("device authentication failed: {}", error_body.error),
        }
    }
}

fn show_device_sign_in_prompt(authorization: &DeviceAuthorizationResponse) {
    let verification_url = authorization
        .verification_uri_complete
        .as_deref()
        .unwrap_or(authorization.verification_uri.as_str());
    let visit_line = format!("Auth URL: {verification_url}");
    let code_line = format!("Your code: {}", authorization.user_code);
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
    if let Err(error) = webbrowser::open(verification_url) {
        eprintln!(
            "Could not open browser automatically. Open this URL manually: {verification_url} ({error})"
        );
    }
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

pub async fn require_session_with_refresh() -> Result<Session> {
    load_session_from_disk()
}

fn load_session_from_disk() -> Result<Session> {
    let path = session_file_path()?;
    if !path.exists() {
        bail!("no active session; run `everr login`");
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

fn resolve_auth_config() -> Result<AuthConfig> {
    let api_base_url = BUILT_API_BASE_URL
        .and_then(trimmed_non_empty)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Missing BUILT_API_BASE_URL (EVERR_API_BASE_URL at build time). Rebuild everr with EVERR_API_BASE_URL set."
            )
        })?
        .to_string();

    Ok(AuthConfig { api_base_url })
}

fn build_http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .context("failed to build HTTP client")
}

fn build_session(api_base_url: String, token: DeviceTokenResponse) -> Result<Session> {
    if token.access_token.trim().is_empty() {
        bail!("received an empty access token");
    }
    Ok(Session {
        api_base_url,
        token: token.access_token,
    })
}

fn session_file_path() -> Result<PathBuf> {
    let config_dir = dirs::config_dir().context("failed to resolve user config dir")?;
    Ok(config_dir.join("everr").join("session.json"))
}
