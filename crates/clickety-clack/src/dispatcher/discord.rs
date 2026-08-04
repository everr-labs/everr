use crate::dispatcher::notify::{
    classify_status_429_transient, config_mismatch, webhook_http_client, Notification, Notifier,
    NotifyError,
};
use crate::dispatcher::render::truncate_chars;
use crate::domain::channel::ChannelConfig;
use crate::domain::{Event, EventStatus};
use async_trait::async_trait;
use serde_json::{json, Value};

/// Discord caps a message at 10 embeds; an 11th is a 400 (permanent), so a
/// grouped notification maps its overflow to a note in `content` instead.
const EMBED_LIMIT: usize = 10;
/// Discord's hard limit on `content` characters (400 above it).
const CONTENT_LIMIT: usize = 2000;
/// Discord's hard limit on an embed field value (400 above it).
const FIELD_VALUE_LIMIT: usize = 1024;
/// Discord's hard limit on fields per embed (400 above it).
const FIELDS_LIMIT: usize = 25;

/// Discord message-markdown escaping. A backslash before any punctuation
/// renders the literal character, so escaping is always safe; the set covers
/// the inline markup Discord parses anywhere in a line. Applied AFTER template
/// substitution so substituted label values cannot inject markup.
fn discord_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '*' | '_' | '~' | '`' | '|') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The bold status/severity/headline line, shared by the single-event
/// `content` and the per-embed lines of a batch.
fn headline_line(ev: &Event) -> String {
    format!(
        "**[{}] {}** — {}",
        crate::dispatcher::render::status_word(ev),
        ev.severity.as_str(),
        discord_escape(&crate::dispatcher::render::headline(ev))
    )
}

/// Build a Discord webhook JSON payload for a notification (one or more events).
/// Mirrors slack.rs in content: `content` carries the headline, one color-coded
/// embed per event carries labels and links. Alert annotations: the substituted
/// `summary` drives the headline, `description` becomes embed text, and
/// `link.alert` / `link.runbook` become markdown links (embeds allow them,
/// `content` does not).
pub fn build_discord_payload(notif: &Notification) -> Value {
    let n = notif.events.len();
    let content = if n == 1 {
        let ev = &notif.events[0];
        format!(
            "{} {}",
            crate::dispatcher::render::status_emoji(ev),
            headline_line(ev)
        )
    } else {
        let overflow = if n > EMBED_LIMIT {
            format!(" (first {EMBED_LIMIT} shown)")
        } else {
            String::new()
        };
        format!(
            "\u{1F6A8} **[{n} alerts]** {}{overflow}",
            discord_escape(&notif.group_key)
        )
    };
    let embeds: Vec<Value> = notif
        .events
        .iter()
        .take(EMBED_LIMIT)
        .map(|ev| {
            let mut fields: Vec<Value> = ev
                .labels
                .iter()
                // Leave room for the severity and instance fields below.
                .take(FIELDS_LIMIT - 2)
                .map(|(k, v)| {
                    json!({
                        "name": k,
                        "value": truncate_chars(v, FIELD_VALUE_LIMIT),
                        "inline": true,
                    })
                })
                .collect();
            fields.push(json!({"name": "severity", "value": ev.severity.as_str(), "inline": true}));
            fields.push(json!({
                "name": "instance",
                "value": truncate_chars(&ev.instance_key.0, FIELD_VALUE_LIMIT),
                "inline": true,
            }));
            let mut embed = json!({
                // Same red/green as slack.rs (#d00000 / #2eb886), as the
                // decimal RGB int Discord expects.
                "color": match ev.status {
                    EventStatus::Firing => 0xd0_0000,
                    EventStatus::Resolved => 0x2e_b886,
                },
                "fields": fields,
            });
            let mut text_lines: Vec<String> = Vec::new();
            if n > 1 {
                // Batch: `content` only carries the group key, so each event's
                // own (substituted) headline goes on its embed.
                text_lines.push(headline_line(ev));
            }
            if let Some(d) = crate::dispatcher::render::description(ev) {
                text_lines.push(discord_escape(&d));
            }
            let mut links: Vec<String> = Vec::new();
            if let Some(url) = crate::dispatcher::render::alert_link(ev) {
                links.push(format!("[View alert]({url})"));
            }
            if let Some(url) = crate::dispatcher::render::runbook_link(ev) {
                links.push(format!("[View runbook]({url})"));
            }
            if !links.is_empty() {
                text_lines.push(links.join(" · "));
            }
            if !text_lines.is_empty() {
                embed["description"] = json!(text_lines.join("\n"));
            }
            embed
        })
        .collect();
    json!({
        "content": truncate_chars(&content, CONTENT_LIMIT),
        "embeds": embeds,
    })
}

