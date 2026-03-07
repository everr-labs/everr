use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use tokio::time::sleep;

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub api_base_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    namespace: String,
}

impl SessionStore {
    pub fn for_command(command_name: &str) -> Self {
        let namespace = if command_name == "everr-dev" {
            "everr-dev".to_string()
        } else {
            "everr".to_string()
        };
        Self { namespace }
    }

    pub fn for_namespace(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
        }
    }

    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    pub fn session_file_path(&self) -> Result<PathBuf> {
        let config_dir = dirs::config_dir().context("failed to resolve user config dir")?;
        Ok(config_dir.join(&self.namespace).join("session.json"))
    }

    pub fn load_session(&self) -> Result<Session> {
        let path = self.session_file_path()?;
        if !path.exists() {
            bail!("no active session");
        }

        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        serde_json::from_str::<Session>(&raw).context("failed to parse saved session")
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        let path = self.session_file_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let serialized =
            serde_json::to_string_pretty(session).context("failed to serialize session")?;
        fs::write(&path, serialized)
            .with_context(|| format!("failed to write {}", path.display()))?;
        Ok(())
    }

    pub fn clear_session(&self) -> Result<bool> {
        let path = self.session_file_path()?;
        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("failed to remove {}", path.display()))?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn has_active_session(&self) -> Result<bool> {
        Ok(self.session_file_path()?.exists())
    }
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

pub async fn login_with_prompt<F>(
    config: &AuthConfig,
    store: &SessionStore,
    show_prompt: F,
) -> Result<Session>
where
    F: FnOnce(String, &str),
{
    let client = build_http_client()?;
    let token = exchange_device_flow(&client, config, show_prompt).await?;
    let session = build_session(config.api_base_url.clone(), token)?;
    store.save_session(&session)?;
    Ok(session)
}

async fn exchange_device_flow<F>(
    client: &reqwest::Client,
    config: &AuthConfig,
    show_prompt: F,
) -> Result<DeviceTokenResponse>
where
    F: FnOnce(String, &str),
{
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

    let poll_url = format!("{}/api/cli/auth/device/poll", config.api_base_url);
    exchange_device_flow_with_prompt(client, &poll_url, authorization_body, show_prompt).await
}

async fn exchange_device_flow_with_prompt<F>(
    client: &reqwest::Client,
    poll_url: &str,
    authorization_body: DeviceAuthorizationResponse,
    show_prompt: F,
) -> Result<DeviceTokenResponse>
where
    F: FnOnce(String, &str),
{
    let DeviceAuthorizationResponse {
        device_code,
        user_code,
        verification_uri,
        verification_uri_complete,
        expires_in,
        interval,
    } = authorization_body;

    let verification_url = verification_uri_complete.unwrap_or(verification_uri);
    show_prompt(verification_url, &user_code);

    let deadline = Instant::now() + Duration::from_secs(expires_in);
    let mut poll_interval = interval.unwrap_or(5);

    loop {
        if Instant::now() >= deadline {
            bail!("device authentication expired before completion");
        }

        sleep(Duration::from_secs(poll_interval)).await;

        let token_response = client
            .post(poll_url)
            .header(CONTENT_TYPE, "application/json")
            .body(format!("{{\"device_code\":\"{}\"}}", device_code))
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

#[cfg(test)]
mod tests {
    use super::SessionStore;

    #[test]
    fn session_namespace_uses_dev_namespace_for_everr_dev() {
        assert_eq!(
            SessionStore::for_command("everr-dev").namespace(),
            "everr-dev"
        );
    }

    #[test]
    fn session_namespace_uses_default_namespace_for_other_commands() {
        assert_eq!(SessionStore::for_command("everr").namespace(), "everr");
        assert_eq!(
            SessionStore::for_command("custom-name").namespace(),
            "everr"
        );
    }
}
