use crate::domain::ids::TenantId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A delivery channel binding. The secret-bearing variants (Slack, Telegram)
/// are redacted on API read via [`ChannelConfig::redacted`]. Email recipients
/// live here; the SMTP relay itself is process-level config held by the
/// EmailNotifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ChannelConfig {
    Webhook {
        url: String,
    },
    Slack {
        url: String,
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
            ChannelConfig::Email { .. } => "email",
            ChannelConfig::Telegram { .. } => "telegram",
        }
    }

    /// The single designation of which config fields hold secrets, consumed by
    /// both [`ChannelConfig::redacted`] (API masking) and the at-rest crypto
    /// codec ([`crate::crypto::encrypt_channel`]). Adding a variant or promoting
    /// a field to secret is exactly this one match arm (plus the enum itself);
    /// the exhaustive match forces the edit.
    pub fn secret_fields(&self) -> SecretFields {
        match self {
            // Webhook URLs can carry auth tokens, so they are encrypted at rest,
            // but the URL IS the user-facing config (shown in the channel list),
            // so it stays readable on API responses.
            ChannelConfig::Webhook { .. } => SecretFields {
                encrypted: &["url"],
                masked: &[],
            },
            ChannelConfig::Slack { .. } => SecretFields {
                encrypted: &["url"],
                masked: &["url"],
            },
            ChannelConfig::Email { .. } => SecretFields {
                encrypted: &[],
                masked: &[],
            },
            ChannelConfig::Telegram { .. } => SecretFields {
                encrypted: &["bot_token"],
                masked: &["bot_token"],
            },
        }
    }

    /// Mask secret fields for API responses (never echo secrets back). Rewrites
    /// the serde JSON form per [`ChannelConfig::secret_fields`], so a field is
    /// masked here iff the designation says so.
    pub fn redacted(&self) -> ChannelConfig {
        let masked = self.secret_fields().masked;
        if masked.is_empty() {
            return self.clone();
        }
        let mut v = serde_json::to_value(self)
            .expect("ChannelConfig serialization is infallible (string/array fields only)");
        for field in masked {
            v[field] = serde_json::Value::String(REDACTED.to_string());
        }
        serde_json::from_value(v)
            .expect("masking replaces string fields with a string; the variant still parses")
    }
}

/// The masked placeholder API responses return for secret fields.
const REDACTED: &str = "***";

/// A [`ChannelConfig`] variant's secret-field designation (see
/// [`ChannelConfig::secret_fields`]). Field names are the serde JSON keys.
#[derive(Debug, Clone, Copy)]
pub struct SecretFields {
    /// Fields stored as encryption envelopes at rest by the crypto codec. Every
    /// secret field must be a JSON string in the serde form.
    pub encrypted: &'static [&'static str],
    /// Fields masked to `"***"` on API read. A subset of `encrypted`; webhook
    /// URLs are the deliberate gap (encrypted at rest, readable on the API).
    pub masked: &'static [&'static str],
}

/// A named, reusable delivery channel. Channels are the secret-bearing endpoint
/// configs; receivers reference them by name (see [`crate::domain::Receiver`]),
/// so one Slack hook or Telegram bot can back any number of receivers and be
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
    fn channel_name_matches_notifier_registry_keys() {
        let s = ChannelConfig::Slack {
            url: "https://hooks.slack.test/abc".into(),
        };
        assert_eq!(s.channel_name(), "slack");

        let e = ChannelConfig::Email {
            to: vec!["a@x.test".into(), "b@x.test".into()],
        };
        assert_eq!(e.channel_name(), "email");
    }

    /// Every masked field is also encrypted at rest: API masking never hides a
    /// field the codec would store cleartext.
    #[test]
    fn masked_fields_are_a_subset_of_encrypted() {
        for ch in [
            ChannelConfig::Webhook { url: "u".into() },
            ChannelConfig::Slack { url: "u".into() },
            ChannelConfig::Email { to: vec![] },
            ChannelConfig::Telegram {
                bot_token: "t".into(),
                chat_ids: vec![],
            },
        ] {
            let sf = ch.secret_fields();
            for m in sf.masked {
                assert!(sf.encrypted.contains(m), "{m} masked but not encrypted");
            }
        }
    }

    #[test]
    fn redacted_masks_secrets_but_keeps_kind() {
        let sl = ChannelConfig::Slack {
            url: "https://hooks.slack.test/super-secret".into(),
        };
        match sl.redacted() {
            ChannelConfig::Slack { url } => assert_eq!(url, "***"),
            _ => panic!("kind changed"),
        }
        let wh = ChannelConfig::Webhook {
            url: "http://x.test/h".into(),
        };
        assert_eq!(wh.redacted(), wh);
    }

    #[test]
    fn telegram_channel_name_and_redaction() {
        let tg = ChannelConfig::Telegram {
            bot_token: "123:secret".into(),
            chat_ids: vec!["@chan".into(), "999".into()],
        };
        assert_eq!(tg.channel_name(), "telegram");
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
