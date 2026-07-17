use crate::domain::ids::{InstanceKey, RuleId, TenantId};
use crate::domain::rule::Severity;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use time::OffsetDateTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventStatus {
    Firing,
    Resolved,
}

/// Discriminates an operational rule-health notification from a data alert. Projected
/// into a `kind` routing label so operators route/silence health with normal matchers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    #[default]
    Alert,
    RuleHealth,
}

/// Emitted on a firing or resolved transition.
///
/// The three trailing fields (`suppressed`, `evidence`, `evidence_truncated`) are
/// serde-defaulted so payloads written before they existed (Redis streams, group buffers,
/// the Postgres outbox) still deserialize during a rolling upgrade.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub tenant: TenantId,
    pub rule: RuleId,
    /// Originating SLO, for burn-rate and SLO-health events. `rule` still carries
    /// the same uuid for wire compatibility with consumers that key on it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slo: Option<crate::domain::ids::SloId>,
    pub instance_key: InstanceKey,
    pub status: EventStatus,
    pub kind: EventKind,
    pub labels: BTreeMap<String, String>,
    pub value: Option<f64>,
    pub severity: Severity,
    pub annotations: BTreeMap<String, String>,
    #[serde(with = "time::serde::rfc3339")]
    pub eval_ts: OffsetDateTime,
    /// Mirrors the rule's `suppressed` flag at emit time. A suppressed event still flows
    /// through history/OTLP export but the dispatcher never notifies on it.
    #[serde(default)]
    pub suppressed: bool,
    /// Bounded source-row context for present instances: the row's columns excluding
    /// `label_columns` (the value column IS included). `None` for resolved-by-absence
    /// events, or when the evidence exceeded the byte cap (then `evidence_truncated`).
    #[serde(default)]
    pub evidence: Option<BTreeMap<String, serde_json::Value>>,
    /// True when evidence was cut down (column cap) or dropped entirely (byte cap).
    #[serde(default)]
    pub evidence_truncated: bool,
}

