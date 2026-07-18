use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::{duplicate_entries, AppState};
use crate::domain::channel::{Channel, ChannelConfig};
use crate::stores::ChannelDelete;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct CreateChannel {
    pub name: String,
    /// The endpoint config (tagged union on `type`). Channels are the
    /// secret-bearing resource; receivers only reference them by name.
    pub config: ChannelConfig,
}

/// `PUT /v1/channels/:name` body: the config only — the name comes from the path.
#[derive(Deserialize)]
pub struct UpdateChannel {
    pub config: ChannelConfig,
}

/// Boundary validation shared by create (POST) and upsert (PUT), split from the
/// handlers so it is unit-testable without an `AppState`.
fn validate_channel(
    name: &str,
    config: &ChannelConfig,
    allow_private_webhooks: bool,
) -> Result<(), ApiError> {
    if name.trim().is_empty() {
        return Err(ApiError::Validation("name must not be empty".into()));
    }
    // Same SSRF guard as subscription webhooks: the dispatcher fetches these URLs
    // from inside the deployment network (see `crate::api::webhook_url`).
    if let ChannelConfig::Webhook { url } = config {
        crate::api::webhook_url::validate_webhook_url(url, allow_private_webhooks)
            .map_err(ApiError::Validation)?;
    }
    // A repeated entry within a config's recipient list is always a caller
    // mistake (one channel delivers to an address once); reject it loudly
    // rather than silently deduping. This is strictly WITHIN one config:
    // overlapping membership across channels is legitimate by design.
    match config {
        ChannelConfig::Email { to } => {
            let dupes = duplicate_entries(to);
            if !dupes.is_empty() {
                return Err(ApiError::Validation(format!(
                    "duplicate email recipients: {}",
                    dupes.join(", ")
                )));
            }
        }
        ChannelConfig::Telegram { chat_ids, .. } => {
            let dupes = duplicate_entries(chat_ids);
            if !dupes.is_empty() {
                return Err(ApiError::Validation(format!(
                    "duplicate telegram chat_ids: {}",
                    dupes.join(", ")
                )));
            }
        }
        // Single-value configs (webhook/slack URL, pagerduty routing key) have
        // no list to repeat an entry in.
        ChannelConfig::Webhook { .. }
        | ChannelConfig::Slack { .. }
        | ChannelConfig::Pagerduty { .. } => {}
    }
    Ok(())
}

/// The 409 detail for a delete blocked by referencing receivers.
fn in_use_detail(referrers: &[String]) -> String {
    format!(
        "channel is referenced by receivers: {}",
        referrers.join(", ")
    )
}

/// Create a channel. Create-only: an existing name is a 409 `already_exists`
/// (the stored config — including its encrypted secret — is never silently
/// overwritten). Updates and secret rotation go through `PUT /v1/channels/:name`.
/// Returns the stored channel redacted.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateChannel>,
) -> Result<Json<Channel>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_channel(&body.name, &body.config, state.allow_private_webhooks)?;
    let ch = state
        .store
        .insert_channel(&*state.cipher, t, &body.name, &body.config)
        .await?
        .ok_or_else(|| {
            ApiError::AlreadyExists(format!("channel {:?} already exists", body.name))
        })?;
    Ok(Json(ch.redacted()))
}

/// Create or replace a channel by name (upsert; the secret-rotation path).
/// Replaces the stored config wholesale. Returns the stored channel redacted.
pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<UpdateChannel>,
) -> Result<Json<Channel>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_channel(&name, &body.config, state.allow_private_webhooks)?;
    let ch = state
        .store
        .create_channel(&*state.cipher, t, &name, &body.config)
        .await?;
    Ok(Json(ch.redacted()))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Channel>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let channels = state.store.list_channels(&*state.cipher, t).await?;
    let redacted: Vec<Channel> = channels.iter().map(Channel::redacted).collect();
    Ok(Json(redacted))
}

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Channel>, ApiError> {
    let t = tenant(&state, &headers)?;
    state
        .store
        .get_channel(&*state.cipher, t, &name)
        .await?
        .map(|ch| Json(ch.redacted()))
        .ok_or(ApiError::NotFound)
}

