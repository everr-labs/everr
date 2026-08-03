use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::inhibition::InhibitionRule;
use crate::domain::routing::Matcher;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateInhibition {
    pub source_matchers: Vec<Matcher>,
    pub target_matchers: Vec<Matcher>,
    #[serde(default)]
    pub equal: Vec<String>,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateInhibition>,
) -> Result<Json<InhibitionRule>, ApiError> {
    let t = tenant(&state, &headers)?;
    let r = state
        .store
        .create_inhibition(t, &body.source_matchers, &body.target_matchers, &body.equal)
        .await?;
    Ok(Json(r))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<InhibitionRule>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let rules = state.store.list_inhibitions(t).await?;
    Ok(Json(rules))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state.store.delete_inhibition(t, id).await?;
    crate::api::deleted(ok)
}
