use crate::domain::ids::{InstanceKey, RuleId, TenantId};
use crate::domain::rule::Severity;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use time::OffsetDateTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Inactive,
    Pending,
    Firing,
}

/// Persisted state of one alert instance.
///
/// Serde note: this type's JSON form is API-only (`GET /v1/alerts`). Internally it is
/// persisted as typed Postgres columns, never as JSON, and it does not travel through
/// Redis streams — so the RFC 3339 timestamp encoding below has no rolling-upgrade or
/// stored-data compatibility surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InstanceState {
    pub key: InstanceKey,
    pub rule: RuleId,
    pub tenant: TenantId,
    pub status: Status,
    pub labels: BTreeMap<String, String>,
    pub value: Option<f64>,
    /// When the condition first became true (set on inactive->pending).
    #[serde(with = "time::serde::rfc3339::option")]
    pub active_since: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_seen: Option<OffsetDateTime>,
    /// Consecutive evaluations the row has been absent (for resolve_after).
    pub absent_count: u32,
}

impl InstanceState {
    pub fn new_inactive(
        key: InstanceKey,
        rule: RuleId,
        tenant: TenantId,
        labels: BTreeMap<String, String>,
    ) -> Self {
        Self {
            key,
            rule,
            tenant,
            status: Status::Inactive,
            labels,
            value: None,
            active_since: None,
            last_seen: None,
            absent_count: 0,
        }
    }
}

#[cfg(test)]
mod serde_tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use uuid::Uuid;

    #[test]
    fn instance_timestamps_serialize_rfc3339() {
        let s = InstanceState {
            key: InstanceKey("k".into()),
            rule: RuleId(Uuid::nil()),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            status: Status::Firing,
            labels: BTreeMap::new(),
            value: Some(1.0),
            active_since: Some(OffsetDateTime::UNIX_EPOCH),
            last_seen: Some(OffsetDateTime::UNIX_EPOCH),
            absent_count: 0,
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["active_since"], "1970-01-01T00:00:00Z");
        assert_eq!(v["last_seen"], "1970-01-01T00:00:00Z");
        let back: InstanceState = serde_json::from_value(v).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn instance_none_timestamps_serialize_null() {
        let s = InstanceState::new_inactive(
            InstanceKey("k".into()),
            RuleId(Uuid::nil()),
            TenantId::from_trusted(Uuid::nil().to_string()),
            BTreeMap::new(),
        );
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["active_since"], serde_json::Value::Null);
        assert_eq!(v["last_seen"], serde_json::Value::Null);
    }
}

/// A currently-firing alert instance, enriched with its rule's severity, used as the
/// inhibition source-set. `severity` is read from the rule (not stored on the instance row).
#[derive(Debug, Clone, PartialEq)]
pub struct FiringInstance {
    pub key: InstanceKey,
    pub rule: RuleId,
    pub severity: Severity,
    pub labels: BTreeMap<String, String>,
}

/// An instance that has gone stale (no recent evaluation) while still pending or firing,
/// enriched with its rule's severity + annotations so the reconciliation sweep can
/// synthesize a Resolved event. `severity`/`annotations`/`suppressed` are read from the
/// rule spec (`suppressed` so a preview rule's synthetic Resolved never notifies either).
#[derive(Debug, Clone, PartialEq)]
pub struct StaleInstance {
    pub key: InstanceKey,
    pub rule: RuleId,
    pub tenant: TenantId,
    pub status: Status,
    pub labels: BTreeMap<String, String>,
    pub value: Option<f64>,
    pub severity: Severity,
    pub annotations: BTreeMap<String, String>,
    pub suppressed: bool,
}
