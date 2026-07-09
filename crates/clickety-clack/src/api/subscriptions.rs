use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::subscription::Subscription;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event as SseEvent, Sse};
use axum::Json;
use futures::stream::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
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
    let t = state
        .auth
        .tenant_from(&headers)
        .ok_or(ApiError::Unauthorized)?;
    // SSRF guard: reject statically-recognizable internal targets at create time.
    // DNS-rebinding-resistant egress filtering is a deployment-level concern
    // (see `crate::api::webhook_url` module docs).
    crate::api::webhook_url::validate_webhook_url(&body.webhook_url, state.allow_private_webhooks)
        .map_err(ApiError::Validation)?;
    let sub = state
        .store
        .create_subscription(&*state.cipher, t, &body.webhook_url)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(sub))
}

/// List this tenant's subscriptions (webhook URLs are returned decrypted, as stored).
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Subscription>>, ApiError> {
    let t = state
        .auth
        .tenant_from(&headers)
        .ok_or(ApiError::Unauthorized)?;
    let subs = state
        .store
        .subscriptions_for(&*state.cipher, t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(subs))
}

/// Delete a subscription by id. Another tenant's id is a 404.
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = state
        .auth
        .tenant_from(&headers)
        .ok_or(ApiError::Unauthorized)?;
    let ok = state
        .store
        .delete_subscription(t, id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if ok {
        Ok(Json(json!({"deleted": true})))
    } else {
        Err(ApiError::NotFound)
    }
}

/// SSE: stream this tenant's firing/resolved events as they happen.
pub async fn stream(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<SseEvent, Infallible>>>, ApiError> {
    let t = state
        .auth
        .tenant_from(&headers)
        .ok_or(ApiError::Unauthorized)?;
    let rx = state.events_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(move |res| {
        let ev = res.ok()?;
        if ev.tenant != t {
            return None;
        }
        let data = serde_json::to_string(&ev).ok()?;
        Some(Ok(SseEvent::default().data(data)))
    });
    Ok(Sse::new(stream))
}
