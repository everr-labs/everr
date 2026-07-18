use crate::api::auth::tenant;
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
    let t = tenant(&state, &headers)?;
    let alerts = state.store.list_alerts(t).await?;
    Ok(Json(alerts))
}
