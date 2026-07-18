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

/// Generic webhook: POST `{group_key, events:[…]}` as JSON. 2xx = ok, 4xx = permanent,
/// else transient.
pub struct WebhookNotifier {
    http: reqwest::Client,
}

impl WebhookNotifier {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("building reqwest client with timeout should not fail"),
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
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else if status.is_client_error() {
            Err(NotifyError::Permanent(format!("status {status}")))
        } else {
            Err(NotifyError::Transient(format!("status {status}")))
        }
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
        Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            slo: None,
            instance_key: InstanceKey(instance.into()),
            status: EventStatus::Firing,
            kind: crate::domain::event::EventKind::Alert,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        }
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
