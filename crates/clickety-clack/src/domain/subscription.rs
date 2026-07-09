use crate::domain::ids::TenantId;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// A firehose webhook subscription (the no-routing delivery fallback).
///
/// Serde note: this type's JSON form is API-only; internally it is persisted as typed
/// Postgres columns (with the URL encrypted), never as JSON, so the RFC 3339 encoding
/// has no rolling-upgrade or stored-data compatibility surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Subscription {
    pub id: Uuid,
    pub tenant: TenantId,
    pub webhook_url: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscription_created_at_serializes_rfc3339() {
        let s = Subscription {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            webhook_url: "https://example.com/hook".into(),
            created_at: OffsetDateTime::UNIX_EPOCH,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["created_at"], "1970-01-01T00:00:00Z");
        let back: Subscription = serde_json::from_value(v).unwrap();
        assert_eq!(back, s);
    }
}
