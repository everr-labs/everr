use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use tokio::time::sleep;

use crate::build;

const NO_ACTIVE_SESSION: &str = "no active session";

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub api_base_url: String,
}

const SETTINGS_KEY: &str = "settings";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Session {
    pub api_base_url: String,
    pub token: String,
}

#[derive(Debug, Clone)]
pub struct SessionDocument<TSettings> {
    pub session: Option<Session>,
    pub settings: Option<TSettings>,
}

impl<TSettings> Default for SessionDocument<TSettings> {
    fn default() -> Self {
        Self {
            session: None,
            settings: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionStore {
    namespace: String,
    session_file_name: String,
}

impl SessionStore {
    pub fn for_namespace(namespace: impl Into<String>) -> Self {
        Self::for_namespace_with_file_name(namespace, build::default_session_file_name())
    }

    pub fn for_namespace_with_file_name(
        namespace: impl Into<String>,
        session_file_name: impl Into<String>,
    ) -> Self {
        Self {
            namespace: namespace.into(),
            session_file_name: session_file_name.into(),
        }
    }

    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    pub fn session_file_name(&self) -> &str {
        &self.session_file_name
    }

    pub fn session_file_path(&self) -> Result<PathBuf> {
        let config_dir = dirs::config_dir().context("failed to resolve user config dir")?;
        Ok(config_dir
            .join(&self.namespace)
            .join(&self.session_file_name))
    }

    pub fn load_session(&self) -> Result<Session> {
        let document = self.load_document::<Value>()?;
        document.session.ok_or_else(|| anyhow::anyhow!(NO_ACTIVE_SESSION))
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        let mut document = self.load_document::<Value>().unwrap_or_default();
        document.session = Some(session.clone());
        self.save_document(&document)
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
        Ok(self.load_document::<Value>()?.session.is_some())
    }

    pub fn load_session_for_api_base_url(&self, expected_api_base_url: &str) -> Result<Session> {
        let session = self.load_session()?;
        if session_matches_api_base_url(&session.api_base_url, expected_api_base_url) {
            return Ok(session);
        }

        self.clear_session()?;
        bail!(NO_ACTIVE_SESSION);
    }

    pub fn has_active_session_for_api_base_url(&self, expected_api_base_url: &str) -> Result<bool> {
        match self.load_session_for_api_base_url(expected_api_base_url) {
            Ok(_) => Ok(true),
            Err(error) if is_no_active_session_error(&error) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn clear_mismatched_session(&self, expected_api_base_url: &str) -> Result<bool> {
        let session = match self.load_session() {
            Ok(session) => session,
            Err(error) if is_no_active_session_error(&error) => return Ok(false),
            Err(error) => return Err(error),
        };

        if session_matches_api_base_url(&session.api_base_url, expected_api_base_url) {
            return Ok(false);
        }

        self.clear_session()?;
        Ok(true)
    }

    pub fn load_document<TSettings>(&self) -> Result<SessionDocument<TSettings>>
    where
        TSettings: DeserializeOwned,
    {
        let path = self.session_file_path()?;
        if !path.exists() {
            return Ok(SessionDocument::default());
        }

        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let value = serde_json::from_str::<Value>(&raw)
            .with_context(|| format!("failed to parse {}", path.display()))?;
        let object = value
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("{} must contain a JSON object", path.display()))?;

        let session = if object.contains_key("api_base_url") || object.contains_key("token") {
            Some(
                serde_json::from_value::<Session>(Value::Object(object.clone()))
                    .context("failed to parse saved session")?,
            )
        } else {
            None
        };

        let settings = object
            .get(SETTINGS_KEY)
            .cloned()
            .map(serde_json::from_value::<TSettings>)
            .transpose()
            .context("failed to parse saved settings")?;

        Ok(SessionDocument { session, settings })
    }

    pub fn save_document<TSettings>(&self, document: &SessionDocument<TSettings>) -> Result<()>
    where
        TSettings: Serialize,
    {
        let path = self.session_file_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }

        if document.session.is_none() && document.settings.is_none() {
            if path.exists() {
                fs::remove_file(&path)
                    .with_context(|| format!("failed to remove {}", path.display()))?;
            }
            return Ok(());
        }

        let mut root = Map::new();
        if let Some(session) = &document.session {
            let session_value =
                serde_json::to_value(session).context("failed to serialize session")?;
            let session_object = session_value
                .as_object()
                .ok_or_else(|| anyhow::anyhow!("serialized session must be a JSON object"))?;
            for (key, value) in session_object {
                root.insert(key.clone(), value.clone());
            }
        }
        if let Some(settings) = &document.settings {
            root.insert(
                SETTINGS_KEY.to_string(),
                serde_json::to_value(settings).context("failed to serialize settings")?,
            );
        }

        let serialized =
            serde_json::to_string_pretty(&Value::Object(root)).context("failed to serialize document")?;
        fs::write(&path, serialized)
            .with_context(|| format!("failed to write {}", path.display()))?;
        Ok(())
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

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct DeviceErrorResponse {
    error: String,
}

#[derive(Debug, Clone)]
pub struct DeviceAuthorization {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone)]
pub enum DevicePollStatus {
    Authorized(DeviceTokenResponse),
    Pending,
    SlowDown,
    Denied,
    Expired,
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
    let authorization = start_device_authorization(&client, config).await?;
    show_prompt(authorization.verification_url.clone(), &authorization.user_code);
    login_with_device_authorization(config, store, authorization).await
}

pub async fn start_device_authorization(
    client: &reqwest::Client,
    config: &AuthConfig,
) -> Result<DeviceAuthorization> {
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

    Ok(map_device_authorization(authorization_body))
}

pub async fn poll_device_authorization(
    client: &reqwest::Client,
    config: &AuthConfig,
    authorization: &DeviceAuthorization,
) -> Result<DevicePollStatus> {
    let poll_url = format!("{}/api/cli/auth/device/poll", config.api_base_url);
    let token_response = client
        .post(&poll_url)
        .header(CONTENT_TYPE, "application/json")
        .body(format!("{{\"device_code\":\"{}\"}}", authorization.device_code))
        .send()
        .await
        .context("failed while polling for CLI access token")?;

    if token_response.status().is_success() {
        let token_body = token_response
            .json::<DeviceTokenResponse>()
            .await
            .context("failed to parse authentication response")?;
        return Ok(DevicePollStatus::Authorized(token_body));
    }

    let error_body = token_response
        .json::<DeviceErrorResponse>()
        .await
        .unwrap_or(DeviceErrorResponse {
            error: "unknown_error".to_string(),
        });

    match error_body.error.as_str() {
        "authorization_pending" => Ok(DevicePollStatus::Pending),
        "slow_down" => Ok(DevicePollStatus::SlowDown),
        "access_denied" => Ok(DevicePollStatus::Denied),
        "expired_token" => Ok(DevicePollStatus::Expired),
        _ => bail!("device authentication failed: {}", error_body.error),
    }
}

pub async fn login_with_device_authorization(
    config: &AuthConfig,
    store: &SessionStore,
    authorization: DeviceAuthorization,
) -> Result<Session> {
    let client = build_http_client()?;
    let token = complete_device_authorization_with_url(
        &client,
        &format!("{}/api/cli/auth/device/poll", config.api_base_url),
        authorization,
    )
    .await?;
    let session = build_session(config.api_base_url.clone(), token)?;
    store.save_session(&session)?;
    Ok(session)
}

pub fn save_session_from_device_token(
    config: &AuthConfig,
    store: &SessionStore,
    token: DeviceTokenResponse,
) -> Result<Session> {
    let session = build_session(config.api_base_url.clone(), token)?;
    store.save_session(&session)?;
    Ok(session)
}

fn build_http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .context("failed to build HTTP client")
}

pub fn build_auth_http_client() -> Result<reqwest::Client> {
    build_http_client()
}

pub fn is_no_active_session_error(error: &anyhow::Error) -> bool {
    error.to_string() == NO_ACTIVE_SESSION
}

fn session_matches_api_base_url(actual: &str, expected: &str) -> bool {
    actual.trim_end_matches('/') == expected.trim_end_matches('/')
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

fn map_device_authorization(authorization_body: DeviceAuthorizationResponse) -> DeviceAuthorization {
    let DeviceAuthorizationResponse {
        device_code,
        user_code,
        verification_uri,
        verification_uri_complete,
        expires_in,
        interval,
    } = authorization_body;

    DeviceAuthorization {
        device_code,
        user_code,
        verification_url: verification_uri_complete.unwrap_or(verification_uri),
        expires_in,
        interval: interval.unwrap_or(5),
    }
}

async fn complete_device_authorization_with_url(
    client: &reqwest::Client,
    poll_url: &str,
    authorization: DeviceAuthorization,
) -> Result<DeviceTokenResponse> {
    let deadline = Instant::now() + Duration::from_secs(authorization.expires_in);
    let mut poll_interval = authorization.interval;

    loop {
        if Instant::now() >= deadline {
            bail!("device authentication expired before completion");
        }

        sleep(Duration::from_secs(poll_interval)).await;

        let token_response = client
            .post(poll_url)
            .header(CONTENT_TYPE, "application/json")
            .body(format!("{{\"device_code\":\"{}\"}}", authorization.device_code))
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

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use tempfile::tempdir;

    use super::{Session, SessionStore};
    use crate::build;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn default_session_store_matches_current_build_defaults() {
        let store = SessionStore::for_namespace("everr");

        assert_eq!(store.namespace(), "everr");
        assert_eq!(
            store.session_file_name(),
            build::default_session_file_name()
        );
    }

    #[test]
    fn custom_session_file_name_is_preserved() {
        let store = SessionStore::for_namespace_with_file_name("everr", "session-dev.json");

        assert_eq!(store.namespace(), "everr");
        assert_eq!(store.session_file_name(), "session-dev.json");
    }

    #[test]
    fn load_session_for_api_base_url_clears_mismatched_session() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let temp = tempdir().expect("tempdir");
        let home = temp.path().join("home");
        std::fs::create_dir_all(&home).expect("create home dir");

        let original_home = std::env::var_os("HOME");
        let original_xdg = std::env::var_os("XDG_CONFIG_HOME");
        unsafe {
            std::env::set_var("HOME", &home);
            std::env::remove_var("XDG_CONFIG_HOME");
        }

        let store = SessionStore::for_namespace("everr");
        let session = Session {
            api_base_url: "https://app.everr.dev".to_string(),
            token: "token-123".to_string(),
        };
        store.save_session(&session).expect("save session");

        let error = store
            .load_session_for_api_base_url("http://localhost:5173")
            .expect_err("mismatched session should be rejected");
        assert_eq!(error.to_string(), "no active session");
        assert!(!store.session_file_path().expect("session path").exists());

        match original_home {
            Some(value) => unsafe { std::env::set_var("HOME", value) },
            None => unsafe { std::env::remove_var("HOME") },
        }
        match original_xdg {
            Some(value) => unsafe { std::env::set_var("XDG_CONFIG_HOME", value) },
            None => unsafe { std::env::remove_var("XDG_CONFIG_HOME") },
        }
    }
}
