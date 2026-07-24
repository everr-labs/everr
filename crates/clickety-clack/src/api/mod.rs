pub mod alerts;
pub mod auth;
pub mod channels;
pub mod error;
mod identity;
pub mod inhibitions;
pub mod receivers;
pub mod routes;
pub mod rules;
pub mod silences;
pub mod slos;
pub mod subscriptions;
pub mod trace;
pub mod webhook_url;

use crate::clickhouse::ChClient;
use crate::crypto::SecretCipher;
use crate::stores::PgStore;
use crate::supervisor::RolesHealth;
use auth::{require_api_key, ApiKeySet, Authenticator};
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub store: PgStore,
    pub ch: ChClient,
    pub auth: Arc<dyn Authenticator>,
    pub cipher: Arc<dyn SecretCipher>,
    /// Allow private/loopback webhook targets (`CC_ALLOW_PRIVATE_WEBHOOKS=1`,
    /// dev/compose only). See [`webhook_url::validate_webhook_url`].
    pub allow_private_webhooks: bool,
}

/// Which values appear more than once in `values` (order-preserving, each
/// duplicate reported once). Shared by the channel-recipient and
/// receiver-channel-reference duplicate guards.
pub(crate) fn duplicate_entries(values: &[String]) -> Vec<String> {
    let mut dupes = Vec::new();
    for (i, v) in values.iter().enumerate() {
        if values[..i].contains(v) && !dupes.contains(v) {
            dupes.push(v.clone());
        }
    }
    dupes
}

/// `__cc_`-prefixed label names are reserved (e.g. the per-rule rule-health instance
/// key). Rejecting them keeps a data instance from ever colliding with a synthetic
/// one. Shared by the rule and SLO spec validators.
pub(crate) fn reject_reserved_label_columns(
    label_columns: &[String],
) -> Result<(), error::ApiError> {
    if let Some(col) = label_columns.iter().find(|c| c.starts_with("__cc_")) {
        return Err(error::ApiError::Validation(format!(
            "label column {col:?} uses the reserved \"__cc_\" prefix"
        )));
    }
    Ok(())
}

/// The shared delete-handler tail: `{"deleted": true}` when the row existed,
/// 404 otherwise.
pub(crate) fn deleted(ok: bool) -> Result<axum::Json<serde_json::Value>, error::ApiError> {
    if ok {
        Ok(axum::Json(serde_json::json!({"deleted": true})))
    } else {
        Err(error::ApiError::NotFound)
    }
}

/// Router with the API-key gate disabled (dev default, and the pre-gate
/// behavior). Equivalent to `build_router_with_auth(state, ApiKeySet::default())`.
pub fn build_router(state: AppState) -> Router {
    build_router_with_auth(state, ApiKeySet::default())
}

/// Router with a static bearer-key gate on every `/v1` route.
/// `/healthz` and `/readyz` stay unauthenticated. An empty
/// `ApiKeySet` disables the gate. `/readyz` always reports ready here; the
/// supervised binary uses [`build_supervised_router`] instead.
pub fn build_router_with_auth(state: AppState, api_keys: ApiKeySet) -> Router {
    build_supervised_router(state, api_keys, RolesHealth::default())
}

/// Like [`build_router_with_auth`], but `/readyz` reflects role supervision:
/// 200 `ok` when every supervised role is running, 503 `degraded: <roles>` when
/// any role in this process is down or waiting out a restart backoff. Liveness
/// (`/healthz`) stays unconditional; a degraded pod must not be killed by the
/// liveness probe while the supervisor is already handling the failure.
pub fn build_supervised_router(
    state: AppState,
    api_keys: ApiKeySet,
    health: RolesHealth,
) -> Router {
    let v1 = Router::new()
        .route("/v1/rules", post(rules::create).get(rules::list))
        .route(
            "/v1/rules/:id",
            get(rules::get).put(rules::update).delete(rules::delete),
        )
        .route("/v1/rules/:id/test", post(rules::test))
        .route("/v1/rules/:id/pause", post(rules::pause))
        .route("/v1/rules/:id/resume", post(rules::resume))
        .route("/v1/slos", post(slos::create).get(slos::list))
        .route(
            "/v1/slos/:id",
            get(slos::get).put(slos::update).delete(slos::delete),
        )
        .route("/v1/slos/:id/pause", post(slos::pause))
        .route("/v1/slos/:id/resume", post(slos::resume))
        .route("/v1/slos/:id/status", get(slos::status))
        .route("/v1/slos/:id/test", post(slos::test))
        .route("/v1/alerts", get(alerts::list))
        .route(
            "/v1/subscriptions",
            post(subscriptions::create).get(subscriptions::list),
        )
        .route(
            "/v1/subscriptions/:id",
            axum::routing::delete(subscriptions::delete),
        )
        .route("/v1/channels", post(channels::create).get(channels::list))
        .route(
            "/v1/channels/:name",
            get(channels::get)
                .put(channels::update)
                .delete(channels::delete),
        )
        .route(
            "/v1/receivers",
            post(receivers::create).get(receivers::list),
        )
        .route(
            "/v1/receivers/:name",
            get(receivers::get)
                .put(receivers::update)
                .delete(receivers::delete),
        )
        .route("/v1/routes", post(routes::create).get(routes::list))
        .route(
            "/v1/routes/:id",
            axum::routing::put(routes::update).delete(routes::delete),
        )
        .route("/v1/silences", post(silences::create).get(silences::list))
        .route("/v1/silences/:id", axum::routing::delete(silences::delete))
        .route(
            "/v1/inhibitions",
            post(inhibitions::create).get(inhibitions::list),
        )
        .route(
            "/v1/inhibitions/:id",
            axum::routing::delete(inhibitions::delete),
        )
        .layer(middleware::from_fn_with_state(api_keys, require_api_key))
        .with_state(state);
    let readyz = move || {
        let health = health.clone();
        async move {
            let degraded = health.degraded();
            if degraded.is_empty() {
                (axum::http::StatusCode::OK, "ok".to_string())
            } else {
                (
                    axum::http::StatusCode::SERVICE_UNAVAILABLE,
                    format!("degraded: {}", degraded.join(",")),
                )
            }
        }
    };
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readyz))
        .merge(v1)
        .layer(axum::middleware::from_fn(trace::trace_request))
}
