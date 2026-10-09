use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::sync::Mutex;

use crate::{
    api::ApiClient,
    device_auth::{
        AuthConfig, DeviceAuthorization, DevicePollStatus, poll_device_authorization,
        session_from_device_token, start_device_authorization,
    },
    state::AppStateStore,
};

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(super) enum AuthResponse {
    SignedIn {
        session_path: String,
    },
    SignedOut {
        session_path: String,
    },
    Pending {
        user_code: String,
        verification_url: String,
        expires_at: String,
        poll_interval_seconds: u64,
    },
    Denied,
    Expired,
}

#[derive(Serialize)]
pub(super) struct UserProfile {
    email: String,
    name: String,
    profile_url: Option<String>,
}

#[derive(Serialize)]
pub(super) struct Organization {
    name: String,
}

struct PendingAuth {
    authorization: DeviceAuthorization,
    expires_at: DateTime<Utc>,
    next_poll_at: Instant,
}

impl PendingAuth {
    fn response(&self) -> AuthResponse {
        AuthResponse::Pending {
            user_code: self.authorization.user_code.clone(),
            verification_url: self.authorization.verification_url.clone(),
            expires_at: self.expires_at.to_rfc3339(),
            poll_interval_seconds: self.authorization.interval,
        }
    }
}

pub(super) struct LocalAuth {
    store: AppStateStore,
    config: AuthConfig,
    http: reqwest::Client,
    pending: Mutex<Option<PendingAuth>>,
}

impl LocalAuth {
    pub fn new(store: AppStateStore, config: AuthConfig, http: reqwest::Client) -> Self {
        Self {
            store,
            config,
            http,
            pending: Mutex::new(None),
        }
    }

    pub fn status(&self) -> Result<AuthResponse> {
        let session_path = self.store.session_file_path()?.display().to_string();
        Ok(
            if self
                .store
                .has_active_session_for_api_base_url(&self.config.api_base_url)?
            {
                AuthResponse::SignedIn { session_path }
            } else {
                AuthResponse::SignedOut { session_path }
            },
        )
    }

    pub async fn pending_sign_in(&self) -> Option<AuthResponse> {
        let mut pending = self.pending.lock().await;
        if pending.as_ref().is_some_and(|p| p.expires_at <= Utc::now()) {
            *pending = None;
        }
        pending.as_ref().map(PendingAuth::response)
    }

    pub async fn start_sign_in(&self) -> Result<AuthResponse> {
        let status = self.status()?;
        if matches!(status, AuthResponse::SignedIn { .. }) {
            return Ok(status);
        }
        let authorization = start_device_authorization(&self.http, &self.config).await?;
        let pending = PendingAuth {
            expires_at: Utc::now() + chrono::Duration::seconds(authorization.expires_in as i64),
            next_poll_at: Instant::now() + Duration::from_secs(authorization.interval),
            authorization,
        };
        let response = pending.response();
        *self.pending.lock().await = Some(pending);
        Ok(response)
    }

    pub async fn poll_sign_in(&self) -> Result<AuthResponse> {
        let mut guard = self.pending.lock().await;
        let Some(pending) = guard.as_mut() else {
            return Ok(AuthResponse::Expired);
        };
        if pending.expires_at <= Utc::now() {
            *guard = None;
            return Ok(AuthResponse::Expired);
        }
        if Instant::now() < pending.next_poll_at {
            return Ok(pending.response());
        }
        let status =
            poll_device_authorization(&self.http, &self.config, &pending.authorization).await?;
        pending.next_poll_at = Instant::now() + Duration::from_secs(pending.authorization.interval);
        match status {
            DevicePollStatus::Authorized(token) => {
                let session = session_from_device_token(&self.config, token)?;
                self.store.save_session(&session)?;
                *guard = None;
                self.status()
            }
            DevicePollStatus::Pending => Ok(pending.response()),
            DevicePollStatus::SlowDown => {
                pending.authorization.interval += 5;
                pending.next_poll_at += Duration::from_secs(5);
                Ok(pending.response())
            }
            DevicePollStatus::Denied => {
                *guard = None;
                Ok(AuthResponse::Denied)
            }
            DevicePollStatus::Expired => {
                *guard = None;
                Ok(AuthResponse::Expired)
            }
        }
    }

