use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use crate::domain::ids::{SloId, TenantId};
use crate::domain::rule::Severity;

/// The SLI: a single read-only SELECT returning `good` and `valid` numeric
/// columns, with the window injected by the engine as ClickHouse parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SliSpec {
    pub sql: String,
    /// Columns that fan the SLO out into per-group SLIs. Empty = scalar SLO.
    #[serde(default)]
    pub label_columns: Vec<String>,
}

/// OpenSLO-aligned time window. v1 implements rolling only; the calendar arm
/// exists for forward-compat and is rejected by validation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimeWindow {
    /// Duration shorthand, e.g. "30d" (rolling). Supported units: m,h,d,w.
    pub duration: String,
    #[serde(rename = "isRolling", default = "default_is_rolling")]
    pub is_rolling: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar: Option<CalendarWindow>,
}

fn default_is_rolling() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CalendarWindow {
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "timeZone")]
    pub time_zone: String,
}

/// One multi-window burn-rate tier. Evaluated in Plan 3; stored here as data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BurnRateTier {
    pub name: String,
    /// Long/short window durations, e.g. "1h" / "5m".
    pub long_window: String,
    pub short_window: String,
    pub burn_rate: f64,
    pub severity: Severity,
}

/// Consumer-supplied SLO definition (the JSONB `spec`). Excludes `name`,
/// which is a first-class column on the wrapper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SloSpec {
    pub sli: SliSpec,
    #[serde(rename = "targetPercent")]
    pub target_percent: f64,
    #[serde(rename = "timeWindow")]
    pub time_window: TimeWindow,
    /// Optional low-traffic floor on the long window; None = off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_valid_events: Option<u64>,
    #[serde(default)]
    pub annotations: BTreeMap<String, String>,
    /// Preview mode: evaluate fully but never notify.
    #[serde(default)]
    pub suppressed: bool,
}

/// A persisted SLO.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Slo {
    pub id: SloId,
    pub tenant: TenantId,
    /// Unique per tenant.
    pub name: String,
    pub spec: SloSpec,
    pub version: i64,
    /// Operational pause flag; not part of the spec, does not affect `version`.
    #[serde(default)]
    pub paused: bool,
}

/// The synthetic routing label carrying the SLO id on every SLO-originated event.
pub const SLO_LABEL: &str = "slo";
/// The per-tier instance discriminator injected into burn-rate instance labels.
pub const SLO_TIER_LABEL: &str = "slo_tier";
/// Label names the SLO pipeline injects; user label columns must not collide.
pub const RESERVED_SLO_LABELS: [&str; 2] = [SLO_LABEL, SLO_TIER_LABEL];

/// The SRE-workbook canonical three tiers, calibrated to a 30-day window.
pub fn canonical_tiers() -> Vec<BurnRateTier> {
    vec![
        BurnRateTier {
            name: "fast-burn".into(),
            long_window: "1h".into(),
            short_window: "5m".into(),
            burn_rate: 14.4,
            severity: Severity::Critical,
        },
        BurnRateTier {
            name: "slow-burn".into(),
            long_window: "6h".into(),
            short_window: "30m".into(),
            burn_rate: 6.0,
            severity: Severity::Critical,
        },
        BurnRateTier {
            name: "ticket".into(),
            long_window: "3d".into(),
            short_window: "6h".into(),
            burn_rate: 1.0,
            severity: Severity::Warning,
        },
    ]
}

/// Resolve a tier's severity from `labels["slo_tier"]` against the `canonical_tiers()`
/// list every SLO is evaluated on. Unknown/missing tier defensively falls back to
/// `Severity::Critical` — a conservative default for a tier name no longer present,
/// shared by every caller so the fallback can't disagree with itself.
pub(crate) fn tier_severity(tiers: &[BurnRateTier], labels: &BTreeMap<String, String>) -> Severity {
    labels
        .get(SLO_TIER_LABEL)
        .and_then(|name| tiers.iter().find(|t| &t.name == name))
        .map(|t| t.severity)
        .unwrap_or(Severity::Critical)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowParseError(pub String);

impl std::fmt::Display for WindowParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "invalid window duration: {}", self.0)
    }
}

impl std::error::Error for WindowParseError {}

