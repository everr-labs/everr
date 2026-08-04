use crate::domain::ids::TenantId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A delivery channel binding. The secret-bearing variants (webhook, Slack,
/// Discord, Telegram) are redacted on API read via [`ChannelConfig::redacted`]. Email recipients
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
    Discord {
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
            ChannelConfig::Discord { .. } => "discord",
            ChannelConfig::Email { .. } => "email",
            ChannelConfig::Telegram { .. } => "telegram",
        }
    }

    /// The tenant-supplied URL the dispatcher itself fetches, if this variant
    /// carries one — the single designation the API's SSRF guard keys on.
    /// Email and Telegram deliver via fixed provider endpoints, not a
    /// caller-chosen URL, so they carry none. As with
    /// [`ChannelConfig::secret_fields`], the exhaustive match forces the edit
    /// when a variant is added.
    pub fn fetched_url(&self) -> Option<&str> {
        match self {
            ChannelConfig::Webhook { url }
            | ChannelConfig::Slack { url }
            | ChannelConfig::Discord { url } => Some(url),
            ChannelConfig::Email { .. } | ChannelConfig::Telegram { .. } => None,
        }
    }

    /// The single designation of which config fields hold secrets, consumed by
    /// both [`ChannelConfig::redacted`] (API masking) and the at-rest crypto
    /// codec ([`crate::crypto::encrypt_channel`]). Adding a variant or promoting
    /// a field to secret is exactly this one match arm (plus the enum itself);
    /// the exhaustive match forces the edit.
    pub fn secret_fields(&self) -> SecretFields {
        match self {
            ChannelConfig::Webhook { .. } => SecretFields {
                encrypted: &["url"],
                masked: &["url"],
            },
            ChannelConfig::Slack { .. } => SecretFields {
                encrypted: &["url"],
                masked: &["url"],
            },
            ChannelConfig::Discord { .. } => SecretFields {
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
    /// Fields masked to `"***"` on API read. A subset of `encrypted`.
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
            ChannelConfig::Discord { url: "u".into() },
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
        match wh.redacted() {
            ChannelConfig::Webhook { url } => assert_eq!(url, "***"),
            _ => panic!("kind changed"),
        }
        let dc = ChannelConfig::Discord {
            url: "https://discord.com/api/webhooks/1/secret".into(),
        };
        match dc.redacted() {
            ChannelConfig::Discord { url } => assert_eq!(url, "***"),
            _ => panic!("kind changed"),
        }
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
}
