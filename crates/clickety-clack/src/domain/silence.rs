use crate::domain::ids::TenantId;
use crate::domain::routing::Matcher;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// A suppression window: while active, events whose labels match every matcher are dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Silence {
    pub id: Uuid,
    pub tenant: TenantId,
    pub matchers: Vec<Matcher>,
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub ends_at: OffsetDateTime,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub author: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl Silence {
    /// Active when `starts_at <= now < ends_at`.
    pub fn is_active(&self, now: OffsetDateTime) -> bool {
        self.starts_at <= now && now < self.ends_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::routing::{MatchOp, Matcher};
    use time::Duration;

    fn silence(start: OffsetDateTime, end: OffsetDateTime) -> Silence {
        Silence {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            matchers: vec![Matcher {
                label: "svc".into(),
                op: MatchOp::Eq,
                value: "api".into(),
            }],
            starts_at: start,
            ends_at: end,
            comment: "maint".into(),
            author: "ops".into(),
            created_at: start,
        }
    }

    #[test]
    fn active_window_is_start_inclusive_end_exclusive() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(now, now + Duration::seconds(10));
        assert!(s.is_active(now), "start is inclusive");
        assert!(s.is_active(now + Duration::seconds(9)));
        assert!(
            !s.is_active(now + Duration::seconds(10)),
            "end is exclusive"
        );
        assert!(!s.is_active(now - Duration::seconds(1)), "before start");
    }

    #[test]
    fn silence_roundtrips_json() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(now, now + Duration::seconds(10));
        let v = serde_json::to_value(&s).unwrap();
        let back: Silence = serde_json::from_value(v).unwrap();
        assert_eq!(back, s);
    }
}