/// Parse a rolling-window duration shorthand into seconds.
/// Supported units: m (minute), h (hour), d (day), w (week). Value must be > 0.
/// Calendar units (M/Q/Y) and anything else are rejected.
pub fn parse_window_secs(s: &str) -> Result<u64, WindowParseError> {
    let s = s.trim();
    let split = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: u64 = num.parse().map_err(|_| WindowParseError(s.to_string()))?;
    if n == 0 {
        return Err(WindowParseError(s.to_string()));
    }
    let mult = match unit {
        "m" => 60,
        "h" => 3600,
        "d" => 86_400,
        "w" => 604_800,
        _ => return Err(WindowParseError(s.to_string())),
    };
    n.checked_mul(mult)
        .ok_or_else(|| WindowParseError(s.to_string()))
}

/// A stable fingerprint of the SLO's *objective*: the fields that determine what
/// a stored status snapshot's numbers mean — the SLI (query + group columns), the
/// target, and the time window. When it changes, a snapshot's groups and
/// per-window burn/budget values describe a different query, so both the evaluator
/// (carry-forward) and the store (`update_slo`) drop the snapshot on a mismatch.
///
/// The excluded fields (`min_valid_events`, `annotations`, `suppressed`) affect
/// firing or presentation, not the computed numbers — the same "budget-significant"
/// set `update_slo` keys `budget_epoch` off of. Hashed from the struct (not raw
/// JSON) over `\0`-separated fields, so it is order-stable and safe to persist.
pub fn objective_fingerprint(spec: &SloSpec) -> String {
    let mut h = Sha256::new();
    h.update(spec.sli.sql.as_bytes());
    h.update([0u8]);
    for col in &spec.sli.label_columns {
        h.update(col.as_bytes());
        h.update([0u8]);
    }
    h.update([0u8]);
    h.update(spec.target_percent.to_bits().to_le_bytes());
    h.update(spec.time_window.duration.as_bytes());
    h.update([0u8]);
    h.update([spec.time_window.is_rolling as u8]);
    if let Some(cal) = &spec.time_window.calendar {
        h.update(cal.start_time.as_bytes());
        h.update([0u8]);
        h.update(cal.time_zone.as_bytes());
    }
    format!("{:x}", h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_window_units() {
        assert_eq!(parse_window_secs("5m").unwrap(), 300);
        assert_eq!(parse_window_secs("1h").unwrap(), 3600);
        assert_eq!(parse_window_secs("3d").unwrap(), 259_200);
        assert_eq!(parse_window_secs("1w").unwrap(), 604_800);
        assert_eq!(parse_window_secs("30d").unwrap(), 2_592_000);
    }

    #[test]
    fn rejects_calendar_and_garbage_windows() {
        assert!(parse_window_secs("1M").is_err()); // months = calendar, v2
        assert!(parse_window_secs("1Q").is_err());
        assert!(parse_window_secs("").is_err());
        assert!(parse_window_secs("abc").is_err());
        assert!(parse_window_secs("10").is_err()); // no unit
        assert!(parse_window_secs("0d").is_err()); // must be > 0
        assert!(parse_window_secs("300000000000000000w").is_err()); // overflow -> Err, not panic/wrap
    }

    #[test]
    fn tier_severity_resolves_known_tier_and_defaults_unknown_to_critical() {
        let tiers = canonical_tiers();
        let known = BTreeMap::from([("slo_tier".to_string(), "ticket".to_string())]);
        assert_eq!(tier_severity(&tiers, &known), Severity::Warning);

        // A tier name that isn't in the (resolved) tier list -- e.g. dropped from the
        // spec since the instance was opened -- conservatively resolves to Critical,
        // not the tier's old severity or any other default.
        let unknown = BTreeMap::from([("slo_tier".to_string(), "ghost-tier".to_string())]);
        assert_eq!(tier_severity(&tiers, &unknown), Severity::Critical);

        // Missing label entirely: same conservative default.
        let missing = BTreeMap::new();
        assert_eq!(tier_severity(&tiers, &missing), Severity::Critical);
    }

    #[test]
    fn canonical_tiers_are_the_three_srivm_defaults() {
        let t = canonical_tiers();
        assert_eq!(t.len(), 3);
        assert_eq!(t[0].name, "fast-burn");
        assert_eq!(t[0].burn_rate, 14.4);
        assert_eq!(t[0].severity, Severity::Critical);
        assert_eq!(t[2].name, "ticket");
        assert_eq!(t[2].severity, Severity::Warning);
    }

    #[test]
    fn spec_deserializes_openslo_field_names_with_defaults() {
        let json = serde_json::json!({
            "sli": { "sql": "SELECT 1 AS good, 1 AS valid" },
            "targetPercent": 99.9,
            "timeWindow": { "duration": "30d" }
        });
        let spec: SloSpec = serde_json::from_value(json).unwrap();
        assert_eq!(spec.target_percent, 99.9);
        assert_eq!(spec.time_window.duration, "30d");
        assert!(spec.time_window.is_rolling); // default true
        assert!(spec.time_window.calendar.is_none());
        assert!(spec.sli.label_columns.is_empty()); // default []
        assert!(spec.min_valid_events.is_none());
        assert!(!spec.suppressed); // default false
        assert!(spec.annotations.is_empty());
    }

    #[test]
    fn spec_round_trips_through_json() {
        let spec = SloSpec {
            sli: SliSpec {
                sql: "SELECT 1 AS good, 1 AS valid".into(),
                label_columns: vec!["service".into()],
            },
            target_percent: 99.5,
            time_window: TimeWindow {
                duration: "7d".into(),
                is_rolling: true,
                calendar: None,
            },
            min_valid_events: Some(1000),
            annotations: BTreeMap::new(),
            suppressed: false,
        };
        let round: SloSpec = serde_json::from_value(serde_json::to_value(&spec).unwrap()).unwrap();
        assert_eq!(round, spec);
    }

    fn fp_spec() -> SloSpec {
        SloSpec {
            sli: SliSpec {
                sql: "SELECT 1 AS good, 1 AS valid".into(),
                label_columns: vec!["service".into()],
            },
            target_percent: 99.9,
            time_window: TimeWindow {
                duration: "30d".into(),
                is_rolling: true,
                calendar: None,
            },
            min_valid_events: None,
            annotations: BTreeMap::new(),
            suppressed: false,
        }
    }

    #[test]
    fn objective_fingerprint_is_stable_and_order_insensitive() {
        let a = fp_spec();
        let b = fp_spec();
        // Deterministic for identical specs, and unaffected by JSON key order
        // (built from the struct, then serialized and back).
        assert_eq!(objective_fingerprint(&a), objective_fingerprint(&b));
        let round: SloSpec = serde_json::from_value(serde_json::to_value(&a).unwrap()).unwrap();
        assert_eq!(objective_fingerprint(&a), objective_fingerprint(&round));
    }

    #[test]
    fn objective_fingerprint_changes_on_objective_fields() {
        let base = objective_fingerprint(&fp_spec());

        let mut sql = fp_spec();
        sql.sli.sql = "SELECT 2 AS good, 2 AS valid".into();
        assert_ne!(objective_fingerprint(&sql), base);

        let mut cols = fp_spec();
        cols.sli.label_columns = vec!["service".into(), "region".into()];
        assert_ne!(objective_fingerprint(&cols), base);

        let mut target = fp_spec();
        target.target_percent = 99.5;
        assert_ne!(objective_fingerprint(&target), base);

        let mut window = fp_spec();
        window.time_window.duration = "7d".into();
        assert_ne!(objective_fingerprint(&window), base);
    }

    #[test]
    fn objective_fingerprint_ignores_non_objective_fields() {
        // These change firing or presentation, not the stored SLI/burn/budget
        // numbers, so a snapshot stays valid across them — the fingerprint holds.
        let base = objective_fingerprint(&fp_spec());

        let mut floor = fp_spec();
        floor.min_valid_events = Some(1000);
        assert_eq!(objective_fingerprint(&floor), base);

        let mut annotated = fp_spec();
        annotated
            .annotations
            .insert("runbook".into(), "https://x".into());
        assert_eq!(objective_fingerprint(&annotated), base);

        let mut suppressed = fp_spec();
        suppressed.suppressed = true;
        assert_eq!(objective_fingerprint(&suppressed), base);
    }

    #[test]
    fn objective_fingerprint_column_boundary_is_unambiguous() {
        // ["a","b"] must not collide with ["ab"]: the `\0` separators disambiguate.
        let mut ab = fp_spec();
        ab.sli.label_columns = vec!["a".into(), "b".into()];
        let mut concat = fp_spec();
        concat.sli.label_columns = vec!["ab".into()];
        assert_ne!(objective_fingerprint(&ab), objective_fingerprint(&concat));
    }
}
