//! Shared harness for the API suites: an `AppState` over a fresh database with a
//! stubbed ClickHouse client (these suites never reach ClickHouse) and `HeaderAuth`,
//! plus the request/response helpers most suites share.
#![allow(dead_code)] // each suite uses a subset of these helpers

use axum::body::Body;
use axum::http::Request;
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::dispatcher::{Notification, Notifier, Notifiers, NotifyError};
use cc::domain::channel::ChannelConfig;
use cc::stores::PgStore;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub const TENANT: &str = "acme";

pub async fn state() -> AppState {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    AppState {
        store,
        ch: ChClient::new(
            "http://127.0.0.1:1",
            cc::clickhouse::build_ch_auth("shared", "default", "", None, None, "", None).unwrap(),
        ),
        auth: Arc::new(HeaderAuth),
        cipher: Arc::new(
            EnvKeyring::new(
                HashMap::from([("v1".to_string(), [7u8; 32])]),
                "v1".to_string(),
            )
            .unwrap(),
        ),
        allow_private_webhooks: false,
        notifiers: Arc::new(Notifiers::new()),
    }
}

/// A notifier the API suites can steer: records what it was asked to send and
/// returns whatever outcome the test set. Registered under a channel name the
/// test chooses, so one fake can stand in for slack, webhook or email.
pub struct FakeNotifier {
    channel: &'static str,
    pub outcome: Mutex<Result<(), NotifyError>>,
    pub sent: Mutex<Vec<(ChannelConfig, String)>>,
}

impl FakeNotifier {
    pub fn new(channel: &'static str) -> Self {
        Self {
            channel,
            outcome: Mutex::new(Ok(())),
            sent: Mutex::new(Vec::new()),
        }
    }

    pub fn failing(channel: &'static str, err: NotifyError) -> Self {
        let f = Self::new(channel);
        *f.outcome.lock().unwrap() = Err(err);
        f
    }
}

#[async_trait::async_trait]
impl Notifier for FakeNotifier {
    fn channel(&self) -> &'static str {
        self.channel
    }

    async fn send(&self, config: &ChannelConfig, notif: &Notification) -> Result<(), NotifyError> {
        self.sent
            .lock()
            .unwrap()
            .push((config.clone(), notif.group_key.clone()));
        match &*self.outcome.lock().unwrap() {
            Ok(()) => Ok(()),
            Err(NotifyError::Transient(m)) => Err(NotifyError::Transient(m.clone())),
            Err(NotifyError::Permanent(m)) => Err(NotifyError::Permanent(m.clone())),
        }
    }
}

/// An `AppState` whose registry holds exactly the given notifiers.
pub async fn state_with_notifiers(list: Vec<Arc<dyn Notifier>>) -> AppState {
    let mut reg = Notifiers::new();
    for n in list {
        reg.register(n);
    }
    AppState {
        notifiers: Arc::new(reg),
        ..state().await
    }
}

pub async fn setup() -> (axum::Router, PgStore) {
    let state = state().await;
    let store = state.store.clone();
    (build_router(state), store)
}

pub async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// Seed a webhook channel plus a receiver of that name for each entry, so route tests
/// have something to target: a route write rejects a receiver that does not exist.
pub async fn seed_receivers(app: &axum::Router, tenant: Uuid, names: &[&str]) {
    use axum::http::StatusCode;
    use tower::ServiceExt;
    for name in names {
        let channel = format!("{name}-hook");
        let resp = app
            .clone()
            .oneshot(req(
                "POST",
                "/v1/channels",
                tenant,
                &format!(
                    r#"{{"name":"{channel}","config":{{"type":"webhook","url":"http://x/h"}}}}"#
                ),
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "seeding channel {channel}");
        let resp = app
            .clone()
            .oneshot(req(
                "POST",
                "/v1/receivers",
                tenant,
                &format!(r#"{{"name":"{name}","channels":["{channel}"]}}"#),
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "seeding receiver {name}");
    }
}

pub fn req(method: &str, uri: &str, tenant: Uuid, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(body.to_string()))
        .unwrap()
}
