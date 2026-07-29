use crate::dispatcher::notify::{
    classify_status_429_transient, config_mismatch, webhook_http_client, Notification, Notifier,
    NotifyError,
};
use crate::domain::channel::ChannelConfig;
use crate::domain::EventStatus;
use async_trait::async_trait;
use serde_json::{json, Value};

/// Slack message-text escaping (`&`, `<`, `>` are Slack's mrkdwn control
/// characters). Applied AFTER template substitution so substituted label values
/// cannot inject markup.
fn slack_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Build a Slack incoming-webhook JSON payload for a notification (one or more events).
///
/// Alert annotations: the substituted `summary` drives the headline (header for a
/// single event, per-attachment line for a batch), `description` becomes the
/// attachment text, and `link.alert` / `link.runbook` become attachment action
/// buttons.
pub fn build_slack_payload(notif: &Notification) -> Value {
    let n = notif.events.len();
    let header = if n == 1 {
        let ev = &notif.events[0];
        let emoji = match ev.status {
            EventStatus::Firing => ":rotating_light:",
            EventStatus::Resolved => ":white_check_mark:",
        };
        format!(
            "{emoji} [{}] {} — {}",
            crate::dispatcher::render::status_word(ev),
            ev.severity.as_str(),
            slack_escape(&crate::dispatcher::render::headline(ev))
        )
    } else {
        format!(
            ":rotating_light: [{n} alerts] {}",
            slack_escape(&notif.group_key)
        )
    };
    let attachments: Vec<Value> = notif
        .events
        .iter()
        .map(|ev| {
            let mut fields: Vec<Value> = ev
                .labels
                .iter()
                .map(|(k, v)| json!({"title": k, "value": v, "short": true}))
                .collect();
            fields.push(
                json!({"title": "severity", "value": ev.severity.as_str(), "short": true}),
            );
            fields.push(json!({"title": "instance", "value": ev.instance_key.0, "short": true}));
            let mut attachment = json!({
                "color": match ev.status { EventStatus::Firing => "#d00000", EventStatus::Resolved => "#2eb886" },
                "fields": fields,
            });
            let mut text_lines: Vec<String> = Vec::new();
            if n > 1 {
                // Batch: the header only carries the group key, so each event's
                // own (substituted) headline goes on its attachment.
                text_lines.push(format!(
                    "*[{}] {}* — {}",
                    crate::dispatcher::render::status_word(ev),
                    ev.severity.as_str(),
                    slack_escape(&crate::dispatcher::render::headline(ev))
                ));
            }
            if let Some(d) = crate::dispatcher::render::description(ev) {
                text_lines.push(slack_escape(&d));
            }
            if !text_lines.is_empty() {
                attachment["text"] = json!(text_lines.join("\n"));
                attachment["mrkdwn_in"] = json!(["text"]);
            }
            let mut actions: Vec<Value> = Vec::new();
            if let Some(url) = crate::dispatcher::render::alert_link(ev) {
                actions.push(json!({"type": "button", "text": "View alert", "url": url}));
            }
            if let Some(url) = crate::dispatcher::render::runbook_link(ev) {
                actions.push(json!({"type": "button", "text": "View runbook", "url": url}));
            }
            if !actions.is_empty() {
                attachment["actions"] = json!(actions);
            }
            attachment
        })
        .collect();
    json!({ "text": header, "attachments": attachments })
}

/// Slack incoming webhook (`ChannelConfig::Slack`). 2xx ok; 4xx permanent;
/// else transient.
pub struct SlackNotifier {
    allow_private: bool,
}

impl SlackNotifier {
    pub fn new(allow_private: bool) -> Self {
        Self { allow_private }
    }
}

impl Default for SlackNotifier {
    fn default() -> Self {
        Self::new(false)
    }
}

#[async_trait]
impl Notifier for SlackNotifier {
    fn channel(&self) -> &'static str {
        "slack"
    }

    async fn send(&self, config: &ChannelConfig, notif: &Notification) -> Result<(), NotifyError> {
        let ChannelConfig::Slack { url } = config else {
            return Err(config_mismatch("slack", config));
        };
        let http = webhook_http_client(url, self.allow_private).await?;
        let resp = http
            .post(url)
            .json(&build_slack_payload(notif))
            .send()
            .await
            // Strip the URL: it is the secret webhook target and must not reach
            // notifications.last_error, the dead-letter stream, or logs.
            .map_err(|e| NotifyError::Transient(e.without_url().to_string()))?;
        // Slack webhooks rate-limit with 429: transient (retry), not permanent.
        classify_status_429_transient(resp.status())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use crate::domain::Event;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(inst: &str, severity: Severity) -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey(inst.into()),
            EventStatus::Firing,
            BTreeMap::new(),
            None,
            severity,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn summary_annotation_drives_header_and_is_escaped_after_substitution() {
        let mut e = ev("svc=api", Severity::Critical);
        e.labels = BTreeMap::from([("svc".to_string(), "a<b&c".to_string())]);
        e.value = Some(42.0);
        e.annotations = BTreeMap::from([
            (
                "summary".to_string(),
                "Errors on ${svc}: ${value}".to_string(),
            ),
            (
                "description".to_string(),
                "rate ${value} on ${svc}".to_string(),
            ),
        ]);
        let v = build_slack_payload(&Notification::single(&e));
        let text = v["text"].as_str().unwrap();
        assert!(
            text.contains("Errors on a&lt;b&amp;c: 42"),
            "substituted then Slack-escaped: {text}"
        );
        let att_text = v["attachments"][0]["text"].as_str().unwrap();
        assert!(
            att_text.contains("rate 42 on a&lt;b&amp;c"),
            "description line: {att_text}"
        );
    }

    #[test]
    fn link_annotations_become_action_buttons() {
        let mut e = ev("svc=api", Severity::Warning);
        e.annotations = BTreeMap::from([
            ("link.alert".to_string(), "https://app/alerts/1".to_string()),
            ("link.runbook".to_string(), "https://wiki/rb".to_string()),
        ]);
        let v = build_slack_payload(&Notification::single(&e));
        let actions = v["attachments"][0]["actions"].as_array().unwrap();
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0]["url"], "https://app/alerts/1");
        assert_eq!(actions[1]["url"], "https://wiki/rb");
    }

    #[test]
    fn batch_attachments_carry_each_events_summary() {
        let mk = |inst: &str, summary: &str| {
            let mut e = ev(inst, Severity::Warning);
            e.labels = BTreeMap::from([("host".to_string(), inst.to_string())]);
            e.annotations = BTreeMap::from([("summary".to_string(), summary.to_string())]);
            e
        };
        let notif = Notification {
            group_key: "rule=r,severity=warning".into(),
            events: vec![mk("a", "CPU on ${host}"), mk("b", "CPU on ${host}")],
        };
        let v = build_slack_payload(&notif);
        assert!(v["attachments"][0]["text"]
            .as_str()
            .unwrap()
            .contains("CPU on a"));
        assert!(v["attachments"][1]["text"]
            .as_str()
            .unwrap()
            .contains("CPU on b"));
    }
}
