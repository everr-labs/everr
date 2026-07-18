use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::subscription::Subscription;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateSub {
    pub webhook_url: String,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSub>,
) -> Result<Json<Subscription>, ApiError> {
    let t = tenant(&state, &headers)?;
    // SSRF guard: reject statically-recognizable internal targets at create time.
    // DNS-rebinding-resistant egress filtering is a deployment-level concern
    // (see `crate::api::webhook_url` module docs).
    crate::api::webhook_url::validate_webhook_url(&body.webhook_url, state.allow_private_webhooks)
        .map_err(ApiError::Validation)?;
    let sub = state
        .store
        .create_subscription(&*state.cipher, t, &body.webhook_url)
        .await?;
    Ok(Json(sub))
}

/// List this tenant's subscriptions (webhook URLs are returned decrypted, as stored).
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Subscription>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let subs = state.store.subscriptions_for(&*state.cipher, t).await?;
    Ok(Json(subs))
}

/// Delete a subscription by id. Another tenant's id is a 404.
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state.store.delete_subscription(t, id).await?;
    if ok {
        Ok(Json(json!({"deleted": true})))
    } else {
        Err(ApiError::NotFound)
    }
}
