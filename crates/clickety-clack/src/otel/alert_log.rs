//! Builds OTLP `LogRecord`s that mirror the everr `app.alert_events` -> `app.logs`
//! materialized view exactly, so existing `app.logs` / `everr cloud query` queries keep
//! working after the cutover.
//!
//! Fixed shape (locked cross-plan contract):
//!   ServiceName = "alert"            (resource attribute "service.name")
//!   ScopeName   = "everr.alerting"   (InstrumentationScope.name)
//!   EventName   = "alert.<slug>.<event_type>"  (LogRecord.event_name)
//!   Body        = "alert <slug> <event_type>"
//! plus log-record attributes alert.slug / alert.event_type / alert.severity /
//! alert.delivery_targets / alert.silence_id / alert.silenced /
//! alert.instance_fingerprint / alert.instance_labels / alert.suppressed /
//! alert.evidence_json / alert.evidence_truncated / alert.row_count.
//!
//! `alert.suppressed` ("true"/"false") is always present. `alert.evidence_json` (compact
//! JSON of the event's evidence map) is emitted only when the event carries evidence, and
//! `alert.evidence_truncated` ("true") only when the evidence was truncated/dropped.

use crate::domain::Event;
use opentelemetry_proto::tonic::common::v1::{any_value, AnyValue, KeyValue};
use opentelemetry_proto::tonic::logs::v1::LogRecord;

pub const SERVICE_NAME: &str = "alert";
pub const SCOPE_NAME: &str = "everr.alerting";

/// Event-type discriminants matching the MV's `event_type` column. Vocabulary is locked by
/// the cross-plan contract: {instance_fired, instance_resolved, rule_health, delivery, silenced}.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertEventType {
    InstanceFired,
    InstanceResolved,
    RuleHealth,
    Delivery,
    Silenced,
}

impl AlertEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            AlertEventType::InstanceFired => "instance_fired",
            AlertEventType::InstanceResolved => "instance_resolved",
            AlertEventType::RuleHealth => "rule_health",
            AlertEventType::Delivery => "delivery",
            AlertEventType::Silenced => "silenced",
        }
    }
}

/// Everything a single alert log record carries beyond the base event.
#[derive(Debug, Clone, Default)]
pub struct LogExtras {
    pub delivery_targets: Vec<String>,
    pub silence_id: Option<String>,
    pub silenced: Option<bool>,
}

fn s(v: &str) -> AnyValue {
    AnyValue {
        value: Some(any_value::Value::StringValue(v.to_string())),
    }
}
fn b(v: bool) -> AnyValue {
    AnyValue {
        value: Some(any_value::Value::BoolValue(v)),
    }
}
fn i(v: i64) -> AnyValue {
    AnyValue {
        value: Some(any_value::Value::IntValue(v)),
    }
}
fn kv(k: &str, v: AnyValue) -> KeyValue {
    KeyValue {
        key: k.to_string(),
        value: Some(v),
    }
}

/// Resolve the slug: the first-class rule/SLO name, falling back to the rule id
/// for pre-upgrade events whose payload predates the field.
pub fn slug_for(ev: &Event) -> String {
    if !ev.name.is_empty() {
        return ev.name.clone();
    }
    ev.rule.0.to_string()
}

