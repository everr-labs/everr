use crate::domain::channel::ChannelConfig;

/// Canonical serialization of a channel config's delivery target: a URL
/// (webhook/Slack/Discord), comma-joined recipients (email), or the
/// `{bot_token, chat_ids}` JSON (Telegram).
///
/// Hashing input only. [`redact_target`] keys on it; notifiers receive the typed
/// `ChannelConfig` and never see this string.
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

    #[test]
    fn redact_target_is_non_reversible_and_stable() {
        let a = redact_target("https://hooks.slack/SECRET");
        let b = redact_target("https://hooks.slack/SECRET");
        assert_eq!(a, b);
        assert!(!a.contains("SECRET"));
        assert_ne!(a, redact_target("https://hooks.slack/OTHER"));
    }
}
