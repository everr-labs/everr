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

impl EventStatus {
    /// The lowercase wire/label form, matching the serde `lowercase` rename.
    pub fn as_str(&self) -> &'static str {
        match self {
            EventStatus::Firing => "firing",
            EventStatus::Resolved => "resolved",
        }
    }
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

impl EventKind {
    /// The snake_case wire/label form, matching the serde `snake_case` rename.
    pub fn as_str(&self) -> &'static str {
        match self {
            EventKind::Alert => "alert",
            EventKind::RuleHealth => "rule_health",
        }
    }
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
    /// First-class name of the originating rule or SLO ("project/slug" for
    /// as-code resources). Serde-defaulted so pre-upgrade payloads (Redis
    /// streams, group buffers, outbox) still deserialize; empty = unknown.
    #[serde(default)]
    pub name: String,
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
    /// W3C traceparent of the evaluation span that emitted this event, for
    /// cross-process trace linking in the dispatcher. Serde-defaulted so
    /// pre-upgrade payloads (Redis streams, group buffers, outbox) still
    /// deserialize; None when engine telemetry is disabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceparent: Option<String>,
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
            name: String::new(),
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
            traceparent: None,
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
            name: String::new(),
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
            traceparent: None,
        }
    }

    /// Build an SLO-health event using the compatible rule-health wire kind.
    pub fn slo_health(
        tenant: TenantId,
        slo: crate::domain::ids::SloId,
        status: EventStatus,
        annotations: BTreeMap<String, String>,
        eval_ts: OffsetDateTime,
    ) -> Self {
        let mut ev = Self::rule_health(tenant, RuleId(slo.0), status, annotations, eval_ts);
        ev.slo = Some(slo);
        ev
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use uuid::Uuid;

    /// Older payloads must default the optional event fields.
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

    /// Payloads written before `slo` existed still deserialize.
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
        v.as_object_mut().unwrap().remove("slo");
        let back: Event = serde_json::from_value(v).unwrap();
        assert_eq!(back.slo, None);
    }

    #[test]
    fn traceparent_field_is_optional_and_round_trips() {
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
        // Pre-upgrade payload: no field present.
        let legacy = serde_json::to_value(&ev).unwrap();
        assert!(legacy.get("traceparent").is_none());
        let back: Event = serde_json::from_value(legacy).unwrap();
        assert_eq!(back.traceparent, None);
        // Stamped payload round-trips.
        ev.traceparent = Some("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01".into());
        let json = serde_json::to_value(&ev).unwrap();
        let back: Event = serde_json::from_value(json).unwrap();
        assert_eq!(ev.traceparent, back.traceparent);
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
