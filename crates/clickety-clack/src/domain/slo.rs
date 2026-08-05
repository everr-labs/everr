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
    /// Identity scope: '' = live; consumers stamp preview ids here.
    #[serde(default)]
    pub namespace: String,
    /// Unique per (tenant, namespace).
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
/// The window the canonical burn-rate table is calibrated for (30 days). The SRE
/// workbook's 1h/6h/3d windows and 14.4/6/1 thresholds all assume this budget
/// window; [`tiers_for_window`] scales the windows to any other.
pub const CANONICAL_TIER_WINDOW_SECS: u64 = 30 * 86_400;

/// Floor on a tier's short (confirmation) window under scaling. Below this the
/// window would be too short to hold enough traffic to confirm a burn on a
/// low-volume SLO; the whole tier is pinned to `SHORT_WINDOW_FLOOR_SECS` short /
/// 12x long (the canonical long:short ratio) instead of scaling further down.
pub const SHORT_WINDOW_FLOOR_SECS: u64 = 60;

/// One canonical tier as (name, long secs, short secs, burn rate, severity),
/// calibrated to `CANONICAL_TIER_WINDOW_SECS`. All three share a 12:1 long:short
/// ratio, which the floor preserves.
struct BaseTier {
    name: &'static str,
    long_secs: u64,
    short_secs: u64,
    burn_rate: f64,
    severity: Severity,
}

const BASE_TIERS: [BaseTier; 3] = [
    BaseTier {
        name: "fast-burn",
        long_secs: 3600,
        short_secs: 300,
        burn_rate: 14.4,
        severity: Severity::Critical,
    },
    BaseTier {
        name: "slow-burn",
        long_secs: 21_600,
        short_secs: 1800,
        burn_rate: 6.0,
        severity: Severity::Critical,
    },
    BaseTier {
        name: "ticket",
        long_secs: 259_200,
        short_secs: 21_600,
        burn_rate: 1.0,
        severity: Severity::Warning,
    },
];

/// The three burn-rate tiers scaled to a `window_secs` budget window. The SRE
/// canonical table (1h/6h/3d at 14.4/6/1) is calibrated for 30 days; applying it
/// verbatim to, say, a 1-day SLO would measure burn over a 3-day ticket window
/// (longer than the whole objective) and fire slow-burn only after 150% of the
/// budget is spent. Scaling each window by `window_secs / 30d` keeps the intended
/// "budget consumed over the long window" (2%/5%/10%) constant for any window,
/// with the thresholds unchanged. Short windows are floored (see
/// `SHORT_WINDOW_FLOOR_SECS`) so a small window can't produce a sub-minute
/// confirmation window; the floor pins the whole tier at its 12:1 ratio, which
/// costs that tier its budget-fraction proportionality (a floored tier measures a
/// smaller slice of the budget than its threshold was calibrated for).
///
/// Flooring can also land one tier on another's windows: at a 1-day budget
/// fast-burn's 5m short scales to 10s, floors to 1m, and pins its long to 12m,
/// which is exactly where slow-burn's 30m/6h scale to. Tiers measuring identical
/// windows are one detector at two sensitivities, so only the lower threshold is
/// kept: it fires whenever its twin would and earlier, making the twin pure
/// duplication. Keeping both would emit two events per transition from a single
/// condition, and because identical windows cross at the same instant, the
/// auto-provisioned tier inhibition could not suppress the second (it needs the
/// higher tier to be firing already, not firing simultaneously). The survivor
/// holds the earlier tier's slot, so inhibition precedence still runs
/// fastest-to-slowest.
pub fn tiers_for_window(window_secs: u64) -> Vec<BurnRateTier> {
    let k = window_secs as f64 / CANONICAL_TIER_WINDOW_SECS as f64;
    // Deduplication keys on the computed seconds, not on the rendered windows, so
    // it never depends on `fmt_window_secs` being injective -- the same choice
    // `engine::slo_math::required_windows` makes when it collapses tier windows.
    let mut seen: Vec<(u64, u64)> = Vec::with_capacity(BASE_TIERS.len());
    let mut out: Vec<BurnRateTier> = Vec::with_capacity(BASE_TIERS.len());
    for b in BASE_TIERS.iter() {
        let short_scaled = (b.short_secs as f64 * k).round() as u64;
        let (long, short) = if short_scaled < SHORT_WINDOW_FLOOR_SECS {
            // Ratio-preserving floor: long = 12x the floored short.
            let ratio = b.long_secs / b.short_secs;
            (SHORT_WINDOW_FLOOR_SECS * ratio, SHORT_WINDOW_FLOOR_SECS)
        } else {
            ((b.long_secs as f64 * k).round() as u64, short_scaled)
        };
        let tier = BurnRateTier {
            name: b.name.into(),
            long_window: fmt_window_secs(long),
            short_window: fmt_window_secs(short),
            burn_rate: b.burn_rate,
            severity: b.severity,
        };
        // BASE_TIERS runs fastest-first with strictly decreasing thresholds
        // (asserted in `base_tiers_are_ordered_fastest_first`), so a collision
        // always means the newcomer is the lower-threshold twin: it replaces the
        // tier it collided with, in that tier's slot.
        match seen.iter().position(|&w| w == (long, short)) {
            Some(i) => out[i] = tier,
            None => {
                seen.push((long, short));
                out.push(tier);
            }
        }
    }
    out
}

