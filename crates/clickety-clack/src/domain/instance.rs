use crate::domain::ids::{InstanceKey, SourceId, TenantId};
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
    /// Typed origin: rule instance or SLO burn-rate instance. Flattened so the
    /// API JSON keeps its `rule` field (plus `slo` for SLO rows); see [`SourceId`].
    #[serde(flatten)]
    pub source: SourceId,
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
        source: SourceId,
        tenant: TenantId,
        labels: BTreeMap<String, String>,
    ) -> Self {
        Self {
            key,
            source,
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
    use crate::domain::ids::{InstanceKey, RuleId, SloId, TenantId};
    use uuid::Uuid;

    /// Rule and SLO instances must retain their exact source variant on the wire.
    #[test]
    fn source_id_keeps_rule_key_and_marks_slo_rows() {
        let id = Uuid::new_v4();
        let mk = |source| {
            InstanceState::new_inactive(
                InstanceKey("k".into()),
                source,
                TenantId::from_trusted(Uuid::nil().to_string()),
                BTreeMap::new(),
            )
        };

        let rule = mk(SourceId::Rule(RuleId(id)));
        let v = serde_json::to_value(&rule).unwrap();
        assert_eq!(v["rule"], id.to_string());
        assert!(v.get("slo").is_none());
        assert_eq!(serde_json::from_value::<InstanceState>(v).unwrap(), rule);

        let slo = mk(SourceId::Slo(SloId(id)));
        let v = serde_json::to_value(&slo).unwrap();
        assert_eq!(v["rule"], id.to_string());
        assert_eq!(v["slo"], id.to_string());
        assert_eq!(serde_json::from_value::<InstanceState>(v).unwrap(), slo);
    }
}

/// A currently-firing alert instance, enriched with its rule's severity, used as the
/// inhibition source-set. `severity` is read from the rule (not stored on the instance row).
#[derive(Debug, Clone, PartialEq)]
pub struct FiringInstance {
    pub key: InstanceKey,
    pub source: SourceId,
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
    pub source: SourceId,
    pub tenant: TenantId,
    pub status: Status,
    pub labels: BTreeMap<String, String>,
    pub value: Option<f64>,
    pub severity: Severity,
    pub annotations: BTreeMap<String, String>,
    pub suppressed: bool,
    /// The owning rule's/SLO's first-class name, stamped onto the synthetic
    /// Resolved event so reconciled events still carry `alert.slug`.
    pub name: String,
}
