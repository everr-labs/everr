use crate::domain::ids::TenantId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

// Channel configs used to be inlined in receivers; they are standalone named
// resources now (see `crate::domain::channel`). Re-exported here so existing
// `receiver::ChannelConfig` imports keep working.
pub use crate::domain::channel::ChannelConfig;

/// A named set of channel references. Receivers carry no secrets themselves:
/// each entry of `channels` is the NAME of a [`crate::domain::Channel`], which
/// holds the actual endpoint config.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receiver {
    pub id: Uuid,
    pub tenant: TenantId,
    pub name: String,
    /// Names of the channels this receiver fans out to. Always non-empty: the
    /// API rejects empty lists and validates every name against the tenant's
    /// channels; storage only ever holds validated receivers (migration 0014
    /// materialized pre-reference inline configs as named channels).
    pub channels: Vec<String>,
    /// Free-form metadata (team, escalation notes, dashboard links, ...). Not
    /// secret, never redacted. `#[serde(default)]` so payloads and rows written
    /// before the field existed read as an empty map.
    #[serde(default)]
    pub annotations: BTreeMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // A receiver serialized by a binary predating `annotations` must still
    // deserialize, defaulting to an empty map.
    #[test]
    fn receiver_without_annotations_deserializes_to_empty() {
        let legacy = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000000",
            "tenant": "00000000-0000-0000-0000-000000000000",
            "name": "ops",
            "channels": ["ops-webhook"]
        });
        let r: Receiver = serde_json::from_value(legacy).unwrap();
        assert!(r.annotations.is_empty());
        assert_eq!(r.channels, vec!["ops-webhook".to_string()]);
    }

    #[test]
    fn receiver_channel_names_round_trip_serde() {
        let r = Receiver {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            name: "multi".into(),
            channels: vec!["team-slack".into(), "ops-mail".into()],
            annotations: BTreeMap::from([("team".to_string(), "core".to_string())]),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["channels"][0], "team-slack");
        assert_eq!(v["channels"][1], "ops-mail");
        assert_eq!(v["annotations"]["team"], "core");
        let back: Receiver = serde_json::from_value(v).unwrap();
        assert_eq!(back, r);
    }

    // A receiver payload from before named channels (inline config objects) must
    // NOT silently deserialize into channel names.
    #[test]
    fn inline_channel_objects_do_not_deserialize_as_names() {
        let legacy = serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000000",
            "tenant": "00000000-0000-0000-0000-000000000000",
            "name": "ops",
            "channels": [{ "type": "webhook", "url": "http://x" }]
        });
        assert!(serde_json::from_value::<Receiver>(legacy).is_err());
    }
}
