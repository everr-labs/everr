use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::{duplicate_entries, AppState};
use crate::domain::receiver::Receiver;
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

/// Boundary validation for receiver creation (shape only; referenced-channel
/// existence needs the store and lives in the handler). Split from the handler
/// so it is unit-testable without an `AppState`.
fn validate_create(body: &CreateReceiver) -> Result<(), ApiError> {
    if body.name.trim().is_empty() {
        return Err(ApiError::Validation("name must not be empty".into()));
    }
    if body.channels.is_empty() {
        return Err(ApiError::Validation(
            "channels must contain at least one channel name".into(),
        ));
    }
    if body.channels.iter().any(|c| c.trim().is_empty()) {
        return Err(ApiError::Validation(
            "channel names must not be empty".into(),
        ));
    }
    // A repeated reference is always a caller mistake (a receiver delivers to a
    // channel once); reject it loudly rather than silently deduping.
    let dupes = duplicate_entries(&body.channels);
    if !dupes.is_empty() {
        return Err(ApiError::Validation(duplicate_channels_detail(&dupes)));
    }
    Ok(())
}

/// The 422 detail for a channel referenced more than once.
fn duplicate_channels_detail(dupes: &[String]) -> String {
    format!("duplicate channels: {}", dupes.join(", "))
}

/// Which requested channel names are not in `existing` (order-preserving, deduped).
fn unknown_channels(requested: &[String], existing: &[String]) -> Vec<String> {
    let mut unknown = Vec::new();
    for name in requested {
        if !existing.contains(name) && !unknown.contains(name) {
            unknown.push(name.clone());
        }
    }
    unknown
}

/// The 422 detail for references to channels that do not exist.
fn unknown_channels_detail(unknown: &[String]) -> String {
    format!("unknown channels: {}", unknown.join(", "))
}

/// Create or replace a receiver (upsert by name). Every referenced channel must
/// exist (422 listing the unknown names otherwise). Returns the stored receiver;
/// receiver payloads carry channel names only, never secrets.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateReceiver>,
) -> Result<Json<Receiver>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_create(&body)?;
    let existing = state
        .store
        .existing_channel_names(&t, &body.channels)
        .await?;
    let unknown = unknown_channels(&body.channels, &existing);
    if !unknown.is_empty() {
        return Err(ApiError::Validation(unknown_channels_detail(&unknown)));
    }
    let rcv = state
        .store
        .create_receiver(t, &body.name, &body.channels, &body.annotations)
        .await?;
    Ok(Json(rcv))
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

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state.store.delete_receiver(t, &name).await?;
    crate::api::deleted(ok)
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
        let err = validate_create(&b).unwrap_err();
        assert!(matches!(
            err,
            ApiError::Validation(ref m) if m == "channels must contain at least one channel name"
        ));
    }

    #[test]
    fn empty_channels_list_is_rejected() {
        let b = body(r#"{"name":"ops","channels":[]}"#);
        let err = validate_create(&b).unwrap_err();
        assert!(matches!(
            err,
            ApiError::Validation(ref m) if m == "channels must contain at least one channel name"
        ));
    }

    #[test]
    fn inline_channel_objects_are_not_accepted() {
        // The pre-named-channels inline config shape no longer deserializes:
        // `channels` is a list of names now.
        assert!(serde_json::from_str::<CreateReceiver>(
            r#"{"name":"ops","channels":[{"type":"webhook","url":"http://x/h"}]}"#
        )
        .is_err());
    }

    #[test]
    fn blank_channel_name_is_rejected() {
        let b = body(r#"{"name":"ops","channels":["team-slack","  "]}"#);
        assert!(matches!(
            validate_create(&b),
            Err(ApiError::Validation(ref m)) if m == "channel names must not be empty"
        ));
    }

    #[test]
    fn multi_channel_body_passes_validation() {
        let b = body(r#"{"name":"ops","channels":["team-slack","ops-mail","pd"]}"#);
        assert_eq!(b.channels.len(), 3);
        assert!(validate_create(&b).is_ok());
    }

    #[test]
    fn duplicate_channel_references_are_rejected_naming_each_once() {
        let b =
            body(r#"{"name":"ops","channels":["team-slack","pd","team-slack","pd","team-slack"]}"#);
        assert!(matches!(
            validate_create(&b),
            Err(ApiError::Validation(ref m)) if m == "duplicate channels: team-slack, pd"
        ));
    }

    #[test]
    fn duplicate_channels_helper_is_order_preserving_and_deduped() {
        let names = vec![
            "a".to_string(),
            "b".to_string(),
            "a".to_string(),
            "c".to_string(),
            "b".to_string(),
            "a".to_string(),
        ];
        assert_eq!(
            duplicate_entries(&names),
            vec!["a".to_string(), "b".to_string()]
        );
        // No duplicates: nothing reported, validation passes.
        assert!(duplicate_entries(&["a".to_string(), "b".to_string()]).is_empty());
    }

    #[test]
    fn empty_name_is_rejected_before_channels() {
        let b = body(r#"{"name":"  ","channels":["team-slack"]}"#);
        assert!(matches!(
            validate_create(&b),
            Err(ApiError::Validation(ref m)) if m == "name must not be empty"
        ));
    }

    #[test]
    fn unknown_channels_lists_every_missing_name_once_in_order() {
        let requested = vec![
            "a".to_string(),
            "missing-2".to_string(),
            "b".to_string(),
            "missing-1".to_string(),
            "missing-2".to_string(),
        ];
        let existing = vec!["a".to_string(), "b".to_string()];
        let unknown = unknown_channels(&requested, &existing);
        assert_eq!(
            unknown,
            vec!["missing-2".to_string(), "missing-1".to_string()]
        );
        assert_eq!(
            unknown_channels_detail(&unknown),
            "unknown channels: missing-2, missing-1"
        );
    }

    #[test]
    fn all_known_channels_yield_no_unknowns() {
        let requested = vec!["a".to_string(), "b".to_string()];
        let existing = vec!["b".to_string(), "a".to_string()];
        assert!(unknown_channels(&requested, &existing).is_empty());
    }
}
