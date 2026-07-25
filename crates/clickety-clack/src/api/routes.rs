use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::routing::{Matcher, Route};
use crate::stores::{RouteCreate, RouteUpdate};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

/// Minimum accepted `repeat_interval_secs` (anything shorter is a paging loop, not a
/// reminder cadence).
const MIN_REPEAT_INTERVAL_SECS: u32 = 60;

#[derive(Deserialize)]
pub struct CreateRoute {
    pub matchers: Vec<Matcher>,
    pub receiver: String,
    #[serde(rename = "continue", default)]
    pub continue_matching: bool,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub group_by: Option<Vec<String>>,
    #[serde(default)]
    pub group_wait_secs: Option<u32>,
    #[serde(default)]
    pub group_interval_secs: Option<u32>,
    /// Absent/null = never re-notify a still-firing group (the historical behavior).
    #[serde(default)]
    pub repeat_interval_secs: Option<u32>,
}

/// Shared create/update validation (PUT replaces with the same rules as POST).
fn validate(body: &CreateRoute) -> Result<(), ApiError> {
    if body.receiver.trim().is_empty() {
        return Err(ApiError::Validation("receiver must not be empty".into()));
    }
    if let Some(r) = body.repeat_interval_secs {
        if r < MIN_REPEAT_INTERVAL_SECS {
            return Err(ApiError::Validation(format!(
                "repeat_interval_secs must be at least {MIN_REPEAT_INTERVAL_SECS}"
            )));
        }
    }
    Ok(())
}

/// The 422 detail for a route naming a receiver that does not exist.
fn unknown_receiver_detail(name: &str) -> String {
    format!("unknown receiver: {name}")
}

/// Create a route. The referenced receiver must already exist (422 naming it
/// otherwise); a receiver cannot be deleted while a route still targets it, so a stored
/// route always resolves to a receiver at delivery time.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateRoute>,
) -> Result<Json<Route>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate(&body)?;
    match state
        .store
        .create_route(
            t,
            &body.matchers,
            &body.receiver,
            body.continue_matching,
            body.priority,
            body.group_by.as_deref(),
            body.group_wait_secs,
            body.group_interval_secs,
            body.repeat_interval_secs,
        )
        .await?
    {
        RouteCreate::Created(route) => Ok(Json(route)),
        RouteCreate::MissingReceiver => Err(ApiError::Validation(unknown_receiver_detail(
            &body.receiver,
        ))),
    }
}

/// Replace a route in full (PUT semantics; same body shape and validation as create).
/// Unknown id, or another tenant's route, yields 404.
pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateRoute>,
) -> Result<Json<Route>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate(&body)?;
    match state
        .store
        .update_route(
            t,
            id,
            &body.matchers,
            &body.receiver,
            body.continue_matching,
            body.priority,
            body.group_by.as_deref(),
            body.group_wait_secs,
            body.group_interval_secs,
            body.repeat_interval_secs,
        )
        .await?
    {
        RouteUpdate::Updated(route) => Ok(Json(route)),
        RouteUpdate::NotFound => Err(ApiError::NotFound),
        RouteUpdate::MissingReceiver => Err(ApiError::Validation(unknown_receiver_detail(
            &body.receiver,
        ))),
    }
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Route>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let routes = state.store.routes_for(t).await?;
    Ok(Json(routes))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state.store.delete_route(t, id).await?;
    crate::api::deleted(ok)
}
