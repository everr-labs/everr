use crate::dispatcher::notify::{
    classify_status, default_http_client, Notification, Notifier, NotifyError,
};
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

/// Slack incoming webhook. `target` is the Slack webhook URL. 2xx ok; 4xx permanent;
/// else transient.
pub struct SlackNotifier {
    http: reqwest::Client,
}

impl SlackNotifier {
    pub fn new() -> Self {
        Self {
            http: default_http_client(),
        }
    }
}

impl Default for SlackNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for SlackNotifier {
    fn channel(&self) -> &'static str {
        "slack"
    }

    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError> {
        let resp = self
            .http
            .post(target)
            .json(&build_slack_payload(notif))
            .send()
            .await
            // Strip the URL: it is the secret webhook target and must not reach
            // notifications.last_error, the dead-letter stream, or logs.
            .map_err(|e| NotifyError::Transient(e.without_url().to_string()))?;
        classify_status(resp.status())
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

    #[test]
    fn payload_carries_status_and_labels() {
        let ev = Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            slo: None,
            instance_key: InstanceKey("svc=api".into()),
            status: EventStatus::Firing,
            kind: crate::domain::event::EventKind::Alert,
            labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
            value: None,
            severity: Severity::Critical,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        };
        let v = build_slack_payload(&Notification::single(&ev));
        let text = v["text"].as_str().unwrap();
        assert!(text.contains("FIRING"));
        assert!(text.contains("critical"));
        assert!(text.contains("svc=api"));
        assert_eq!(v["attachments"][0]["color"], "#d00000");
    }

    #[test]
    fn batch_payload_summarizes_count() {
        let mk = |inst: &str| Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            slo: None,
            instance_key: InstanceKey(inst.into()),
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
        };
        let notif = Notification {
            group_key: "rule=r,severity=warning".into(),
            events: vec![mk("a"), mk("b")],
        };
        let v = build_slack_payload(&notif);
        assert!(v["text"].as_str().unwrap().contains("2 alerts"));
        assert_eq!(v["attachments"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn summary_annotation_drives_header_and_is_escaped_after_substitution() {
        let mut e = Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            slo: None,
            instance_key: InstanceKey("svc=api".into()),
            status: EventStatus::Firing,
            kind: crate::domain::event::EventKind::Alert,
            labels: BTreeMap::from([("svc".to_string(), "a<b&c".to_string())]),
            value: Some(42.0),
            severity: Severity::Critical,
            annotations: BTreeMap::from([
                (
                    "summary".to_string(),
                    "Errors on ${svc}: ${value}".to_string(),
                ),
                (
                    "description".to_string(),
                    "rate ${value} on ${svc}".to_string(),
                ),
            ]),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        };
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

        // Without a summary the header falls back to the instance key.
        e.annotations.clear();
        let v = build_slack_payload(&Notification::single(&e));
        assert!(v["text"].as_str().unwrap().contains("svc=api"));
        assert!(
            v["attachments"][0].get("text").is_none(),
            "no description => no text"
        );
    }

    #[test]
    fn link_annotations_become_action_buttons() {
        let e = Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            slo: None,
            instance_key: InstanceKey("svc=api".into()),
            status: EventStatus::Firing,
            kind: crate::domain::event::EventKind::Alert,
            labels: BTreeMap::new(),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::from([
                ("link.alert".to_string(), "https://app/alerts/1".to_string()),
                ("link.runbook".to_string(), "https://wiki/rb".to_string()),
            ]),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        };
        let v = build_slack_payload(&Notification::single(&e));
        let actions = v["attachments"][0]["actions"].as_array().unwrap();
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0]["text"], "View alert");
        assert_eq!(actions[0]["url"], "https://app/alerts/1");
        assert_eq!(actions[1]["text"], "View runbook");
        assert_eq!(actions[1]["url"], "https://wiki/rb");
    }

    #[test]
    fn batch_attachments_carry_each_events_summary() {
        let mk = |inst: &str, summary: &str| Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            slo: None,
            instance_key: InstanceKey(inst.into()),
            status: EventStatus::Firing,
            kind: crate::domain::event::EventKind::Alert,
            labels: BTreeMap::from([("host".to_string(), inst.to_string())]),
            value: None,
            severity: Severity::Warning,
            annotations: BTreeMap::from([("summary".to_string(), summary.to_string())]),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
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
