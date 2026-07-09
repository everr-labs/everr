use crate::domain::ids::TenantId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A delivery channel binding. The secret-bearing variants (Slack, PagerDuty,
/// Telegram) are redacted on API read via [`ChannelConfig::redacted`]. Email
/// recipients live here; the SMTP relay itself is process-level config held by
/// the EmailNotifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ChannelConfig {
    Webhook {
        url: String,
    },
    Slack {
        url: String,
    },
    Pagerduty {
        routing_key: String,
    },
    Email {
        to: Vec<String>,
    },
    Telegram {
        bot_token: String,
        chat_ids: Vec<String>,
    },
}

impl ChannelConfig {
    /// The notifier-registry key (matches `Notifier::channel()`).
    pub fn channel_name(&self) -> &'static str {
        match self {
            ChannelConfig::Webhook { .. } => "webhook",
            ChannelConfig::Slack { .. } => "slack",
            ChannelConfig::Pagerduty { .. } => "pagerduty",
            ChannelConfig::Email { .. } => "email",
            ChannelConfig::Telegram { .. } => "telegram",
        }
    }

    /// The per-channel destination string passed to `Notifier::send`:
    /// a URL (webhook/Slack), a routing key (PagerDuty), or comma-joined
    /// recipients (email).
    pub fn target(&self) -> String {
        match self {
            ChannelConfig::Webhook { url } => url.clone(),
            ChannelConfig::Slack { url } => url.clone(),
            ChannelConfig::Pagerduty { routing_key } => routing_key.clone(),
            ChannelConfig::Email { to } => to.join(","),
            ChannelConfig::Telegram {
                bot_token,
                chat_ids,
            } => serde_json::json!({ "bot_token": bot_token, "chat_ids": chat_ids }).to_string(),
        }
    }

    /// Mask secret fields for API responses (never echo secrets back).
    pub fn redacted(&self) -> ChannelConfig {
        match self {
            ChannelConfig::Webhook { url } => ChannelConfig::Webhook { url: url.clone() },
            ChannelConfig::Slack { .. } => ChannelConfig::Slack { url: "***".into() },
            ChannelConfig::Pagerduty { .. } => ChannelConfig::Pagerduty {
                routing_key: "***".into(),
            },
            ChannelConfig::Email { to } => ChannelConfig::Email { to: to.clone() },
            ChannelConfig::Telegram { chat_ids, .. } => ChannelConfig::Telegram {
                bot_token: "***".into(),
                chat_ids: chat_ids.clone(),
            },
        }
    }
}

/// A named, reusable delivery channel. Channels are the secret-bearing endpoint
/// configs; receivers reference them by name (see [`crate::domain::Receiver`]),
/// so one Slack hook or PagerDuty key can back any number of receivers and be
/// rotated in a single place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub id: Uuid,
    pub tenant: TenantId,
    /// Tenant-scoped unique name; the handle receivers reference.
    pub name: String,
    pub config: ChannelConfig,
}

impl Channel {
    /// Copy with config secrets masked, for API responses.
    pub fn redacted(&self) -> Channel {
        Channel {
            id: self.id,
            tenant: self.tenant.clone(),
            name: self.name.clone(),
            config: self.config.redacted(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_name_and_target() {
        let s = ChannelConfig::Slack {
            url: "https://hooks.slack.test/abc".into(),
        };
        assert_eq!(s.channel_name(), "slack");
        assert_eq!(s.target(), "https://hooks.slack.test/abc");

        let e = ChannelConfig::Email {
            to: vec!["a@x.test".into(), "b@x.test".into()],
        };
        assert_eq!(e.channel_name(), "email");
        assert_eq!(e.target(), "a@x.test,b@x.test");
    }

    #[test]
    fn redacted_masks_secrets_but_keeps_kind() {
        let pd = ChannelConfig::Pagerduty {
            routing_key: "super-secret".into(),
        };
        match pd.redacted() {
            ChannelConfig::Pagerduty { routing_key } => assert_eq!(routing_key, "***"),
            _ => panic!("kind changed"),
        }
        let wh = ChannelConfig::Webhook {
            url: "http://x.test/h".into(),
        };
        assert_eq!(wh.redacted(), wh);
    }

    #[test]
    fn telegram_channel_name_target_and_redaction() {
        let tg = ChannelConfig::Telegram {
            bot_token: "123:secret".into(),
            chat_ids: vec!["@chan".into(), "999".into()],
        };
        assert_eq!(tg.channel_name(), "telegram");
        let target = tg.target();
        let v: serde_json::Value = serde_json::from_str(&target).unwrap();
        assert_eq!(v["bot_token"], "123:secret");
        assert_eq!(v["chat_ids"][0], "@chan");
        match tg.redacted() {
            ChannelConfig::Telegram {
                bot_token,
                chat_ids,
            } => {
                assert_eq!(bot_token, "***");
                assert_eq!(chat_ids, vec!["@chan".to_string(), "999".to_string()]);
            }
            _ => panic!("kind changed"),
        }
    }

    #[test]
    fn telegram_serde_tagged() {
        let v = serde_json::to_value(ChannelConfig::Telegram {
            bot_token: "t".into(),
            chat_ids: vec!["1".into()],
        })
        .unwrap();
        assert_eq!(v["type"], "telegram");
        let back: ChannelConfig = serde_json::from_value(v).unwrap();
        assert!(matches!(back, ChannelConfig::Telegram { .. }));
    }

    #[test]
    fn serde_is_externally_tagged_by_type() {
        let v = serde_json::to_value(ChannelConfig::Webhook {
            url: "http://x".into(),
        })
        .unwrap();
        assert_eq!(v["type"], "webhook");
        assert_eq!(v["url"], "http://x");
        let back: ChannelConfig = serde_json::from_value(v).unwrap();
        assert_eq!(
            back,
            ChannelConfig::Webhook {
                url: "http://x".into()
            }
        );
    }

    #[test]
    fn named_channel_redaction_masks_config_only() {
        let ch = Channel {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            name: "team-slack".into(),
            config: ChannelConfig::Slack {
                url: "https://hooks.slack.test/SECRET".into(),
            },
        };
        let red = ch.redacted();
        assert_eq!(red.name, "team-slack");
        assert!(matches!(
            red.config,
            ChannelConfig::Slack { ref url } if url == "***"
        ));
    }

    #[test]
    fn named_channel_serde_round_trips_with_tagged_config() {
        let ch = Channel {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            name: "ops-mail".into(),
            config: ChannelConfig::Email {
                to: vec!["ops@x.test".into()],
            },
        };
        let v = serde_json::to_value(&ch).unwrap();
        assert_eq!(v["name"], "ops-mail");
        assert_eq!(v["config"]["type"], "email");
        let back: Channel = serde_json::from_value(v).unwrap();
        assert_eq!(back, ch);
    }
}