impl Event {
    /// Single constructor for all events. Used by the evaluator's state machine and by
    /// the reconciliation sweep so synthesized events cannot drift from real ones.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tenant: TenantId,
        rule: RuleId,
        instance_key: InstanceKey,
        status: EventStatus,
        labels: BTreeMap<String, String>,
        value: Option<f64>,
        severity: Severity,
        annotations: BTreeMap<String, String>,
        eval_ts: OffsetDateTime,
    ) -> Self {
        Self {
            tenant,
            rule,
            slo: None,
            instance_key,
            status,
            kind: EventKind::Alert,
            labels,
            value,
            severity,
            annotations,
            eval_ts,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        }
    }

    /// Build a rule-health event. Severity is fixed `Critical` (a blind rule is oncall-worthy
    /// regardless of its own severity); the instance key is the reserved per-rule health key,
    /// so degrade (`Firing`) and recover (`Resolved`) pair under dedup.
    pub fn rule_health(
        tenant: TenantId,
        rule: RuleId,
        status: EventStatus,
        annotations: BTreeMap<String, String>,
        eval_ts: OffsetDateTime,
    ) -> Self {
        Self {
            tenant,
            rule,
            slo: None,
            instance_key: InstanceKey::health(rule),
            status,
            kind: EventKind::RuleHealth,
            labels: BTreeMap::new(),
            value: None,
            severity: crate::domain::rule::Severity::Critical,
            annotations,
            eval_ts,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use uuid::Uuid;

    #[test]
    fn new_sets_all_fields() {
        let mut labels = BTreeMap::new();
        labels.insert("service".to_string(), "api".to_string());
        let ev = Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Resolved,
            labels.clone(),
            Some(1.0),
            Severity::Critical,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(ev.status, EventStatus::Resolved);
        assert_eq!(ev.severity, Severity::Critical);
        assert_eq!(ev.labels, labels);
        assert_eq!(ev.value, Some(1.0));
        assert_eq!(ev.tenant, TenantId::from_trusted(Uuid::nil().to_string()));
        assert_eq!(ev.rule, RuleId(Uuid::nil()));
        assert_eq!(ev.instance_key, InstanceKey("k".into()));
        assert_eq!(ev.annotations, BTreeMap::new());
        assert_eq!(ev.eval_ts, OffsetDateTime::UNIX_EPOCH);
    }

    #[test]
    fn event_kind_serde_roundtrip() {
        assert_eq!(
            serde_json::to_string(&EventKind::RuleHealth).unwrap(),
            "\"rule_health\""
        );
        assert_eq!(
            serde_json::from_str::<EventKind>("\"alert\"").unwrap(),
            EventKind::Alert
        );
    }

    /// Old-format payloads (outbox rows / Redis stream entries written before
    /// `suppressed`/`evidence`/`evidence_truncated` existed) must still deserialize,
    /// defaulting the new fields — the rolling-upgrade guarantee.
    #[test]
    fn old_format_event_without_new_fields_deserializes_with_defaults() {
        let v = serde_json::json!({
            "tenant": Uuid::nil().to_string(),
            "rule": Uuid::nil(),
            "instance_key": "k",
            "status": "firing",
            "kind": "alert",
            "labels": {"svc": "api"},
            "value": 1.5,
            "severity": "warning",
            "annotations": {},
            "eval_ts": "1970-01-01T00:00:00Z"
        });
        let ev: Event = serde_json::from_value(v).unwrap();
        assert!(!ev.suppressed);
        assert_eq!(ev.evidence, None);
        assert!(!ev.evidence_truncated);
    }

    #[test]
    fn suppressed_and_evidence_round_trip() {
        let mut ev = Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Firing,
            BTreeMap::new(),
            Some(1.0),
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        ev.suppressed = true;
        ev.evidence = Some(BTreeMap::from([(
            "errors".to_string(),
            serde_json::json!(42),
        )]));
        ev.evidence_truncated = true;
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["suppressed"], true);
        assert_eq!(v["evidence"]["errors"], 42);
        assert_eq!(v["evidence_truncated"], true);
        let back: Event = serde_json::from_value(v).unwrap();
        assert_eq!(back, ev);
    }

    /// Rolling-upgrade compat: payloads written before `slo` existed still deserialize,
    /// defaulting the field to `None`.
    #[test]
    fn old_format_event_without_slo_key_deserializes_to_none() {
        let ev = Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Firing,
            BTreeMap::new(),
            Some(1.0),
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        let mut v = serde_json::to_value(&ev).unwrap();
        assert!(
            v.get("slo").is_none(),
            "None slo must already be omitted by the serializer"
        );
        // Simulate an old wire payload explicitly (defense in depth: even if a future
        // change stops omitting it, a payload missing the key must still deserialize).
        v.as_object_mut().unwrap().remove("slo");
        let back: Event = serde_json::from_value(v).unwrap();
        assert_eq!(back.slo, None);
    }

    #[test]
    fn slo_round_trips_when_present() {
        use crate::domain::ids::SloId;
        let mut ev = Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Firing,
            BTreeMap::new(),
            Some(1.0),
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        let slo = SloId(Uuid::nil());
        ev.slo = Some(slo);
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["slo"], Uuid::nil().to_string());
        let back: Event = serde_json::from_value(v).unwrap();
        assert_eq!(back.slo, Some(slo));
        assert_eq!(back, ev);
    }

    #[test]
    fn slo_none_omits_key_from_serialized_json() {
        let ev = Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Firing,
            BTreeMap::new(),
            Some(1.0),
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(ev.slo, None);
        let v = serde_json::to_value(&ev).unwrap();
        assert!(!v.as_object().unwrap().contains_key("slo"));
    }

    #[test]
    fn rule_health_constructor_sets_kind_and_reserved_key() {
        use crate::domain::ids::RuleId;
        use uuid::Uuid;
        let rule = RuleId(Uuid::nil());
        let ev = Event::rule_health(
            TenantId::from_trusted(Uuid::nil().to_string()),
            rule,
            EventStatus::Firing,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(ev.kind, EventKind::RuleHealth);
        assert_eq!(ev.severity, Severity::Critical);
        assert_eq!(ev.instance_key, InstanceKey::health(rule));
        assert!(ev.labels.is_empty());
    }
}
