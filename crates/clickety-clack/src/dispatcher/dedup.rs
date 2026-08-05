use crate::domain::channel::ChannelConfig;

/// Stable serialization used to hash a channel's secret delivery target.
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

/// A non-reversible delivery target safe for audit logs and telemetry.
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
