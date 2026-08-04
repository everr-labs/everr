use crate::domain::channel::ChannelConfig;
use crate::domain::Event;

/// Canonical serialization of a channel config's delivery target: a URL
/// (webhook/Slack/Discord), comma-joined recipients (email), or the
/// `{bot_token, chat_ids}` JSON (Telegram).
///
/// Hashing input ONLY — [`dedup_key`] and [`redact_target`] key on it; notifiers
/// receive the typed `ChannelConfig` and never see this string. Kept stable per
/// config so redeliveries hash identically.
pub fn canonical_target(config: &ChannelConfig) -> String {
    match config {
        ChannelConfig::Webhook { url } => url.clone(),
        ChannelConfig::Slack { url } => url.clone(),
        ChannelConfig::Discord { url } => url.clone(),
        ChannelConfig::Email { to } => to.join(","),
        ChannelConfig::Telegram {
            bot_token,
            chat_ids,
        } => serde_json::json!({ "bot_token": bot_token, "chat_ids": chat_ids }).to_string(),
    }
}

/// Stable dedup key for "this exact event delivered to this target on this channel".
/// Identical for redeliveries of the same firing/resolved transition to the same
/// (channel, target) (same tenant+channel+target+instance+status+eval_ts), so
/// at-least-once stream redelivery never produces a duplicate notification. A later,
/// distinct transition (different eval_ts) yields a different key and is delivered.
pub fn dedup_key(channel: &str, target: &str, ev: &Event) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(ev.tenant.as_str().as_bytes());
    h.update(b"\x00");
    h.update(channel.as_bytes());
    h.update(b"\x00");
    h.update(target.as_bytes());
    h.update(b"\x00");
    h.update(ev.instance_key.0.as_bytes());
    h.update(b"\x00");
    h.update(ev.status.as_str().as_bytes());
    h.update(b"\x00");
    h.update(ev.eval_ts.unix_timestamp_nanos().to_be_bytes());
    hex::encode(h.finalize())
}

/// A non-reversible stand-in for a secret delivery target, safe to persist in the
/// notification audit log and emit in logs. High-entropy targets (URLs, routing keys)
/// cannot be recovered from this digest.
pub fn redact_target(target: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("sha256:{}", hex::encode(Sha256::digest(target.as_bytes())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::event::{Event, EventStatus};
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::{Duration, OffsetDateTime};
    use uuid::Uuid;

    fn ev(status: EventStatus, ts: OffsetDateTime) -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            status,
            BTreeMap::new(),
            None,
            Severity::Warning,
            BTreeMap::new(),
            ts,
        )
    }

    fn t(s: i64) -> OffsetDateTime {
        OffsetDateTime::UNIX_EPOCH + Duration::seconds(s)
    }

    #[test]
    fn same_event_same_target_is_stable() {
        let a = dedup_key("webhook", "http://x", &ev(EventStatus::Firing, t(0)));
        let b = dedup_key("webhook", "http://x", &ev(EventStatus::Firing, t(0)));
        assert_eq!(a, b);
    }

    #[test]
    fn differs_by_target() {
        let a = dedup_key("webhook", "http://x", &ev(EventStatus::Firing, t(0)));
        let b = dedup_key("webhook", "http://y", &ev(EventStatus::Firing, t(0)));
        assert_ne!(a, b);
    }

    #[test]
    fn differs_by_status_and_time() {
        let fire = dedup_key("webhook", "http://x", &ev(EventStatus::Firing, t(0)));
        let resolve = dedup_key("webhook", "http://x", &ev(EventStatus::Resolved, t(0)));
        let later = dedup_key("webhook", "http://x", &ev(EventStatus::Firing, t(60)));
        assert_ne!(fire, resolve);
        assert_ne!(fire, later);
    }

    #[test]
    fn differs_by_channel() {
        let a = dedup_key("webhook", "http://x", &ev(EventStatus::Firing, t(0)));
        let b = dedup_key("slack", "http://x", &ev(EventStatus::Firing, t(0)));
        assert_ne!(a, b);
    }

    #[test]
    fn redact_target_is_non_reversible_and_stable() {
        let a = redact_target("https://hooks.slack/SECRET");
        let b = redact_target("https://hooks.slack/SECRET");
        assert_eq!(a, b);
        assert!(!a.contains("SECRET"));
        assert_ne!(a, redact_target("https://hooks.slack/OTHER"));
    }
}
