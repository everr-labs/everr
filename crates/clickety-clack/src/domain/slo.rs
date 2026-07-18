use serde::{Deserialize, Serialize};
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
    /// None = use `canonical_tiers()`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiers: Option<Vec<BurnRateTier>>,
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

/// Resolve a tier's severity from `labels["slo_tier"]` against the SLO's already-resolved
/// tier list (caller passes `spec.tiers.clone().unwrap_or_else(canonical_tiers)`, or the
/// pre-resolved `tiers` off a lean dispatch/evaluator projection). Unknown/missing tier
/// defensively falls back to `Severity::Critical` — a conservative default for a tier no
/// longer in the spec, shared by every caller so the fallback can't disagree with itself.
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
        assert!(spec.tiers.is_none());
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
            tiers: None,
            annotations: BTreeMap::new(),
            suppressed: false,
        };
        let round: SloSpec = serde_json::from_value(serde_json::to_value(&spec).unwrap()).unwrap();
        assert_eq!(round, spec);
    }
}