/// The canonical tiers at their calibrated 30-day window. Their names, severities,
/// and burn-rate thresholds are window-independent, so this is the right list for
/// name/severity resolution (`tier_severity`) and precedence (inhibition) where
/// the actual windows don't matter. For evaluating burn over an SLO's own window,
/// use [`tiers_for_window`] with that SLO's budget window.
pub fn canonical_tiers() -> Vec<BurnRateTier> {
    tiers_for_window(CANONICAL_TIER_WINDOW_SECS)
}

/// The burn-rate tiers for an SLO, scaled to its own budget window
/// ([`tiers_for_window`]). An unparsable window (rejected at API validation) falls
/// back to the canonical 30-day set, so evaluation never panics on a bad spec.
pub fn tiers_for_spec(spec: &SloSpec) -> Vec<BurnRateTier> {
    let window_secs =
        parse_window_secs(&spec.time_window.duration).unwrap_or(CANONICAL_TIER_WINDOW_SECS);
    tiers_for_window(window_secs)
}

/// Resolve a tier's severity from `labels["slo_tier"]` against a tier list. Tier
/// names and severities are the same at every window, so either `canonical_tiers()`
/// or a `tiers_for_window` list resolves identically. Unknown/missing tier
/// defensively falls back to `Severity::Critical` — a conservative default for a
/// tier name not present, shared by every caller so the fallback can't disagree
/// with itself.
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
/// Supported units: s (second), m (minute), h (hour), d (day), w (week). Value
/// must be > 0. Calendar units (M/Q/Y) and anything else are rejected. The `s`
/// unit exists so window-scaled burn tiers (`tiers_for_window`) round-trip: a
/// scaled window that isn't a whole minute (e.g. a 7-day SLO's 70s short window)
/// is emitted as `"70s"` and must parse back to the same seconds.
pub fn parse_window_secs(s: &str) -> Result<u64, WindowParseError> {
    let s = s.trim();
    let split = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: u64 = num.parse().map_err(|_| WindowParseError(s.to_string()))?;
    if n == 0 {
        return Err(WindowParseError(s.to_string()));
    }
    let mult = match unit {
        "s" => 1,
        "m" => 60,
        "h" => 3600,
        "d" => 86_400,
        "w" => 604_800,
        _ => return Err(WindowParseError(s.to_string())),
    };
    n.checked_mul(mult)
        .ok_or_else(|| WindowParseError(s.to_string()))
}

/// Format a whole-seconds duration back into the shortest exact shorthand
/// `parse_window_secs` accepts: the coarsest unit that divides evenly (so 3600 is
/// `"1h"`, 259200 is `"3d"`), falling back to minutes then seconds. The inverse of
/// `parse_window_secs` for any value it can produce, so a `tiers_for_window` window
/// always round-trips through the freshness ledger's `{secs}s` keys.
pub fn fmt_window_secs(secs: u64) -> String {
    if secs == 0 {
        return "0s".to_string();
    }
    if secs.is_multiple_of(604_800) {
        format!("{}w", secs / 604_800)
    } else if secs.is_multiple_of(86_400) {
        format!("{}d", secs / 86_400)
    } else if secs.is_multiple_of(3600) {
        format!("{}h", secs / 3600)
    } else if secs.is_multiple_of(60) {
        format!("{}m", secs / 60)
    } else {
        format!("{secs}s")
    }
}

