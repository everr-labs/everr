use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::{duplicate_entries, AppState};
use crate::domain::receiver::Receiver;
use crate::stores::{ReceiverDelete, ReceiverWrite};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Deserialize)]
pub struct CreateReceiver {
    pub name: String,
    /// Names of the channels this receiver fans out to; at least one required and
    /// every name must exist as a channel. `#[serde(default)]` folds a missing
    /// field into the empty case so both get the same 422 validation message.
    #[serde(default)]
    pub channels: Vec<String>,
    /// Free-form metadata; upsert replaces the stored map. Absent = `{}`.
    #[serde(default)]
    pub annotations: BTreeMap<String, String>,
}

/// `PUT /v1/receivers/:name` body. The path names the receiver being addressed;
/// `name` in the body, when present and different, renames it. Routes target
/// receivers by id, so a rename never breaks them.
#[derive(Deserialize)]
pub struct UpdateReceiver {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub channels: Vec<String>,
    /// Free-form metadata; the upsert replaces the stored map. Absent = `{}`.
    #[serde(default)]
    pub annotations: BTreeMap<String, String>,
}

/// Boundary validation shared by create (POST) and upsert (PUT) (shape only;
/// referenced-channel existence is enforced inside the store's write
/// transaction). Split from the handlers so it is unit-testable without an
/// `AppState`.
fn validate_receiver(name: &str, channels: &[String]) -> Result<(), ApiError> {
    if name.trim().is_empty() {
        return Err(ApiError::Validation("name must not be empty".into()));
    }
    if channels.is_empty() {
        return Err(ApiError::Validation(
            "channels must contain at least one channel name".into(),
        ));
    }
    if channels.iter().any(|c| c.trim().is_empty()) {
        return Err(ApiError::Validation(
            "channel names must not be empty".into(),
        ));
    }
    // A repeated reference is always a caller mistake (a receiver delivers to a
    // channel once); reject it loudly rather than silently deduping.
    let dupes = duplicate_entries(channels);
    if !dupes.is_empty() {
        return Err(ApiError::Validation(duplicate_channels_detail(&dupes)));
    }
    Ok(())
}

/// The 422 detail for a channel referenced more than once.
fn duplicate_channels_detail(dupes: &[String]) -> String {
    format!("duplicate channels: {}", dupes.join(", "))
}

/// The 422 detail for references to channels that do not exist.
fn unknown_channels_detail(unknown: &[String]) -> String {
    format!("unknown channels: {}", unknown.join(", "))
}

/// The one status mapping for every receiver write outcome. `requested_name` is the
/// name the write tried to store under (the target name for a rename), which the
/// 409 detail names.
fn write_response(out: ReceiverWrite, requested_name: &str) -> Result<Json<Receiver>, ApiError> {
    match out {
        ReceiverWrite::Stored(rcv) => Ok(Json(rcv)),
        ReceiverWrite::NotFound => Err(ApiError::NotFound),
        ReceiverWrite::NameTaken => Err(ApiError::AlreadyExists(format!(
            "receiver {requested_name:?} already exists"
        ))),
        ReceiverWrite::MissingChannels(names) => {
            Err(ApiError::Validation(unknown_channels_detail(&names)))
        }
    }
}

/// Create a receiver. Create-only: an existing name is a 409 `already_exists`
/// (updates go through `PUT /v1/receivers/:name`). Every referenced channel must
/// exist (422 listing the unknown names otherwise). Returns the stored receiver;
/// receiver payloads carry channel names only, never secrets.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateReceiver>,
) -> Result<Json<Receiver>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_receiver(&body.name, &body.channels)?;
    let out = state
        .store
        .insert_receiver(t, &body.name, &body.channels, &body.annotations)
        .await?;
    write_response(out, &body.name)
}

/// Create or replace a receiver by name (upsert). Replaces the channel list and
/// the annotation map wholesale. A body `name` different from the path renames
/// the receiver instead; the rename is update-only (404 for an unknown source,
/// 409 `already_exists` for a taken target) so a typo in the path can't silently
/// create a receiver under the new name. Same channel validation as create.
pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<UpdateReceiver>,
) -> Result<Json<Receiver>, ApiError> {
    let t = tenant(&state, &headers)?;
    let new_name = body.name.as_deref().filter(|n| *n != name);
    validate_receiver(new_name.unwrap_or(&name), &body.channels)?;
    let out = match new_name {
        None => {
            state
                .store
                .create_receiver(t, &name, &body.channels, &body.annotations)
                .await?
        }
        Some(new_name) => {
            state
                .store
                .rename_receiver(t, &name, new_name, &body.channels, &body.annotations)
                .await?
        }
    };
    write_response(out, new_name.unwrap_or(&name))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Receiver>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let receivers = state.store.list_receivers(t).await?;
    Ok(Json(receivers))
}

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Receiver>, ApiError> {
    let t = tenant(&state, &headers)?;
    state
        .store
        .get_receiver(t, &name)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

/// Delete a receiver. `409 conflict` while any route still targets it: deleting would
/// leave the route pointing at nothing, silently dropping every alert it matches.
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    match state.store.delete_receiver(t, &name).await? {
        ReceiverDelete::Deleted => crate::api::deleted(true),
        ReceiverDelete::NotFound => Err(ApiError::NotFound),
        ReceiverDelete::InUse(routes) => Err(ApiError::Conflict(in_use_detail(&routes))),
    }
}

/// The 409 detail for a receiver still targeted by routes.
fn in_use_detail(routes: &[uuid::Uuid]) -> String {
    let ids: Vec<String> = routes.iter().map(|id| id.to_string()).collect();
    format!("receiver is referenced by routes: {}", ids.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(raw: &str) -> CreateReceiver {
        serde_json::from_str(raw).expect("body must deserialize")
    }

    #[test]
    fn missing_channels_field_deserializes_to_empty_and_fails_validation() {
        let b = body(r#"{"name":"ops"}"#);
        assert!(b.channels.is_empty());
        let err = validate_receiver(&b.name, &b.channels).unwrap_err();
        assert!(matches!(
            err,
            ApiError::Validation(ref m) if m == "channels must contain at least one channel name"
        ));
    }

    #[test]
    fn inline_channel_objects_are_not_accepted() {
        assert!(serde_json::from_str::<CreateReceiver>(
            r#"{"name":"ops","channels":[{"type":"webhook","url":"http://x/h"}]}"#
        )
        .is_err());
    }

    #[test]
    fn blank_channel_name_is_rejected() {
        let b = body(r#"{"name":"ops","channels":["team-slack","  "]}"#);
        assert!(matches!(
            validate_receiver(&b.name, &b.channels),
            Err(ApiError::Validation(ref m)) if m == "channel names must not be empty"
        ));
    }

    #[test]
    fn duplicate_channel_references_are_rejected_naming_each_once() {
        let b =
            body(r#"{"name":"ops","channels":["team-slack","pd","team-slack","pd","team-slack"]}"#);
        assert!(matches!(
            validate_receiver(&b.name, &b.channels),
            Err(ApiError::Validation(ref m)) if m == "duplicate channels: team-slack, pd"
        ));
    }

    #[test]
    fn empty_name_is_rejected_before_channels() {
        let b = body(r#"{"name":"  ","channels":["team-slack"]}"#);
        assert!(matches!(
            validate_receiver(&b.name, &b.channels),
            Err(ApiError::Validation(ref m)) if m == "name must not be empty"
        ));
    }
}