/// Build one OTLP `LogRecord` for an alert event of `etype`. `time_unix_nano` is
/// `ev.eval_ts` (transition path) or now (dispatcher path).
pub fn build_log_record(
    ev: &Event,
    etype: AlertEventType,
    extras: &LogExtras,
    time_unix_nano: u64,
) -> LogRecord {
    let slug = slug_for(ev);
    let event_type = etype.as_str();
    let labels_json = serde_json::to_string(&ev.labels).unwrap_or_else(|_| "{}".into());
    let row_count = 1i64; // each record is a single instance-level row

    let mut attrs = vec![
        kv("alert.slug", s(&slug)),
        kv("alert.event_type", s(event_type)),
        // Lowercase wire form ("info"/"warning"/"critical"); the frontend's event
        // history reads it as LogAttributes['alert.severity'].
        kv("alert.severity", s(ev.severity.as_str())),
        kv("alert.instance_fingerprint", s(&ev.instance_key.0)),
        kv("alert.instance_labels", s(&labels_json)),
        kv(
            "alert.suppressed",
            s(if ev.suppressed { "true" } else { "false" }),
        ),
        kv("alert.row_count", i(row_count)),
    ];
    if let Some(evidence) = &ev.evidence {
        let evidence_json = serde_json::to_string(evidence).unwrap_or_else(|_| "{}".into());
        attrs.push(kv("alert.evidence_json", s(&evidence_json)));
    }
    if ev.evidence_truncated {
        attrs.push(kv("alert.evidence_truncated", s("true")));
    }
    if !extras.delivery_targets.is_empty() {
        attrs.push(kv(
            "alert.delivery_targets",
            s(&extras.delivery_targets.join(",")),
        ));
    }
    if let Some(sid) = &extras.silence_id {
        attrs.push(kv("alert.silence_id", s(sid)));
    }
    if let Some(silenced) = extras.silenced {
        attrs.push(kv("alert.silenced", b(silenced)));
    }

    LogRecord {
        time_unix_nano,
        observed_time_unix_nano: time_unix_nano,
        severity_number: 9, // INFO
        severity_text: "INFO".into(),
        event_name: format!("alert.{slug}.{event_type}"),
        body: Some(s(&format!("alert {slug} {event_type}"))),
        attributes: attrs,
        dropped_attributes_count: 0,
        flags: 0,
        trace_id: vec![],
        span_id: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::event::{EventKind, EventStatus};
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;
    use uuid::Uuid;

    fn ev() -> Event {
        Event {
            tenant: TenantId::from_trusted("tenant-1".to_string()),
            rule: RuleId(Uuid::nil()),
            slo: None,
            name: "my-slug".to_string(),
            instance_key: InstanceKey("fp123".into()),
            status: EventStatus::Firing,
            kind: EventKind::Alert,
            labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
            value: Some(42.0),
            severity: Severity::Critical,
            annotations: BTreeMap::new(),
            eval_ts: time::OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
            traceparent: None,
        }
    }

    #[test]
    fn record_mirrors_mv_shape() {
        let rec = build_log_record(
            &ev(),
            AlertEventType::InstanceFired,
            &LogExtras::default(),
            0,
        );
        assert_eq!(rec.event_name, "alert.my-slug.instance_fired");
        let body = match rec.body.unwrap().value.unwrap() {
            any_value::Value::StringValue(s) => s,
            _ => panic!(),
        };
        assert_eq!(body, "alert my-slug instance_fired");
        let get = |k: &str| {
            rec.attributes
                .iter()
                .find(|a| a.key == k)
                .map(|a| a.value.clone().unwrap())
        };
        assert!(get("alert.slug").is_some());
        assert!(get("alert.event_type").is_some());
        assert!(get("alert.severity").is_some());
        assert!(get("alert.instance_fingerprint").is_some());
        assert!(get("alert.instance_labels").is_some());
        assert!(get("alert.suppressed").is_some());
        assert!(get("alert.row_count").is_some());
        assert!(
            get("alert.evidence_json").is_none(),
            "no evidence on the event -> no evidence_json attribute"
        );
        assert!(get("alert.evidence_truncated").is_none());
        match get("alert.event_type").unwrap().value.unwrap() {
            any_value::Value::StringValue(s) => assert_eq!(s, "instance_fired"),
            _ => panic!(),
        }
        match get("alert.instance_fingerprint").unwrap().value.unwrap() {
            any_value::Value::StringValue(s) => assert_eq!(s, "fp123"),
            _ => panic!(),
        }
        match get("alert.row_count").unwrap().value.unwrap() {
            any_value::Value::IntValue(n) => assert_eq!(n, 1),
            _ => panic!(),
        }
    }

    #[test]
    fn row_count_is_one_regardless_of_value() {
        let row_count = |e: &Event| {
            let rec = build_log_record(e, AlertEventType::InstanceFired, &LogExtras::default(), 0);
            match rec
                .attributes
                .iter()
                .find(|a| a.key == "alert.row_count")
                .unwrap()
                .value
                .clone()
                .unwrap()
                .value
                .unwrap()
            {
                any_value::Value::IntValue(n) => n,
                _ => panic!("row_count not an int"),
            }
        };

        let mut some = ev();
        some.value = Some(42.0);
        assert_eq!(row_count(&some), 1);

        let mut zero = ev();
        zero.value = Some(0.0);
        assert_eq!(row_count(&zero), 1);

        let mut none = ev();
        none.value = None;
        assert_eq!(row_count(&none), 1);
    }

    #[test]
    fn slug_prefers_first_class_name() {
        let mut ev = ev();
        ev.name = "default/api-errors".to_string();
        assert_eq!(slug_for(&ev), "default/api-errors");
        ev.name = String::new();
        assert_eq!(slug_for(&ev), ev.rule.0.to_string());
    }

    #[test]
    fn dispatcher_extras_emitted() {
        let extras = LogExtras {
            delivery_targets: vec![
                "everr-default-email".into(),
                "everr-default-telegram".into(),
            ],
            silence_id: Some("sil-1".into()),
            silenced: Some(true),
        };
        let rec = build_log_record(&ev(), AlertEventType::Delivery, &extras, 0);
        let dt = rec
            .attributes
            .iter()
            .find(|a| a.key == "alert.delivery_targets")
            .unwrap();
        match dt.value.clone().unwrap().value.unwrap() {
            any_value::Value::StringValue(s) => {
                assert!(s.contains("everr-default-email") && s.contains("everr-default-telegram"))
            }
            _ => panic!(),
        }
        assert!(rec.attributes.iter().any(|a| a.key == "alert.silence_id"));
        let silenced = rec
            .attributes
            .iter()
            .find(|a| a.key == "alert.silenced")
            .unwrap();
        match silenced.value.clone().unwrap().value.unwrap() {
            any_value::Value::BoolValue(v) => assert!(v),
            _ => panic!(),
        }
    }

    fn attr(rec: &LogRecord, key: &str) -> Option<any_value::Value> {
        rec.attributes
            .iter()
            .find(|a| a.key == key)
            .and_then(|a| a.value.clone())
            .and_then(|v| v.value)
    }

    #[test]
    fn severity_attr_is_the_lowercase_wire_form() {
        for etype in [
            AlertEventType::InstanceFired,
            AlertEventType::InstanceResolved,
            AlertEventType::RuleHealth,
            AlertEventType::Delivery,
            AlertEventType::Silenced,
        ] {
            let rec = build_log_record(&ev(), etype, &LogExtras::default(), 0);
            assert!(
                matches!(attr(&rec, "alert.severity"), Some(any_value::Value::StringValue(s)) if s == "critical"),
                "severity must be stamped on {} records",
                etype.as_str()
            );
        }

        let mut e = ev();
        e.severity = Severity::Warning;
        let rec = build_log_record(&e, AlertEventType::InstanceFired, &LogExtras::default(), 0);
        assert!(
            matches!(attr(&rec, "alert.severity"), Some(any_value::Value::StringValue(s)) if s == "warning")
        );
    }

    #[test]
    fn suppressed_attr_is_true_false_string() {
        let rec = build_log_record(
            &ev(),
            AlertEventType::InstanceFired,
            &LogExtras::default(),
            0,
        );
        assert!(
            matches!(attr(&rec, "alert.suppressed"), Some(any_value::Value::StringValue(s)) if s == "false")
        );

        let mut e = ev();
        e.suppressed = true;
        let rec = build_log_record(&e, AlertEventType::InstanceFired, &LogExtras::default(), 0);
        assert!(
            matches!(attr(&rec, "alert.suppressed"), Some(any_value::Value::StringValue(s)) if s == "true")
        );
    }

    #[test]
    fn evidence_json_emitted_only_when_present_as_compact_json() {
        let mut e = ev();
        e.evidence = Some(BTreeMap::from([
            ("errors".to_string(), serde_json::json!(42)),
            ("path".to_string(), serde_json::json!("/checkout")),
        ]));
        let rec = build_log_record(&e, AlertEventType::InstanceFired, &LogExtras::default(), 0);
        match attr(&rec, "alert.evidence_json") {
            Some(any_value::Value::StringValue(s)) => {
                assert_eq!(s, r#"{"errors":42,"path":"/checkout"}"#)
            }
            other => panic!("expected string evidence_json, got {other:?}"),
        }
        assert!(
            attr(&rec, "alert.evidence_truncated").is_none(),
            "untruncated evidence omits the truncated attribute"
        );
    }

    #[test]
    fn evidence_truncated_emitted_only_when_true() {
        let mut e = ev();
        e.evidence = None;
        e.evidence_truncated = true;
        let rec = build_log_record(&e, AlertEventType::InstanceFired, &LogExtras::default(), 0);
        assert!(
            attr(&rec, "alert.evidence_json").is_none(),
            "byte-capped evidence is dropped entirely"
        );
        assert!(
            matches!(attr(&rec, "alert.evidence_truncated"), Some(any_value::Value::StringValue(s)) if s == "true")
        );
    }
}