    pub async fn open_sign_in_browser(&self) -> Result<()> {
        let pending = self.pending.lock().await;
        let pending = pending
            .as_ref()
            .filter(|p| p.expires_at > Utc::now())
            .context("sign-in expired")?;
        webbrowser::open(&pending.authorization.verification_url)?;
        Ok(())
    }

    pub async fn sign_out(&self) -> Result<AuthResponse> {
        self.store.clear_session()?;
        *self.pending.lock().await = None;
        self.status()
    }

    pub async fn user_profile(&self) -> Result<Option<UserProfile>> {
        if !self
            .store
            .has_active_session_for_api_base_url(&self.config.api_base_url)?
        {
            return Ok(None);
        }
        Ok(Some(fetch_profile(self.api()?).await?))
    }

    pub async fn org(&self) -> Result<Organization> {
        Ok(Organization {
            name: self.api()?.get_org().await?.name,
        })
    }

    fn api(&self) -> Result<ApiClient> {
        ApiClient::from_session(
            &self
                .store
                .load_session_for_api_base_url(&self.config.api_base_url)?,
        )
    }
}

async fn fetch_profile(client: ApiClient) -> Result<UserProfile> {
    let profile = client.get_me().await?;
    Ok(UserProfile {
        email: profile.email,
        name: profile.name,
        profile_url: profile.profile_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_auth(url: String) -> (tempfile::TempDir, LocalAuth, AppStateStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = AppStateStore::for_namespace(dir.path().to_string_lossy());
        let auth = LocalAuth::new(
            store.clone(),
            AuthConfig { api_base_url: url },
            reqwest::Client::new(),
        );
        (dir, auth, store)
    }

    async fn code(server: &mut mockito::ServerGuard, expires_in: u64) -> mockito::Mock {
        server.mock("POST", "/api/auth/device/code")
            .match_body(mockito::Matcher::Json(json!({"client_id":"everr-desktop", "scope":"openid"})))
            .with_header("content-type", "application/json")
            .with_body(json!({"device_code":"secret-code", "user_code":"USER-CODE", "verification_uri":"http://example.test/verify", "expires_in":expires_in, "interval":0}).to_string())
            .expect(1).create_async().await
    }

    #[tokio::test]
    async fn pending_and_slow_down_preserve_the_wire_contract_and_session() {
        let mut server = mockito::Server::new_async().await;
        let code = code(&mut server, 60).await;
        let mut pending_requests = Vec::new();
        for error in ["authorization_pending", "slow_down"] {
            pending_requests.push(
                server
                    .mock("POST", "/api/auth/device/token")
                    .with_status(400)
                    .with_header("content-type", "application/json")
                    .with_body(json!({"error":error}).to_string())
                    .expect(1)
                    .create_async()
                    .await,
            );
        }
        let authorized = server
            .mock("POST", "/api/auth/device/token")
            .with_header("content-type", "application/json")
            .with_body(r#"{"access_token":"test-token"}"#)
            .expect(1)
            .create_async()
            .await;
        let profile = server
            .mock("GET", "/api/cli/me")
            .match_header("authorization", "Bearer test-token")
            .with_header("content-type", "application/json")
            .with_body(r#"{"email":"user@example.test","name":"Test User","profileUrl":null}"#)
            .expect(1)
            .create_async()
            .await;
        server
            .mock("GET", "/api/cli/org")
            .with_header("content-type", "application/json")
            .with_body(r#"{"name":"Test Org","isOnlyMember":false}"#)
            .create_async()
            .await;
        let (_dir, auth, store) = test_auth(server.url());
        store
            .save_session(&crate::state::Session {
                api_base_url: "http://other.test".into(),
                token: "other-token".into(),
            })
            .unwrap();
        assert!(matches!(
            auth.status().unwrap(),
            AuthResponse::SignedOut { .. }
        ));
        assert!(auth.user_profile().await.unwrap().is_none());
        assert_eq!(store.load_session().unwrap().token, "other-token");

        let started = serde_json::to_value(auth.start_sign_in().await.unwrap()).unwrap();
        assert_eq!(started["status"], "pending");
        assert_eq!(started["user_code"], "USER-CODE");
        assert_eq!(started["verification_url"], "http://example.test/verify");
        assert_eq!(started["poll_interval_seconds"], 0);
        assert_eq!(started.as_object().unwrap().len(), 5);
        DateTime::parse_from_rfc3339(started["expires_at"].as_str().unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(auth.pending_sign_in().await).unwrap(),
            started
        );
        assert_eq!(
            serde_json::to_value(auth.poll_sign_in().await.unwrap()).unwrap(),
            started
        );
        let slowed = serde_json::to_value(auth.poll_sign_in().await.unwrap()).unwrap();
        assert_eq!(slowed["poll_interval_seconds"], 5);
        assert_eq!(
            serde_json::to_value(auth.poll_sign_in().await.unwrap()).unwrap(),
            slowed
        );
        assert!(!authorized.matched_async().await);
        tokio::time::sleep(Duration::from_secs(5)).await;

        let signed_in = json!({"status":"signed_in", "session_path":store.session_file_path().unwrap().display().to_string()});
        assert_eq!(
            serde_json::to_value(auth.poll_sign_in().await.unwrap()).unwrap(),
            signed_in
        );
        assert_eq!(
            serde_json::to_value(auth.start_sign_in().await.unwrap()).unwrap(),
            signed_in
        );
        assert!(auth.pending_sign_in().await.is_none());
        assert_eq!(
            store
                .load_session_for_api_base_url(&server.url())
                .unwrap()
                .token,
            "test-token"
        );
        let user = json!({"email":"user@example.test", "name":"Test User", "profile_url":null});
        assert_eq!(
            serde_json::to_value(auth.user_profile().await.unwrap()).unwrap(),
            user
        );
        assert_eq!(
            serde_json::to_value(auth.org().await.unwrap()).unwrap(),
            json!({"name":"Test Org"})
        );
        assert_eq!(
            serde_json::to_value(auth.sign_out().await.unwrap()).unwrap()["status"],
            "signed_out"
        );
        assert!(auth.user_profile().await.unwrap().is_none());
        assert!(!store.has_active_session().unwrap());
        code.assert_async().await;
        authorized.assert_async().await;
        profile.assert_async().await;
        for request in pending_requests {
            request.assert_async().await;
        }
    }

    #[tokio::test]
    async fn denied_and_expired_sign_ins_clear_the_pending_code() {
        for (error, status) in [("access_denied", "denied"), ("expired_token", "expired")] {
            let mut server = mockito::Server::new_async().await;
            code(&mut server, 60).await;
            let token = server
                .mock("POST", "/api/auth/device/token")
                .with_status(400)
                .with_header("content-type", "application/json")
                .with_body(json!({"error":error}).to_string())
                .expect(1)
                .create_async()
                .await;
            let (_dir, auth, store) = test_auth(server.url());
            auth.start_sign_in().await.unwrap();
            assert_eq!(
                serde_json::to_value(auth.poll_sign_in().await.unwrap()).unwrap(),
                json!({"status":status})
            );
            assert!(auth.pending_sign_in().await.is_none());
            assert!(!store.has_active_session().unwrap());
            assert!(matches!(
                auth.poll_sign_in().await.unwrap(),
                AuthResponse::Expired
            ));
            token.assert_async().await;
        }
    }

    #[tokio::test]
    async fn expired_and_cancelled_codes_are_not_polled_or_opened() {
        for expired in [true, false] {
            let mut server = mockito::Server::new_async().await;
            code(&mut server, if expired { 0 } else { 60 }).await;
            let token = server
                .mock("POST", "/api/auth/device/token")
                .expect(0)
                .create_async()
                .await;
            let (_dir, auth, _) = test_auth(server.url());
            auth.start_sign_in().await.unwrap();
            if !expired {
                auth.sign_out().await.unwrap();
            }
            assert!(auth.pending_sign_in().await.is_none());
            assert!(matches!(
                auth.poll_sign_in().await.unwrap(),
                AuthResponse::Expired
            ));
            assert_eq!(
                auth.open_sign_in_browser().await.unwrap_err().to_string(),
                "sign-in expired"
            );
            token.assert_async().await;
        }
    }
}
