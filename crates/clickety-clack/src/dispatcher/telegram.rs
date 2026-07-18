use crate::dispatcher::notify::{
    classify_status_429_transient, config_mismatch, default_http_client, Notification, Notifier,
    NotifyError,
};
use crate::domain::channel::ChannelConfig;
use crate::domain::EventStatus;
use async_trait::async_trait;

const DEFAULT_API_BASE: &str = "https://api.telegram.org";

/// Render a Telegram message (HTML parse_mode) for one or more events. Mirrors slack.rs
/// in content: header line + per-event lines. Alert annotations: each event's line uses
/// its own substituted `summary` headline, `description` is an extra line, and
/// `link.alert` / `link.runbook` become `<a href>` links on a footer line.
pub fn build_telegram_message(notif: &Notification) -> String {
    let n = notif.events.len();
    let header = if n == 1 {
        let ev = &notif.events[0];
        let emoji = match ev.status {
            EventStatus::Firing => "\u{1F6A8}",  // rotating light
            EventStatus::Resolved => "\u{2705}", // check mark
        };
        format!(
            "{emoji} <b>[{}] {}</b> — {}",
            crate::dispatcher::render::status_word(ev),
            ev.severity.as_str(),
            html_escape(&crate::dispatcher::render::headline(ev))
        )
    } else {
        format!(
            "\u{1F6A8} <b>[{n} alerts]</b> {}",
            html_escape(&notif.group_key)
        )
    };
    let mut body = String::from(&header);
    for ev in &notif.events {
        body.push_str(&format!(
            "\n• <b>{}</b> {} — {}",
            crate::dispatcher::render::status_word(ev),
            ev.severity.as_str(),
            html_escape(&crate::dispatcher::render::headline(ev)),
        ));
        if let Some(d) = crate::dispatcher::render::description(ev) {
            body.push_str(&format!("\n   {}", html_escape(&d)));
        }
        for (k, v) in &ev.labels {
            body.push_str(&format!("\n   {}={}", html_escape(k), html_escape(v)));
        }
        let mut links: Vec<String> = Vec::new();
        if let Some(url) = crate::dispatcher::render::alert_link(ev) {
            links.push(format!(
                "<a href=\"{}\">View alert</a>",
                html_attr_escape(url)
            ));
        }
        if let Some(url) = crate::dispatcher::render::runbook_link(ev) {
            links.push(format!(
                "<a href=\"{}\">View runbook</a>",
                html_attr_escape(url)
            ));
        }
        if !links.is_empty() {
            body.push_str(&format!("\n   {}", links.join(" | ")));
        }
    }
    body
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Escaping for HTML attribute values (href): text escaping plus double quotes.
fn html_attr_escape(s: &str) -> String {
    html_escape(s).replace('"', "&quot;")
}

/// Telegram Bot API channel (`ChannelConfig::Telegram`). One `sendMessage` call
/// per chat id, sequential — chat lists are tiny. 2xx ok; 4xx permanent; else
/// (incl. 429) transient.
pub struct TelegramNotifier {
    http: reqwest::Client,
    api_base: String,
}

impl TelegramNotifier {
    pub fn new() -> Self {
        Self::with_api_base(DEFAULT_API_BASE)
    }
    /// For tests: point the Bot API at a stub server.
    pub fn with_api_base(api_base: &str) -> Self {
        Self {
            http: default_http_client(),
            api_base: api_base.to_string(),
        }
    }
}

impl Default for TelegramNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Notifier for TelegramNotifier {
    fn channel(&self) -> &'static str {
        "telegram"
    }

    async fn send(&self, config: &ChannelConfig, notif: &Notification) -> Result<(), NotifyError> {
        let ChannelConfig::Telegram {
            bot_token,
            chat_ids,
        } = config
        else {
            return Err(config_mismatch("telegram", config));
        };
        if chat_ids.is_empty() {
            return Err(NotifyError::Permanent("no chat_ids".into()));
        }
        let text = build_telegram_message(notif);
        // bot_token is a secret: it goes in the URL path, so strip URLs from any error.
        let url = format!("{}/bot{}/sendMessage", self.api_base, bot_token);
        for chat_id in chat_ids {
            let body = serde_json::json!({
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": true,
            });
            let resp = self
                .http
                .post(&url)
                .json(&body)
                .send()
                .await
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
    use crate::domain::Event;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev() -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("svc=api".into()),
            EventStatus::Firing,
            BTreeMap::from([("svc".to_string(), "api".to_string())]),
            None,
            Severity::Critical,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn message_has_status_severity_and_escapes_html() {
        let mut e = ev();
        e.labels.insert("note".into(), "a<b>&c".into());
        let msg = build_telegram_message(&Notification::single(&e));
        assert!(msg.contains("FIRING"));
        assert!(msg.contains("critical"));
        assert!(msg.contains("a&lt;b&gt;&amp;c"), "labels html-escaped");
    }

    #[test]
    fn summary_and_description_are_substituted_then_escaped() {
        let mut e = ev();
        e.labels.insert("note".into(), "x<y".into());
        e.value = Some(7.0);
        e.annotations.insert("summary".into(), "bad ${note}".into());
        e.annotations
            .insert("description".into(), "value is ${value}".into());
        let msg = build_telegram_message(&Notification::single(&e));
        assert!(
            msg.contains("bad x&lt;y"),
            "summary substituted then escaped: {msg}"
        );
        assert!(msg.contains("value is 7"), "description substituted: {msg}");
        assert!(
            !msg.contains("svc=api —"),
            "summary replaces the instance key headline"
        );
    }

    #[test]
    fn links_render_as_html_footer_with_escaped_href() {
        let mut e = ev();
        e.annotations
            .insert("link.alert".into(), "https://app/alerts?a=1&b=2".into());
        e.annotations
            .insert("link.runbook".into(), "https://wiki/rb".into());
        let msg = build_telegram_message(&Notification::single(&e));
        assert!(
            msg.contains("<a href=\"https://app/alerts?a=1&amp;b=2\">View alert</a>"),
            "href attr-escaped: {msg}"
        );
        assert!(msg.contains("<a href=\"https://wiki/rb\">View runbook</a>"));
    }

    #[test]
    fn invalid_link_annotations_are_omitted() {
        let mut e = ev();
        e.annotations
            .insert("link.alert".into(), "ftp://nope".into());
        let msg = build_telegram_message(&Notification::single(&e));
        assert!(!msg.contains("<a href"), "non-http link dropped: {msg}");
    }
}
