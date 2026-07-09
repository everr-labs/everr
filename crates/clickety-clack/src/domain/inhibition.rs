use crate::domain::ids::TenantId;
use crate::domain::routing::Matcher;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Suppress a target alert while a matching higher-priority source alert is firing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InhibitionRule {
    pub id: Uuid,
    pub tenant: TenantId,
    pub source_matchers: Vec<Matcher>,
    pub target_matchers: Vec<Matcher>,
    /// Label names that must hold equal values between source and target.
    #[serde(default)]
    pub equal: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::routing::{MatchOp, Matcher};

    #[test]
    fn inhibition_roundtrips_json() {
        let r = InhibitionRule {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            source_matchers: vec![Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            target_matchers: vec![Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "warning".into(),
            }],
            equal: vec!["instance".into()],
            created_at: OffsetDateTime::UNIX_EPOCH,
        };
        let v = serde_json::to_value(&r).unwrap();
        let back: InhibitionRule = serde_json::from_value(v).unwrap();
        assert_eq!(back, r);
    }
}
