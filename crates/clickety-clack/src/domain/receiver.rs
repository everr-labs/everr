use crate::domain::ids::TenantId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

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

    // Older payloads default annotations to an empty map.
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

    // Inline channel objects must not silently become names.
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
