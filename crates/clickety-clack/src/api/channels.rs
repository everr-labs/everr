use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::channel::{Channel, ChannelConfig};
use crate::stores::ChannelDelete;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

fn tenant(state: &AppState, headers: &HeaderMap) -> Result<crate::domain::ids::TenantId, ApiError> {
    state
        .auth
        .tenant_from(headers)
        .ok_or(ApiError::Unauthorized)
}

#[derive(Deserialize)]
pub struct CreateChannel {
    pub name: String,
    /// The endpoint config (tagged union on `type`). Channels are the
    /// secret-bearing resource; receivers only reference them by name.
    pub config: ChannelConfig,
}

/// Boundary validation for channel creation, split from the handler so it is
/// unit-testable without an `AppState`.
fn validate_create(body: &CreateChannel, allow_private_webhooks: bool) -> Result<(), ApiError> {
    if body.name.trim().is_empty() {
        return Err(ApiError::Validation("name must not be empty".into()));
    }
    // Same SSRF guard as subscription webhooks: the dispatcher fetches these URLs
    // from inside the deployment network (see `crate::api::webhook_url`).
    if let ChannelConfig::Webhook { url } = &body.config {
        crate::api::webhook_url::validate_webhook_url(url, allow_private_webhooks)
            .map_err(ApiError::Validation)?;
    }
    // A repeated entry within a config's recipient list is always a caller
    // mistake (one channel delivers to an address once); reject it loudly
    // rather than silently deduping. This is strictly WITHIN one config:
    // overlapping membership across channels is legitimate by design.
    match &body.config {
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

/// Which values appear more than once in `values` (order-preserving, each
/// duplicate reported once). Same shape as the receiver API's
/// duplicate-channel-reference guard.
fn duplicate_entries(values: &[String]) -> Vec<String> {
    let mut dupes = Vec::new();
    for (i, v) in values.iter().enumerate() {
        if values[..i].contains(v) && !dupes.contains(v) {
            dupes.push(v.clone());
        }
    }
    dupes
}

/// The 409 detail for a delete blocked by referencing receivers.
fn in_use_detail(referrers: &[String]) -> String {
    format!(
        "channel is referenced by receivers: {}",
        referrers.join(", ")
    )
}

/// Create or replace a channel (upsert by name). Returns the stored channel redacted.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateChannel>,
) -> Result<Json<Channel>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_create(&body, state.allow_private_webhooks)?;
    let ch = state
        .store
        .create_channel(&*state.cipher, t, &body.name, &body.config)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(ch.redacted()))
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let channels = state
        .store
        .list_channels(&*state.cipher, t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let redacted: Vec<Channel> = channels.iter().map(Channel::redacted).collect();
    Ok(Json(json!(redacted)))
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
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
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
    match state
        .store
        .delete_channel(t, &name)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
    {
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
            validate_create(&b, true),
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
            validate_create(&b, false),
            Err(ApiError::Validation(_))
        ));
        // Same body allowed when private webhooks are enabled (dev/compose).
        assert!(validate_create(&b, true).is_ok());
    }

    #[test]
    fn non_webhook_configs_pass_validation() {
        let b = body(r#"{"name":"pd","config":{"type":"pagerduty","routing_key":"k"}}"#);
        assert!(validate_create(&b, false).is_ok());
        let b = body(r#"{"name":"chat","config":{"type":"slack","url":"https://hooks.slack/x"}}"#);
        assert!(validate_create(&b, false).is_ok());
    }

    #[test]
    fn duplicate_email_recipients_are_rejected_naming_each_once() {
        let b = body(
            r#"{"name":"mail","config":{"type":"email",
                "to":["a@x.test","b@x.test","a@x.test","b@x.test","a@x.test"]}}"#,
        );
        assert!(matches!(
            validate_create(&b, false),
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
            validate_create(&b, false),
            Err(ApiError::Validation(ref m)) if m == "duplicate telegram chat_ids: -100"
        ));
    }

    #[test]
    fn distinct_recipient_lists_pass_validation() {
        let b = body(r#"{"name":"mail","config":{"type":"email","to":["a@x.test","b@x.test"]}}"#);
        assert!(validate_create(&b, false).is_ok());
        let b = body(
            r#"{"name":"tg","config":{"type":"telegram","bot_token":"t",
                "chat_ids":["-100","@ops"]}}"#,
        );
        assert!(validate_create(&b, false).is_ok());
    }

    // Empty recipient lists keep their current behavior (accepted at this
    // boundary); the duplicate guard must not tighten anything else.
    #[test]
    fn empty_recipient_lists_still_pass_validation() {
        let b = body(r#"{"name":"mail","config":{"type":"email","to":[]}}"#);
        assert!(validate_create(&b, false).is_ok());
        let b = body(r#"{"name":"tg","config":{"type":"telegram","bot_token":"t","chat_ids":[]}}"#);
        assert!(validate_create(&b, false).is_ok());
    }

    #[test]
    fn in_use_detail_names_every_referrer() {
        assert_eq!(
            in_use_detail(&["oncall".to_string(), "ops".to_string()]),
            "channel is referenced by receivers: oncall, ops"
        );
    }
}