/// Discord incoming webhook (`ChannelConfig::Discord`). 2xx ok (delivery
/// answers 204); 4xx permanent; else transient. Discord rate-limits with 429:
/// transient (retry), not permanent.
pub struct DiscordNotifier {
    allow_private: bool,
}

impl DiscordNotifier {
    pub fn new(allow_private: bool) -> Self {
        Self { allow_private }
    }
}

#[async_trait]
impl Notifier for DiscordNotifier {
    fn channel(&self) -> &'static str {
        "discord"
    }

    async fn send(&self, config: &ChannelConfig, notif: &Notification) -> Result<(), NotifyError> {
        let ChannelConfig::Discord { url } = config else {
            return Err(config_mismatch("discord", config));
        };
        let http = webhook_http_client(url, self.allow_private).await?;
        let resp = http
            .post(url)
            .json(&build_discord_payload(notif))
            .send()
            .await
            // Strip the URL: it is the secret webhook target and must not reach
            // notifications.last_error, the dead-letter stream, or logs.
            .map_err(|e| NotifyError::Transient(e.without_url().to_string()))?;
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
    fn summary_annotation_drives_content_and_is_escaped_after_substitution() {
        let mut e = ev("svc=api", Severity::Critical);
        e.labels = BTreeMap::from([("svc".to_string(), "a*b_c".to_string())]);
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
        let v = build_discord_payload(&Notification::single(&e));
        let content = v["content"].as_str().unwrap();
        assert!(
            content.contains(r"Errors on a\*b\_c: 42"),
            "substituted then Discord-escaped: {content}"
        );
        let desc = v["embeds"][0]["description"].as_str().unwrap();
        assert!(
            desc.contains(r"rate 42 on a\*b\_c"),
            "description line: {desc}"
        );
    }

    #[test]
    fn link_annotations_become_markdown_links_in_the_embed() {
        let mut e = ev("svc=api", Severity::Warning);
        e.annotations = BTreeMap::from([
            ("link.alert".to_string(), "https://app/alerts/1".to_string()),
            ("link.runbook".to_string(), "https://wiki/rb".to_string()),
        ]);
        let v = build_discord_payload(&Notification::single(&e));
        let desc = v["embeds"][0]["description"].as_str().unwrap();
        assert!(desc.contains("[View alert](https://app/alerts/1)"));
        assert!(desc.contains("[View runbook](https://wiki/rb)"));
    }

    #[test]
    fn labels_become_inline_fields_with_severity_and_instance() {
        let mut e = ev("svc=api", Severity::Critical);
        e.labels = BTreeMap::from([("svc".to_string(), "api".to_string())]);
        let v = build_discord_payload(&Notification::single(&e));
        let fields = v["embeds"][0]["fields"].as_array().unwrap();
        assert_eq!(fields.len(), 3);
        assert_eq!(fields[0]["name"], "svc");
        assert_eq!(fields[1]["name"], "severity");
        assert_eq!(fields[2]["value"], "svc=api");
    }

    #[test]
    fn oversized_batch_is_capped_at_discords_embed_limit() {
        let events: Vec<Event> = (0..30)
            .map(|i| ev(&format!("svc=api-{i}"), Severity::Warning))
            .collect();
        let notif = Notification {
            group_key: "svc=api".into(),
            events,
        };
        let v = build_discord_payload(&notif);
        assert_eq!(v["embeds"].as_array().unwrap().len(), EMBED_LIMIT);
        let content = v["content"].as_str().unwrap();
        assert!(
            content.contains("[30 alerts]") && content.contains("first 10 shown"),
            "overflow noted in content: {content}"
        );
    }

    #[test]
    fn giant_values_stay_under_discords_hard_limits() {
        let mut e = ev("svc=api", Severity::Critical);
        e.annotations = BTreeMap::from([("summary".to_string(), "s".repeat(10_000))]);
        e.labels = BTreeMap::from([("path".to_string(), "x".repeat(5_000))]);
        for i in 0..40 {
            e.labels.insert(format!("l{i:02}"), "v".into());
        }
        let v = build_discord_payload(&Notification::single(&e));
        assert!(v["content"].as_str().unwrap().chars().count() <= CONTENT_LIMIT);
        let fields = v["embeds"][0]["fields"].as_array().unwrap();
        assert!(fields.len() <= FIELDS_LIMIT);
        for f in fields {
            assert!(f["value"].as_str().unwrap().chars().count() <= FIELD_VALUE_LIMIT);
        }
    }
}
