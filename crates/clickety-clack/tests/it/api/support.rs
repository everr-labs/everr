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
use cc::stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
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

pub fn req(method: &str, uri: &str, tenant: Uuid, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(body.to_string()))
        .unwrap()
}
