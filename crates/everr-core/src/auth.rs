use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use reqwest::header::CONTENT_TYPE;
use serde::Deserialize;
use tokio::time::sleep;

use crate::state::{AppStateStore, Session};

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

pub async fn login_with_prompt<F>(
    config: &AuthConfig,
    store: &AppStateStore,
    show_prompt: F,
) -> Result<Session>
where
    F: FnOnce(String, &str),
{
    let client = build_http_client()?;
    let authorization = start_device_authorization(&client, config).await?;
    show_prompt(
        authorization.verification_url.clone(),
        &authorization.user_code,
    );
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
        .body(format!(
            "{{\"device_code\":\"{}\"}}",
            authorization.device_code
        ))
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
    store: &AppStateStore,
    authorization: DeviceAuthorization,
) -> Result<Session> {
    let client = build_http_client()?;
    let token = complete_device_authorization_with_url(
        &client,
        &format!("{}/api/cli/auth/device/poll", config.api_base_url),
        authorization,
    )
    .await?;
    let session = session_from_device_token(config, token)?;
    store.save_session(&session)?;
    Ok(session)
}

pub fn session_from_device_token(
    config: &AuthConfig,
    token: DeviceTokenResponse,
) -> Result<Session> {
    build_session(config.api_base_url.clone(), token)
}

fn build_http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .context("failed to build HTTP client")
}

pub fn build_auth_http_client() -> Result<reqwest::Client> {
    build_http_client()
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
            .body(format!(
                "{{\"device_code\":\"{}\"}}",
                authorization.device_code
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

#[cfg(test)]
mod tests {
    use super::{AuthConfig, DeviceTokenResponse, session_from_device_token};

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