/// A stable fingerprint of the SLO's *objective*: the fields that determine what
/// a stored status snapshot's numbers mean: the SLI query, target, and time window.
/// When it changes, the snapshot's per-window burn/budget values describe a
/// different query, so both the evaluator
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
        assert!(parse_window_secs("1M").is_err());
        assert!(parse_window_secs("1Q").is_err());
        assert!(parse_window_secs("").is_err());
        assert!(parse_window_secs("abc").is_err());
        assert!(parse_window_secs("10").is_err());
        assert!(parse_window_secs("0d").is_err());
        assert!(parse_window_secs("300000000000000000w").is_err());
    }

    #[test]
    fn tier_severity_resolves_known_tier_and_defaults_unknown_to_critical() {
        let tiers = canonical_tiers();
        let known = BTreeMap::from([("slo_tier".to_string(), "ticket".to_string())]);
        assert_eq!(tier_severity(&tiers, &known), Severity::Warning);

        // Unknown or missing tiers fail closed to Critical.
        let unknown = BTreeMap::from([("slo_tier".to_string(), "ghost-tier".to_string())]);
        assert_eq!(tier_severity(&tiers, &unknown), Severity::Critical);

        let missing = BTreeMap::new();
        assert_eq!(tier_severity(&tiers, &missing), Severity::Critical);
    }

    #[test]
    fn fmt_window_round_trips_through_parse() {
        for secs in [1u64, 59, 60, 70, 300, 720, 3600, 8640, 60_480, 259_200] {
            assert_eq!(parse_window_secs(&fmt_window_secs(secs)).unwrap(), secs);
        }
    }

    #[test]
    fn tiers_for_30d_are_the_canonical_windows() {
        // The 30-day case must reproduce the SRE table verbatim (no scaling drift).
        let t = tiers_for_window(CANONICAL_TIER_WINDOW_SECS);
        assert_eq!(t[0].long_window, "1h");
        assert_eq!(t[0].short_window, "5m");
        assert_eq!(t[1].long_window, "6h");
        assert_eq!(t[1].short_window, "30m");
        assert_eq!(t[2].long_window, "3d");
        assert_eq!(t[2].short_window, "6h");
    }

    #[test]
    fn tiers_scale_proportionally_for_a_seven_day_window() {
        let t = tiers_for_window(7 * 86_400);
        assert_eq!(t[0].long_window, "14m"); // 1h * 7/30
        assert_eq!(t[0].short_window, "70s"); // 5m * 7/30
        assert_eq!(t[1].long_window, "84m"); // 6h * 7/30
        assert_eq!(t[1].short_window, "7m"); // 30m * 7/30
        assert_eq!(t[2].short_window, "84m"); // 6h * 7/30
        assert_eq!(t[0].burn_rate, 14.4);
        assert_eq!(t[2].burn_rate, 1.0);
        assert_eq!(t[2].severity, Severity::Warning);
    }

    #[test]
    fn small_windows_never_exceed_the_objective_and_floor_the_short_window() {
        let window = 86_400;
        for t in tiers_for_window(window) {
            let long = parse_window_secs(&t.long_window).unwrap();
            let short = parse_window_secs(&t.short_window).unwrap();
            assert!(long <= window, "{} long {long}s exceeds 1d", t.name);
            assert!(
                short >= SHORT_WINDOW_FLOOR_SECS,
                "{} short below floor",
                t.name
            );
            assert!(long > short, "{} long must exceed short", t.name);
        }
    }

    #[test]
    fn base_tiers_are_ordered_fastest_first() {
        // `tiers_for_window`'s dedup replaces unconditionally on a window
        // collision, which is only the lower-threshold survivor if this holds.
        for pair in BASE_TIERS.windows(2) {
            assert!(
                pair[0].burn_rate > pair[1].burn_rate,
                "{} must outrank {}",
                pair[0].name,
                pair[1].name
            );
        }
    }

    #[test]
    fn tiers_are_never_duplicated_by_the_short_window_floor() {
        // See `tiers_for_window` for why a twin is dropped rather than kept.
        let t = tiers_for_window(86_400);
        assert_eq!(t.len(), 2, "1d collapses fast-burn and slow-burn into one");
        // The survivor is the lower threshold, in the slot the faster tier held.
        assert_eq!(t[0].name, "slow-burn");
        assert_eq!(t[0].long_window, "12m");
        assert_eq!(t[0].short_window, "1m");
        assert_eq!(t[0].burn_rate, 6.0);
        assert_eq!(t[0].severity, Severity::Critical);
        assert_eq!(t[1].name, "ticket");
        assert_eq!(t[1].long_window, "144m");
        assert_eq!(t[1].short_window, "12m");
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
        assert!(spec.min_valid_events.is_none());
        assert!(!spec.suppressed); // default false
        assert!(spec.annotations.is_empty());
    }

    fn fp_spec() -> SloSpec {
        SloSpec {
            sli: SliSpec {
                sql: "SELECT 1 AS good, 1 AS valid".into(),
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
}
