use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::subscription::Subscription;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
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
    // Reject statically recognizable internal targets at create time. The
    // dispatcher repeats validation and pins approved DNS results at delivery.
    crate::api::webhook_url::validate_webhook_url(&body.webhook_url, state.allow_private_webhooks)
        .map_err(ApiError::Validation)?;
    let sub = state
        .store
        .create_subscription(&*state.cipher, t, &body.webhook_url)
        .await?;
    Ok(Json(sub.redacted()))
}

/// List this tenant's subscriptions with webhook URLs masked.
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Subscription>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let subs = state.store.subscriptions_for(&*state.cipher, t).await?;
    Ok(Json(subs.iter().map(Subscription::redacted).collect()))
}

/// Delete a subscription by id. Another tenant's id is a 404.
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state.store.delete_subscription(t, id).await?;
    crate::api::deleted(ok)
}
