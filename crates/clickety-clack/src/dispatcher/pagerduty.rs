use crate::dispatcher::notify::{
    classify_status_429_transient, default_http_client, Notification, Notifier, NotifyError,
};
use crate::domain::{Event, EventStatus};
use async_trait::async_trait;
use serde_json::{json, Value};

const DEFAULT_ENQUEUE_URL: &str = "https://events.pagerduty.com/v2/enqueue";

/// PagerDuty caps `payload.summary` at 1024 characters; longer summaries are rejected
/// with a 400 (a permanent, dead-lettering failure), so truncate defensively.
const PD_SUMMARY_MAX_CHARS: usize = 1024;

fn truncate_chars(s: String, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((idx, _)) => s[..idx].to_string(),
        None => s,
    }
}

/// Build a PagerDuty Events API v2 payload. Firing => `trigger`, Resolved => `resolve`.
/// `dedup_key` is the instance key so PagerDuty correlates a resolve with its trigger
/// and auto-closes the incident.
///
/// Alert annotations: the substituted `summary` drives `payload.summary`,
/// `description` goes into `custom_details`, and `link.alert` / `link.runbook` fill
/// the Events API v2 `links` array. JSON encoding is the only escaping PD needs.
pub fn build_pagerduty_payload(routing_key: &str, ev: &Event) -> Value {
    let action = match ev.status {
        EventStatus::Firing => "trigger",
        EventStatus::Resolved => "resolve",
    };
    let mut custom_details = serde_json::Map::new();
    for (k, v) in &ev.labels {
        custom_details.insert(k.clone(), json!(v));
    }
    if let Some(d) = crate::dispatcher::render::description(ev) {
        custom_details.insert("description".to_string(), json!(d));
    }
    let summary = truncate_chars(
        format!(
            "[{}] {}",
            ev.severity.as_str(),
            crate::dispatcher::render::headline(ev)
        ),
        PD_SUMMARY_MAX_CHARS,
    );
    let mut payload = json!({
        "routing_key": routing_key,
        "event_action": action,
        "dedup_key": ev.instance_key.0,
        "payload": {
            "summary": summary,
            "source": ev.instance_key.0,
            "severity": ev.severity.as_str(),
            "custom_details": custom_details,
        }
    });
    let mut links: Vec<Value> = Vec::new();
    if let Some(url) = crate::dispatcher::render::alert_link(ev) {
        links.push(json!({"href": url, "text": "View alert"}));
    }
    if let Some(url) = crate::dispatcher::render::runbook_link(ev) {
        links.push(json!({"href": url, "text": "View runbook"}));
    }
    if !links.is_empty() {
        payload["links"] = json!(links);
    }
    payload
}

/// PagerDuty Events API v2. `target` is the integration routing key. 2xx (PD returns
/// 202) ok; 429 transient; other 4xx permanent; else transient.
pub struct PagerDutyNotifier {
    http: reqwest::Client,
    base_url: String,
}

impl PagerDutyNotifier {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_ENQUEUE_URL)
    }

    /// For tests: point the enqueue POST at a stub server.
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: default_http_client(),
            base_url: base_url.to_string(),
        }
    }
}

impl Default for PagerDutyNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for PagerDutyNotifier {
    fn channel(&self) -> &'static str {
        "pagerduty"
    }

    async fn send(&self, target: &str, notif: &Notification) -> Result<(), NotifyError> {
        // PagerDuty incidents are keyed per-instance (dedup_key), so a batch is sent
        // as one Events-API call per event. PD's own dedup makes a batch-retry (which
        // may re-send already-delivered events) idempotent for both trigger and resolve.
        for ev in &notif.events {
            let resp = self
                .http
                .post(&self.base_url)
                .json(&build_pagerduty_payload(target, ev))
                .send()
                .await
                // base_url carries no secret, but strip the URL defensively so a
                // future change can't leak it into last_error/dead-letter/logs.
                .map_err(|e| NotifyError::Transient(e.without_url().to_string()))?;
            classify_status_429_transient(resp.status())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(status: EventStatus) -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("svc=api".into()),
            status,
            BTreeMap::new(),
            None,
            Severity::Critical,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn trigger_and_resolve_actions_and_dedup() {
        let f = build_pagerduty_payload("rk", &ev(EventStatus::Firing));
        assert_eq!(f["event_action"], "trigger");
        assert_eq!(f["dedup_key"], "svc=api");
        assert_eq!(f["routing_key"], "rk");
        assert_eq!(f["payload"]["severity"], "critical");
        let r = build_pagerduty_payload("rk", &ev(EventStatus::Resolved));
        assert_eq!(r["event_action"], "resolve");
    }

    #[test]
    fn summary_annotation_and_links_render_in_payload() {
        let mut e = ev(EventStatus::Firing);
        e.labels.insert("host".into(), "web-1".into());
        e.value = Some(3.0);
        e.annotations
            .insert("summary".into(), "Disk full on ${host}".into());
        e.annotations
            .insert("description".into(), "usage ${value}%".into());
        e.annotations
            .insert("link.alert".into(), "https://app/alerts/1".into());
        e.annotations
            .insert("link.runbook".into(), "https://wiki/rb".into());
        let v = build_pagerduty_payload("rk", &e);
        assert_eq!(v["payload"]["summary"], "[critical] Disk full on web-1");
        assert_eq!(v["payload"]["custom_details"]["host"], "web-1");
        assert_eq!(v["payload"]["custom_details"]["description"], "usage 3%");
        let links = v["links"].as_array().unwrap();
        assert_eq!(links[0]["href"], "https://app/alerts/1");
        assert_eq!(links[0]["text"], "View alert");
        assert_eq!(links[1]["href"], "https://wiki/rb");
        assert_eq!(links[1]["text"], "View runbook");
    }

    #[test]
    fn invalid_links_are_omitted_and_summary_is_capped() {
        let mut e = ev(EventStatus::Firing);
        e.annotations
            .insert("link.alert".into(), "not a url".into());
        e.annotations.insert("summary".into(), "x".repeat(5000));
        let v = build_pagerduty_payload("rk", &e);
        assert!(v.get("links").is_none(), "invalid link dropped");
        assert_eq!(
            v["payload"]["summary"].as_str().unwrap().chars().count(),
            1024
        );
    }
}
