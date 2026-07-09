use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::instance::InstanceState;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<InstanceState>>, ApiError> {
    let t = state
        .auth
        .tenant_from(&headers)
        .ok_or(ApiError::Unauthorized)?;
    let alerts = state
        .store
        .list_alerts(t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(alerts))
}