/// Delete a channel. Refused with a 409 (naming the referring receivers) while
/// any receiver still references it.
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    match state.store.delete_channel(t, &name).await? {
        ChannelDelete::Deleted => Ok(Json(json!({"deleted": true}))),
        ChannelDelete::NotFound => Err(ApiError::NotFound),
        ChannelDelete::InUse(referrers) => Err(ApiError::Conflict(in_use_detail(&referrers))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(raw: &str) -> CreateChannel {
        serde_json::from_str(raw).expect("body must deserialize")
    }

    #[test]
    fn empty_name_is_rejected() {
        let b = body(r#"{"name":"  ","config":{"type":"email","to":["a@x.test"]}}"#);
        assert!(matches!(
            validate_channel(&b.name, &b.config, true),
            Err(ApiError::Validation(ref m)) if m == "name must not be empty"
        ));
    }

    #[test]
    fn missing_config_fails_deserialization() {
        assert!(serde_json::from_str::<CreateChannel>(r#"{"name":"ops"}"#).is_err());
    }

    #[test]
    fn webhook_config_gets_the_ssrf_guard() {
        let b = body(r#"{"name":"hook","config":{"type":"webhook","url":"http://127.0.0.1/h"}}"#);
        assert!(matches!(
            validate_channel(&b.name, &b.config, false),
            Err(ApiError::Validation(_))
        ));
        // Same body allowed when private webhooks are enabled (dev/compose).
        assert!(validate_channel(&b.name, &b.config, true).is_ok());
    }

    #[test]
    fn non_webhook_configs_pass_validation() {
        let b = body(r#"{"name":"pd","config":{"type":"pagerduty","routing_key":"k"}}"#);
        assert!(validate_channel(&b.name, &b.config, false).is_ok());
        let b = body(r#"{"name":"chat","config":{"type":"slack","url":"https://hooks.slack/x"}}"#);
        assert!(validate_channel(&b.name, &b.config, false).is_ok());
    }

    #[test]
    fn duplicate_email_recipients_are_rejected_naming_each_once() {
        let b = body(
            r#"{"name":"mail","config":{"type":"email",
                "to":["a@x.test","b@x.test","a@x.test","b@x.test","a@x.test"]}}"#,
        );
        assert!(matches!(
            validate_channel(&b.name, &b.config, false),
            Err(ApiError::Validation(ref m)) if m == "duplicate email recipients: a@x.test, b@x.test"
        ));
    }

    #[test]
    fn duplicate_telegram_chat_ids_are_rejected() {
        let b = body(
            r#"{"name":"tg","config":{"type":"telegram","bot_token":"t",
                "chat_ids":["-100","@ops","-100"]}}"#,
        );
        assert!(matches!(
            validate_channel(&b.name, &b.config, false),
            Err(ApiError::Validation(ref m)) if m == "duplicate telegram chat_ids: -100"
        ));
    }

    #[test]
    fn distinct_recipient_lists_pass_validation() {
        let b = body(r#"{"name":"mail","config":{"type":"email","to":["a@x.test","b@x.test"]}}"#);
        assert!(validate_channel(&b.name, &b.config, false).is_ok());
        let b = body(
            r#"{"name":"tg","config":{"type":"telegram","bot_token":"t",
                "chat_ids":["-100","@ops"]}}"#,
        );
        assert!(validate_channel(&b.name, &b.config, false).is_ok());
    }

    // Empty recipient lists keep their current behavior (accepted at this
    // boundary); the duplicate guard must not tighten anything else.
    #[test]
    fn empty_recipient_lists_still_pass_validation() {
        let b = body(r#"{"name":"mail","config":{"type":"email","to":[]}}"#);
        assert!(validate_channel(&b.name, &b.config, false).is_ok());
        let b = body(r#"{"name":"tg","config":{"type":"telegram","bot_token":"t","chat_ids":[]}}"#);
        assert!(validate_channel(&b.name, &b.config, false).is_ok());
    }

    #[test]
    fn in_use_detail_names_every_referrer() {
        assert_eq!(
            in_use_detail(&["oncall".to_string(), "ops".to_string()]),
            "channel is referenced by receivers: oncall, ops"
        );
    }
}
