use crate::domain::ids::{RuleId, TenantId};
use serde::{Deserialize, Serialize};
use time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Critical,
}

impl Severity {
    /// The lowercase wire/label form, matching the serde `lowercase` rename.
    pub fn as_str(&self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Warning => "warning",
            Severity::Critical => "critical",
        }
    }
}

/// Consumer-supplied definition of a rule (the API request body shape).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleSpec {
    pub sql: String,
    /// How often to evaluate, in seconds.
    pub interval_secs: u32,
    /// Condition must hold this long before firing, in seconds (0 = immediate).
    pub for_secs: u32,
    /// Columns whose values form the instance identity (labels).
    pub label_columns: Vec<String>,
    /// Optional column carrying the numeric value of the instance.
    pub value_column: Option<String>,
    pub severity: Severity,
    #[serde(default)]
    pub annotations: std::collections::BTreeMap<String, String>,
    /// Number of consecutive absent evaluations required to resolve (default 1).
    #[serde(default = "default_resolve_after")]
    pub resolve_after: u32,
    /// Opt-in adaptive cadence: cap for the stretched evaluation interval, in
    /// seconds. When set (must be `>= interval_secs`), each quiet evaluation
    /// (no present row, no instance pending or firing) doubles the effective
    /// interval from `interval_secs` up to this cap; any active or erroring
    /// evaluation snaps it back to `interval_secs`. `None` (the default, and
    /// what specs stored before this field read as) disables stretching.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_interval_secs: Option<u32>,
    /// Preview mode: the rule evaluates fully and produces events/history, but the
    /// dispatcher never notifies on its events (no routing, grouping, or firehose).
    #[serde(default)]
    pub suppressed: bool,
}

fn default_resolve_after() -> u32 {
    1
}

/// A persisted rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub id: RuleId,
    pub tenant: TenantId,
    /// Identity scope: '' = live; consumers stamp preview ids here.
    #[serde(default)]
    pub namespace: String,
    /// The as-code address, unique per (tenant, namespace).
    #[serde(default)]
    pub name: String,
    pub spec: RuleSpec,
    pub version: i64,
    /// Operational pause flag. Not part of the spec; does not affect `version`.
    #[serde(default)]
    pub paused: bool,
}

/// Operational health of a rule, a separate axis from the per-instance state machine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleHealth {
    /// `"healthy"` or `"degraded"`.
    pub status: String,
    pub consecutive_failures: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub degraded_since: Option<time::OffsetDateTime>,
    pub last_error: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_error_at: Option<time::OffsetDateTime>,
}

impl RuleSpec {
    pub fn for_duration(&self) -> Duration {
        Duration::seconds(self.for_secs as i64)
    }
}

#[cfg(test)]
mod pause_tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn rule_paused_defaults_false_when_absent() {
        // Older serialized rules have no `paused`; it must default to false.
        let v = serde_json::json!({
            "id": Uuid::nil(),
            "tenant": Uuid::nil(),
            "spec": {
                "sql": "SELECT 1",
                "interval_secs": 30,
                "for_secs": 0,
                "label_columns": [],
                "severity": "info"
            },
            "version": 1
        });
        let r: Rule = serde_json::from_value(v).unwrap();
        assert!(!r.paused);
        // Specs stored before `suppressed` existed must default it to false too.
        assert!(!r.spec.suppressed);
        // Specs stored before `max_interval_secs` existed must read as None
        // (adaptive cadence off), and None must not serialize a key at all.
        assert_eq!(r.spec.max_interval_secs, None);
        let back = serde_json::to_value(&r.spec).unwrap();
        assert!(back.get("max_interval_secs").is_none());
    }

    #[test]
    fn rule_identity_defaults_when_absent() {
        // Fixtures serialized before first-class identity carry no
        // namespace/name; they must default to empty strings.
        let v = serde_json::json!({
            "id": Uuid::nil(),
            "tenant": Uuid::nil(),
            "spec": {
                "sql": "SELECT 1",
                "interval_secs": 30,
                "for_secs": 0,
                "label_columns": [],
                "severity": "info"
            },
            "version": 1
        });
        let r: Rule = serde_json::from_value(v).unwrap();
        assert_eq!(r.namespace, "");
        assert_eq!(r.name, "");
    }
}
