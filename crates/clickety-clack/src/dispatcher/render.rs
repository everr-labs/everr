//! Presentation helpers shared by the notification renderers.
//!
//! Alert events honor Alertmanager-convention annotations packed by the caller:
//!
//! - `summary` — templated headline; falls back to the instance key when absent
//!   (or when it substitutes to nothing but whitespace).
//! - `description` — templated additional body line.
//! - `link.alert` / `link.runbook` — http(s) URLs rendered as channel-native
//!   links ("View alert" / "View runbook"); non-http(s) values are ignored.
//!
//! Templates substitute `${<key>}` by resolving the key, in order, against
//! `Event.labels`, then (for the key `value`) the event's numeric value, then
//! `Event.evidence` (the source row's non-label columns; string values render
//! unquoted, other JSON values as compact JSON). A key that resolves nowhere ⇒
//! empty string. Substitution is a single left-to-right pass and the
//! substituted text is never re-scanned, so label values cannot inject further
//! expansions. Channel-specific escaping happens AFTER substitution, inside each
//! channel renderer.
use crate::domain::event::{Event, EventKind, EventStatus};

/// Expand `${<key>}` placeholders in `template` against `ev`.
///
/// A key resolves in order: the instance label of that name, then (for the key
/// `value`) the event's numeric value when present, then the evidence column of
/// that name. A key that resolves nowhere expands to the empty string, so a
/// template survives evidence being dropped (byte cap) or truncated (column
/// cap). Evidence values render per [`push_json_value`].
///
/// Single pass, no recursion: a `${…}` appearing in a substituted value is
/// emitted literally. An unterminated `${` is kept as literal text.
pub fn substitute(template: &str, ev: &Event) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                let key = &after[..end];
                if let Some(v) = ev.labels.get(key) {
                    out.push_str(v);
                } else if key == "value" && ev.value.is_some() {
                    // `is_some` (not a bare match) so an absent rule value still
                    // falls through to an evidence column literally named "value".
                    if let Some(v) = ev.value {
                        out.push_str(&v.to_string());
                    }
                } else if let Some(v) = ev.evidence.as_ref().and_then(|e| e.get(key)) {
                    push_json_value(&mut out, v);
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Render an evidence value for humans: strings unquoted, everything else
/// (numbers, booleans, null, arrays, objects) as its compact JSON text.
fn push_json_value(out: &mut String, v: &serde_json::Value) {
    match v {
        serde_json::Value::String(s) => out.push_str(s),
        other => out.push_str(&other.to_string()),
    }
}

/// Human label for an event: the summary annotation (rule-health verbatim, alert
/// templated), else the instance key (alerts) / rule id (rule-health).
pub fn headline(ev: &Event) -> String {
    match ev.kind {
        EventKind::RuleHealth => ev
            .annotations
            .get("summary")
            .cloned()
            .unwrap_or_else(|| format!("rule {}", ev.rule.0)),
        EventKind::Alert => ev
            .annotations
            .get("summary")
            .map(|t| substitute(t, ev))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| ev.instance_key.0.clone()),
    }
}

/// Templated `description` annotation for alert events (None when absent, empty
/// after substitution, or on rule-health events, whose rendering is unchanged).
pub fn description(ev: &Event) -> Option<String> {
    if ev.kind != EventKind::Alert {
        return None;
    }
    ev.annotations
        .get("description")
        .map(|t| substitute(t, ev))
        .filter(|s| !s.trim().is_empty())
}

/// The `link.alert` annotation, when present and a valid http(s) URL.
pub fn alert_link(ev: &Event) -> Option<&str> {
    link(ev, "link.alert")
}

/// The `link.runbook` annotation, when present and a valid http(s) URL.
pub fn runbook_link(ev: &Event) -> Option<&str> {
    link(ev, "link.runbook")
}

fn link<'a>(ev: &'a Event, key: &str) -> Option<&'a str> {
    ev.annotations
        .get(key)
        .map(String::as_str)
        .filter(|s| is_http_url(s))
}

