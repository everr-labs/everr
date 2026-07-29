use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::{duplicate_entries, AppState};
use crate::domain::channel::{Channel, ChannelConfig};
use crate::stores::ChannelDelete;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
pub struct CreateChannel {
    pub name: String,
    /// The endpoint config (tagged union on `type`). Channels are the
    /// secret-bearing resource; receivers only reference them by name.
    pub config: ChannelConfig,
}

/// `PUT /v1/channels/:name` body: the config only, since the name comes from the path.
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
    validate_channel_config(config, allow_private_webhooks)
}

/// The config half of [`validate_channel`], without the name check. The draft
/// test path (`POST /v1/channel-tests`) validates a config that has no name
/// yet, and must run the identical guard rather than a lookalike.
fn validate_channel_config(
    config: &ChannelConfig,
    allow_private_webhooks: bool,
) -> Result<(), ApiError> {
    // Same SSRF guard as subscription webhooks: the dispatcher POSTs these URLs
    // from inside the deployment network (see `crate::api::webhook_url`). Both the
    // webhook and Slack variants carry a tenant-supplied URL the dispatcher fetches
    // (see `dispatcher::slack`), so both must pass the guard; Email/Telegram
    // deliver via fixed provider endpoints, not a caller-chosen URL.
    let url = match config {
        ChannelConfig::Webhook { url } | ChannelConfig::Slack { url } => Some(url),
        ChannelConfig::Email { .. } | ChannelConfig::Telegram { .. } => None,
    };
    if let Some(url) = url {
        crate::api::webhook_url::validate_webhook_url(url, allow_private_webhooks)
            .map_err(ApiError::Validation)?;
    }
    // A repeat within one config's recipient list is a caller mistake (a channel delivers to
    // an address once), so reject rather than dedupe. The same address across two channels is
    // legitimate and unaffected.
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
        // Single-URL configs have no list to repeat an entry in.
        ChannelConfig::Webhook { .. } | ChannelConfig::Slack { .. } => {}
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

/// Create a channel. Create-only: an existing name is a 409 `already_exists`, so a stored
/// config and its encrypted secret are never silently overwritten. Updates and secret
/// rotation go through `PUT /v1/channels/:name`. Returns the stored channel redacted.
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
        ChannelDelete::Deleted => crate::api::deleted(true),
        ChannelDelete::NotFound => Err(ApiError::NotFound),
        ChannelDelete::InUse(referrers) => Err(ApiError::Conflict(in_use_detail(&referrers))),
    }
}

/// Request body for `POST /v1/channel-tests`. No name: a draft has no identity
/// yet, and the test says nothing about whether the name is free.
#[derive(Deserialize)]
pub struct TestChannel {
    pub config: ChannelConfig,
}

/// Outcome of a draft channel test.
#[derive(Serialize)]
pub struct TestChannelResult {
    /// Whether the notification was delivered.
    pub ok: bool,
    /// Round-trip time of the delivery attempt.
    pub latency_ms: u64,
    /// The provider's own message when `ok` is false. Mostly caller-supplied:
    /// the caller sent the config, so an HTTP-channel failure (Slack, webhook)
    /// echoes only a status code it already gave us. Email is the exception:
    /// `dispatcher::email` maps every lettre error through `Display`, and the
    /// SMTP relay's own reply line rides along in it, so a caller can see a
    /// relay identity it never supplied. (Contrast rule SQL errors, which
    /// `span_error_summary` strips because they echo customer SQL into
    /// everr-internal sinks.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A channel test is synchronous and caller-triggered, so it needs a bound the
/// dispatcher's background delivery does not: a config carrying many recipients
/// fans out into that many sequential sends. Past this, the caller gets a
/// failed test rather than a request that holds a task open indefinitely.
const TEST_SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Send one synthetic notification through an unsaved channel config.
///
/// Nothing is stored and no instance row is created. A delivery failure is a
/// 200 with `ok: false`, not an error status: the request succeeded and the
/// delivery did not, and the builder wants to render why rather than a generic
/// failure. See `TestChannelResult::error` for how much of "why" survives.
pub async fn test(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TestChannel>,
) -> Result<Json<TestChannelResult>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_channel_config(&body.config, state.allow_private_webhooks)?;

    let kind = body.config.channel_name();
    let Some(notifier) = state.notifiers.get(kind) else {
        return Ok(Json(TestChannelResult {
            ok: false,
            latency_ms: 0,
            error: Some(format!("{kind} channel is not configured on this node")),
        }));
    };

    let notif =
        crate::api::test_notification::test_notification(&t, kind, time::OffsetDateTime::now_utc());
    let started = std::time::Instant::now();
    let outcome =
        tokio::time::timeout(TEST_SEND_TIMEOUT, notifier.send(&body.config, &notif)).await;
    let latency_ms = started.elapsed().as_millis() as u64;

    let (ok, error) = match outcome {
        Ok(Ok(())) => (true, None),
        Ok(Err(e)) => (false, Some(e.to_string())),
        Err(_) => (
            false,
            Some(format!("timed out after {}s", TEST_SEND_TIMEOUT.as_secs())),
        ),
    };
    tracing::info!(tenant = %t, channel = %kind, ok, latency_ms, "channel test sent");

    Ok(Json(TestChannelResult {
        ok,
        latency_ms,
        error,
    }))
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
        assert!(validate_channel(&b.name, &b.config, true).is_ok());
    }

    #[test]
    fn slack_config_gets_the_ssrf_guard() {
        // Slack URLs receive the same SSRF validation as webhooks.
        let b =
            body(r#"{"name":"chat","config":{"type":"slack","url":"http://169.254.169.254/x"}}"#);
        assert!(matches!(
            validate_channel(&b.name, &b.config, false),
            Err(ApiError::Validation(_))
        ));
        assert!(validate_channel(&b.name, &b.config, true).is_ok());
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
}

#[cfg(test)]
mod validate_tests {
    use super::*;

    #[test]
    fn config_validation_runs_without_a_name() {
        // The guard that matters (SSRF) applies to the config alone, so the
        // test path must reach it without inventing a name to satisfy a
        // signature.
        let ok = ChannelConfig::Slack {
            url: "https://hooks.slack.com/services/T/B/x".into(),
        };
        assert!(validate_channel_config(&ok, false).is_ok());

        let private = ChannelConfig::Webhook {
            url: "http://127.0.0.1:8080/hook".into(),
        };
        assert!(validate_channel_config(&private, false).is_err());
        assert!(validate_channel_config(&private, true).is_ok());
    }

    #[test]
    fn duplicate_recipients_are_still_rejected() {
        let dupes = ChannelConfig::Email {
            to: vec!["a@b.com".into(), "a@b.com".into()],
        };
        assert!(validate_channel_config(&dupes, false).is_err());
    }

    #[test]
    fn an_empty_name_is_still_rejected_by_the_full_check() {
        let ok = ChannelConfig::Email {
            to: vec!["a@b.com".into()],
        };
        assert!(validate_channel("", &ok, false).is_err());
        assert!(validate_channel("ops", &ok, false).is_ok());
    }
}
