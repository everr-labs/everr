use crate::domain::Event;
use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NotifyError {
    /// Worth retrying (timeout, connection error, 5xx).
    #[error("transient: {0}")]
    Transient(String),
    /// Not worth retrying (4xx, malformed target).
    #[error("permanent: {0}")]
    Permanent(String),
}

/// A batch of active events for one group, delivered as a single notification.
/// `events` is always non-empty; `group_key` is a human-readable group identity
/// (e.g. `"rule=…,severity=critical"`) included in rendered payloads.
#[derive(Debug, Clone)]
pub struct Notification {
    pub group_key: String,
    pub events: Vec<Event>,
}

impl Notification {
    /// Wrap a single event as a one-member notification (firehose / immediate path).
    pub fn single(ev: &Event) -> Self {
        Self {
            group_key: ev.instance_key.0.clone(),
            events: vec![ev.clone()],
        }
    }
}

/// A delivery channel. Each impl renders a `Notification` (one or more events) into
/// one channel-native message.
#[async_trait]
pub trait Notifier: Send + Sync {
    fn channel(&self) -> &'static str;
    /// Deliver `notif` to `target`. Classify failures as Transient vs Permanent.
    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError>;
}

/// The HTTP client shared in shape by all HTTP notifiers: a 10s overall timeout.
pub fn default_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("building reqwest client with timeout should not fail")
}

/// Classify a delivery response: 2xx ok; 4xx permanent; else transient.
pub fn classify_status(status: reqwest::StatusCode) -> Result<(), NotifyError> {
    if status.is_success() {
        Ok(())
    } else if status.is_client_error() {
        Err(NotifyError::Permanent(format!("status {status}")))
    } else {
        Err(NotifyError::Transient(format!("status {status}")))
    }
}

/// Like [`classify_status`], but for APIs whose 429 rate-limit is worth retrying:
/// 2xx ok; 429 transient; other 4xx permanent; else transient.
pub fn classify_status_429_transient(status: reqwest::StatusCode) -> Result<(), NotifyError> {
    if status.as_u16() == 429 {
        return Err(NotifyError::Transient("rate limited (429)".into()));
    }
    classify_status(status)
}

/// Generic webhook: POST `{group_key, events:[…]}` as JSON. 2xx = ok, 4xx = permanent,
/// else transient.
pub struct WebhookNotifier {
    http: reqwest::Client,
}

impl WebhookNotifier {
    pub fn new() -> Self {
        Self {
            http: default_http_client(),
        }
    }
}

impl Default for WebhookNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for WebhookNotifier {
    fn channel(&self) -> &'static str {
        "webhook"
    }

    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError> {
        let body = serde_json::json!({
            "group_key": notif.group_key,
            "events": notif.events,
        });
        let resp = self
            .http
            .post(target)
            .json(&body)
            .send()
            .await
            // Strip the URL: it is the secret delivery target and must not reach
            // notifications.last_error, the dead-letter stream, or logs.
            .map_err(|e| NotifyError::Transient(e.without_url().to_string()))?;
        classify_status(resp.status())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::event::{Event, EventStatus};
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(instance: &str) -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey(instance.into()),
            EventStatus::Firing,
            BTreeMap::new(),
            None,
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn notification_holds_group_key_and_events() {
        let n = Notification {
            group_key: "rule=r,severity=warning".into(),
            events: vec![ev("a"), ev("b")],
        };
        assert_eq!(n.group_key, "rule=r,severity=warning");
        assert_eq!(n.events.len(), 2);
    }
}