/// True for `http://` / `https://` URLs with a non-empty remainder and no
/// whitespace or control characters (which would break attribute/URL contexts).
fn is_http_url(s: &str) -> bool {
    let rest = match s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
    {
        Some(r) => r,
        None => return false,
    };
    !rest.is_empty() && !s.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Status word: DEGRADED/RECOVERED for rule-health, FIRING/RESOLVED for alerts.
pub fn status_word(ev: &Event) -> &'static str {
    match (ev.kind, ev.status) {
        (EventKind::RuleHealth, EventStatus::Firing) => "DEGRADED",
        (EventKind::RuleHealth, EventStatus::Resolved) => "RECOVERED",
        (EventKind::Alert, EventStatus::Firing) => "FIRING",
        (EventKind::Alert, EventStatus::Resolved) => "RESOLVED",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn alert(
        labels: BTreeMap<String, String>,
        value: Option<f64>,
        annotations: BTreeMap<String, String>,
    ) -> Event {
        Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("svc=api".into()),
            status: EventStatus::Firing,
            kind: EventKind::Alert,
            labels,
            value,
            severity: Severity::Warning,
            annotations,
            eval_ts: OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        }
    }

    #[test]
    fn health_uses_summary_and_degraded_word() {
        let mut ann = BTreeMap::new();
        ann.insert(
            "summary".to_string(),
            "Rule X degraded after 3 consecutive failures".to_string(),
        );
        let ev = Event::rule_health(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            EventStatus::Firing,
            ann,
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(status_word(&ev), "DEGRADED");
        assert!(headline(&ev).contains("degraded"));
    }

    #[test]
    fn substitute_labels_and_value() {
        let labels = BTreeMap::from([("host".to_string(), "web-1".to_string())]);
        let ev = alert(labels, Some(93.5), BTreeMap::new());
        assert_eq!(
            substitute("CPU on ${host} is ${value}%", &ev),
            "CPU on web-1 is 93.5%"
        );
    }

    #[test]
    fn substitute_missing_label_and_absent_value_are_empty() {
        let ev = alert(BTreeMap::new(), None, BTreeMap::new());
        assert_eq!(substitute("[${nope}] v=${value}!", &ev), "[] v=!");
    }

    #[test]
    fn substitute_resolves_evidence_columns() {
        let mut ev = alert(BTreeMap::new(), None, BTreeMap::new());
        ev.evidence = Some(BTreeMap::from([(
            "last_error".to_string(),
            serde_json::json!("HTTP 500"),
        )]));
        assert_eq!(substitute("err: ${last_error}", &ev), "err: HTTP 500");
    }

    #[test]
    fn substitute_prefers_labels_over_evidence() {
        let labels = BTreeMap::from([("host".to_string(), "from-label".to_string())]);
        let mut ev = alert(labels, None, BTreeMap::new());
        ev.evidence = Some(BTreeMap::from([(
            "host".to_string(),
            serde_json::json!("from-evidence"),
        )]));
        assert_eq!(substitute("${host}", &ev), "from-label");
    }

    #[test]
    fn substitute_prefers_event_value_over_evidence_value_column() {
        let mut ev = alert(BTreeMap::new(), Some(7.5), BTreeMap::new());
        ev.evidence = Some(BTreeMap::from([(
            "value".to_string(),
            serde_json::json!(999),
        )]));
        assert_eq!(substitute("${value}", &ev), "7.5");
    }

    #[test]
    fn substitute_value_falls_back_to_evidence_when_event_value_absent() {
        let mut ev = alert(BTreeMap::new(), None, BTreeMap::new());
        ev.evidence = Some(BTreeMap::from([(
            "value".to_string(),
            serde_json::json!(999),
        )]));
        assert_eq!(substitute("${value}", &ev), "999");
    }

    #[test]
    fn substitute_prefers_value_label_over_event_value() {
        let labels = BTreeMap::from([("value".to_string(), "labeled".to_string())]);
        let ev = alert(labels, Some(1.0), BTreeMap::new());
        assert_eq!(substitute("${value}", &ev), "labeled");
    }

    #[test]
    fn substitute_renders_non_string_evidence_as_compact_json() {
        let mut ev = alert(BTreeMap::new(), None, BTreeMap::new());
        ev.evidence = Some(BTreeMap::from([
            ("count".to_string(), serde_json::json!(42)),
            ("ratio".to_string(), serde_json::json!(0.25)),
            ("ok".to_string(), serde_json::json!(false)),
            ("gone".to_string(), serde_json::json!(null)),
            ("list".to_string(), serde_json::json!(["a", 1])),
            ("obj".to_string(), serde_json::json!({"k": "v"})),
        ]));
        assert_eq!(
            substitute("${count} ${ratio} ${ok} ${gone} ${list} ${obj}", &ev),
            r#"42 0.25 false null ["a",1] {"k":"v"}"#
        );
    }

    #[test]
    fn substitute_dropped_evidence_renders_empty() {
        let mut ev = alert(BTreeMap::new(), None, BTreeMap::new());
        // Evidence over the byte cap is dropped entirely (None + truncated flag):
        // refs into it must degrade to empty text, not break rendering.
        ev.evidence = None;
        ev.evidence_truncated = true;
        assert_eq!(substitute("err=[${last_error}]", &ev), "err=[]");
    }

    #[test]
    fn substitute_does_not_recurse_into_label_values() {
        let labels = BTreeMap::from([
            ("a".to_string(), "${b}".to_string()),
            ("b".to_string(), "boom".to_string()),
        ]);
        let ev = alert(labels, None, BTreeMap::new());
        assert_eq!(substitute("${a}", &ev), "${b}");
    }

    #[test]
    fn substitute_keeps_unterminated_placeholder_literal() {
        let labels = BTreeMap::from([("host".to_string(), "web-1".to_string())]);
        let ev = alert(labels, None, BTreeMap::new());
        assert_eq!(substitute("on ${host", &ev), "on ${host");
    }

    #[test]
    fn alert_headline_uses_substituted_summary() {
        let labels = BTreeMap::from([("host".to_string(), "web-1".to_string())]);
        let ann = BTreeMap::from([("summary".to_string(), "High CPU on ${host}".to_string())]);
        let ev = alert(labels, None, ann);
        assert_eq!(headline(&ev), "High CPU on web-1");
    }

    #[test]
    fn alert_headline_falls_back_to_instance_key_without_summary() {
        let ev = alert(BTreeMap::new(), None, BTreeMap::new());
        assert_eq!(headline(&ev), "svc=api");
    }

    #[test]
    fn alert_headline_falls_back_when_summary_substitutes_to_blank() {
        let ann = BTreeMap::from([("summary".to_string(), " ${gone} ".to_string())]);
        let ev = alert(BTreeMap::new(), None, ann);
        assert_eq!(headline(&ev), "svc=api");
    }

    #[test]
    fn description_is_substituted_and_optional() {
        let labels = BTreeMap::from([("host".to_string(), "web-1".to_string())]);
        let ann = BTreeMap::from([("description".to_string(), "${host} at ${value}".to_string())]);
        let ev = alert(labels, Some(2.0), ann);
        assert_eq!(description(&ev).as_deref(), Some("web-1 at 2"));
        let bare = alert(BTreeMap::new(), None, BTreeMap::new());
        assert_eq!(description(&bare), None);
    }

    #[test]
    fn description_is_ignored_on_rule_health() {
        let ann = BTreeMap::from([("description".to_string(), "d".to_string())]);
        let ev = Event::rule_health(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            EventStatus::Firing,
            ann,
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(description(&ev), None);
    }

    #[test]
    fn links_require_valid_http_urls() {
        let ann = BTreeMap::from([
            ("link.alert".to_string(), "https://app/alerts/1".to_string()),
            (
                "link.runbook".to_string(),
                "javascript:alert(1)".to_string(),
            ),
        ]);
        let ev = alert(BTreeMap::new(), None, ann);
        assert_eq!(alert_link(&ev), Some("https://app/alerts/1"));
        assert_eq!(runbook_link(&ev), None, "non-http scheme is rejected");

        let ann = BTreeMap::from([
            ("link.alert".to_string(), "https://a b".to_string()),
            ("link.runbook".to_string(), "https://".to_string()),
        ]);
        let ev = alert(BTreeMap::new(), None, ann);
        assert_eq!(alert_link(&ev), None, "whitespace is rejected");
        assert_eq!(runbook_link(&ev), None, "empty remainder is rejected");

        let ann = BTreeMap::from([("link.runbook".to_string(), "http://wiki/rb".to_string())]);
        let ev = alert(BTreeMap::new(), None, ann);
        assert_eq!(runbook_link(&ev), Some("http://wiki/rb"));
    }
}
