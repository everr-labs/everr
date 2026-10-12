use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use tokio::time::sleep;

use crate::state::{Session, SessionStore};

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub api_base_url: String,
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

pub async fn login_with_prompt<F, Fut>(
    config: &AuthConfig,
    store: &SessionStore,
    show_prompt: F,
) -> Result<Session>
where
    F: FnOnce(String, String) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let client = build_auth_http_client()?;
    let authorization = start_device_authorization(&client, config).await?;

    // Run the prompt to completion before polling so we never have a
    // concurrent stdin reader fighting later prompts for keystrokes.
    show_prompt(
        authorization.verification_url.clone(),
        authorization.user_code.clone(),
    )
    .await;

    let token = complete_device_authorization(&client, config, authorization).await?;

    let session = session_from_device_token(config, token)?;
    store.save_session(&session)?;
    Ok(session)
}

pub async fn start_device_authorization(
    client: &reqwest::Client,
    config: &AuthConfig,
) -> Result<DeviceAuthorization> {
    let authorization_response = client
        .post(format!("{}/api/auth/device/code", config.api_base_url))
        .json(&serde_json::json!({ "client_id": "everr-desktop", "scope": "openid" }))
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
    let poll_url = format!("{}/api/auth/device/token", config.api_base_url);
    let token_response = client
        .post(&poll_url)
        .json(&serde_json::json!({
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": authorization.device_code,
            "client_id": "everr-desktop",
        }))
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

pub fn session_from_device_token(
    config: &AuthConfig,
    token: DeviceTokenResponse,
) -> Result<Session> {
    if token.access_token.trim().is_empty() {
        bail!("received an empty access token");
    }
    Ok(Session {
        api_base_url: config.api_base_url.clone(),
        token: token.access_token,
    })
}

pub fn build_auth_http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .context("failed to build HTTP client")
}

fn map_device_authorization(
    authorization_body: DeviceAuthorizationResponse,
) -> DeviceAuthorization {
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

async fn complete_device_authorization(
    client: &reqwest::Client,
    config: &AuthConfig,
    mut authorization: DeviceAuthorization,
) -> Result<DeviceTokenResponse> {
    let deadline = Instant::now() + Duration::from_secs(authorization.expires_in);

    loop {
        if Instant::now() >= deadline {
            bail!("device authentication expired before completion");
        }

        sleep(Duration::from_secs(authorization.interval)).await;
        match poll_device_authorization(client, config, &authorization).await? {
            DevicePollStatus::Authorized(token) => return Ok(token),
            DevicePollStatus::Pending => {}
            DevicePollStatus::SlowDown => authorization.interval += 5,
            DevicePollStatus::Denied => bail!("device authentication was denied"),
            DevicePollStatus::Expired => bail!("device authentication token expired"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthConfig, DeviceTokenResponse, login_with_prompt, session_from_device_token};
    use crate::state::SessionStore;

    #[tokio::test]
    async fn terminal_login_preserves_device_token_outcomes() {
        for (response, error) in [
            (r#"{"access_token":"test-token"}"#, None),
            (
                r#"{"error":"access_denied"}"#,
                Some("device authentication was denied"),
            ),
            (
                r#"{"error":"expired_token"}"#,
                Some("device authentication token expired"),
            ),
            (
                r#"{"error":"invalid_grant"}"#,
                Some("device authentication failed: invalid_grant"),
            ),
        ] {
            let mut server = mockito::Server::new_async().await;
            let device_code = "device-\"code\\with\nescapes";
            server.mock("POST", "/api/auth/device/code")
                .with_header("content-type", "application/json")
                .with_body(serde_json::json!({"device_code":device_code,"user_code":"USER-CODE","verification_uri":"http://example.test/verify","expires_in":60,"interval":0}).to_string())
                .create_async().await;
            let mut intermediate_requests = Vec::new();
            if error.is_none() {
                for status in ["authorization_pending", "slow_down"] {
                    intermediate_requests.push(
                        server
                            .mock("POST", "/api/auth/device/token")
                            .with_status(400)
                            .with_header("content-type", "application/json")
                            .with_body(serde_json::json!({"error": status}).to_string())
                            .expect(1)
                            .create_async()
                            .await,
                    );
                }
            }
            let token_request = server
                .mock("POST", "/api/auth/device/token")
                .match_body(mockito::Matcher::Json(serde_json::json!({
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": device_code,
                    "client_id": "everr-desktop",
                })))
                .with_status(if error.is_some() { 400 } else { 200 })
                .with_header("content-type", "application/json")
                .with_body(response)
                .expect(1)
                .create_async()
                .await;
            let dir = tempfile::tempdir().expect("tempdir");
            let store = SessionStore::for_namespace(dir.path().to_string_lossy());
            let config = AuthConfig {
                api_base_url: server.url(),
            };
            let result = login_with_prompt(&config, &store, |url, code| async move {
                assert_eq!(url, "http://example.test/verify");
                assert_eq!(code, "USER-CODE");
            })
            .await;
            token_request.assert_async().await;
            for request in intermediate_requests {
                request.assert_async().await;
            }
            match error {
                Some(message) => {
                    assert_eq!(result.expect_err("login must fail").to_string(), message);
                    assert!(!store.session_file_path().expect("session path").exists());
                }
                None => {
                    let session = result.expect("login must succeed");
                    assert_eq!(session.token, "test-token");
                    assert_eq!(
                        store
                            .load_session_for_api_base_url(&config.api_base_url)
                            .expect("saved session"),
                        session
                    );
                }
            }
        }
    }

    #[test]
    fn session_from_device_token_rejects_blank_tokens() {
        let error = session_from_device_token(
            &AuthConfig {
                api_base_url: "https://app.everr.dev".to_string(),
            },
            DeviceTokenResponse {
                access_token: "   ".to_string(),
            },
        )
        .expect_err("blank token should fail");

        assert_eq!(error.to_string(), "received an empty access token");
    }
}
