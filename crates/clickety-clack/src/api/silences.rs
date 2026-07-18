use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::routing::Matcher;
use crate::domain::silence::Silence;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateSilence {
    pub matchers: Vec<Matcher>,
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub ends_at: OffsetDateTime,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub author: String,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSilence>,
) -> Result<Json<Silence>, ApiError> {
    let t = tenant(&state, &headers)?;
    if body.ends_at <= body.starts_at {
        return Err(ApiError::Validation(
            "ends_at must be after starts_at".into(),
        ));
    }
    let s = state
        .store
        .create_silence(
            t,
            &body.matchers,
            body.starts_at,
            body.ends_at,
            &body.comment,
            &body.author,
        )
        .await?;
    Ok(Json(s))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let silences = state.store.list_silences(t).await?;
    Ok(Json(json!(silences)))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state.store.delete_silence(t, id).await?;
    if ok {
        Ok(Json(json!({"deleted": true})))
    } else {
        Err(ApiError::NotFound)
    }
}
