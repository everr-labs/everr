use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use reqwest::StatusCode;
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

pub async fn login_with_prompt<F, Fut>(
    config: &AuthConfig,
    store: &AppStateStore,
    show_prompt: F,
) -> Result<Session>
where
    F: FnOnce(String, String) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let client = build_http_client()?;
    let authorization = start_device_authorization(&client, config).await?;

    // Run the prompt to completion before polling so we never have a
    // concurrent stdin reader fighting later prompts for keystrokes.
    show_prompt(
        authorization.verification_url.clone(),
        authorization.user_code.clone(),
    )
    .await;

    let poll_url = format!("{}/api/auth/device/token", config.api_base_url);
    let token = complete_device_authorization_with_url(&client, &poll_url, authorization).await?;

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
        .header(CONTENT_TYPE, "application/json")
        .body("{\"client_id\":\"everr-desktop\",\"scope\":\"openid\"}")
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
        .header(CONTENT_TYPE, "application/json")
        .body(format!(
            "{{\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\",\"device_code\":\"{}\",\"client_id\":\"everr-desktop\"}}",
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
        &format!("{}/api/auth/device/token", config.api_base_url),
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

#[derive(Debug, Deserialize)]
struct ServiceAccountTokenResponse {
    token: String,
    // Not read yet. No caller tracks expiry, and none re-exchanges on a 401 either:
    // the CLI exchanges once per process and caches the session, so a process that
    // runs longer than the token's hour fails instead of refreshing. Refresh on 401
    // is a known gap, not a behavior that exists.
    #[allow(dead_code)]
    expires_at: String,
}

/// How long to wait before the single retry of a rate limited exchange.
const RATE_LIMIT_RETRY_DELAY: Duration = Duration::from_secs(2);

pub async fn exchange_service_account_secret(config: &AuthConfig, secret: &str) -> Result<Session> {
    exchange_service_account_secret_after(config, secret, RATE_LIMIT_RETRY_DELAY).await
}

async fn exchange_service_account_secret_after(
    config: &AuthConfig,
    secret: &str,
    retry_delay: Duration,
) -> Result<Session> {
    let client = build_http_client()?;
    let mut response = post_service_account_secret(&client, config, secret).await?;

    // Nobody attends an unattended run, so one retry here is the difference
    // between a command that recovers from a burst of agents sharing an
    // egress address and one that fails the whole job.
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        sleep(retry_delay).await;
        response = post_service_account_secret(&client, config, secret).await?;
    }

    if !response.status().is_success() {
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            bail!(
                "the service account token endpoint rate limited this request and the retry that followed it; retry later"
            );
        }
        bail!("the service account secret was rejected");
    }

    let body: ServiceAccountTokenResponse = response
        .json()
        .await
        .context("failed to read the service account token response")?;

    if body.token.trim().is_empty() {
        bail!("received an empty service account token");
    }

    Ok(Session {
        api_base_url: config.api_base_url.clone(),
        token: body.token,
    })
}

async fn post_service_account_secret(
    client: &reqwest::Client,
    config: &AuthConfig,
    secret: &str,
) -> Result<reqwest::Response> {
    client
        .post(format!(
            "{}/api/service-accounts/token",
            config.api_base_url
        ))
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({ "secret": secret }))
        .send()
        .await
        .context("failed to reach the service account token endpoint")
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
                "{{\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\",\"device_code\":\"{}\",\"client_id\":\"everr-desktop\"}}",
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
    use std::time::Duration;

    use super::{
        AuthConfig, DeviceTokenResponse, exchange_service_account_secret,
        exchange_service_account_secret_after, session_from_device_token,
    };

    // The tests below drive the retry with no delay so they never wait for
    // the real one.
    const NO_DELAY: Duration = Duration::ZERO;

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

    #[tokio::test]
    async fn exchange_service_account_secret_rejects_an_empty_token() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/api/service-accounts/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"token":"","expires_at":"2026-01-01T00:00:00Z"}"#)
            .create_async()
            .await;
        let config = AuthConfig {
            api_base_url: server.url(),
        };

        let error = exchange_service_account_secret(&config, "sa-secret")
            .await
            .expect_err("an empty token should fail");

        assert_eq!(error.to_string(), "received an empty service account token");
    }

    #[tokio::test]
    async fn exchange_service_account_secret_retries_once_when_rate_limited() {
        // Agents behind one egress address share the endpoint's bucket, so a
        // burst can rate limit a run that nobody is there to start again.
        let mut server = mockito::Server::new_async().await;
        let limited = server
            .mock("POST", "/api/service-accounts/token")
            .with_status(429)
            .expect(1)
            .create_async()
            .await;
        let issued = server
            .mock("POST", "/api/service-accounts/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"token":"st_abc","expires_at":"2026-01-01T00:00:00Z"}"#)
            .expect(1)
            .create_async()
            .await;
        let config = AuthConfig {
            api_base_url: server.url(),
        };

        let session = exchange_service_account_secret_after(&config, "sa-secret", NO_DELAY)
            .await
            .expect("the retry should succeed");

        assert_eq!(session.token, "st_abc");
        limited.assert_async().await;
        issued.assert_async().await;
    }

    #[tokio::test]
    async fn exchange_service_account_secret_reports_rate_limiting_distinctly() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/api/service-accounts/token")
            .with_status(429)
            .create_async()
            .await;
        let config = AuthConfig {
            api_base_url: server.url(),
        };

        let error = exchange_service_account_secret_after(&config, "sa-secret", NO_DELAY)
            .await
            .expect_err("a 429 that repeats should fail");

        let message = error.to_string();
        assert!(message.contains("retry"), "message was: {message}");
        assert!(!message.contains("rejected"), "message was: {message}");
    }

    #[tokio::test]
    async fn exchange_service_account_secret_reports_other_failures_as_rejected() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/api/service-accounts/token")
            .with_status(401)
            .create_async()
            .await;
        let config = AuthConfig {
            api_base_url: server.url(),
        };

        let error = exchange_service_account_secret(&config, "sa-secret")
            .await
            .expect_err("a 401 should fail");

        assert_eq!(error.to_string(), "the service account secret was rejected");
    }
}
