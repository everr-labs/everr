use crate::domain::slo::{canonical_tiers, parse_window_secs, BurnRateTier, SloSpec};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Fraction of requests allowed to be bad, e.g. 99.9 -> 0.001.
pub fn error_budget_fraction(target_percent: f64) -> f64 {
    (100.0 - target_percent) / 100.0
}

/// Observed bad ratio over a window; None when there is no traffic.
pub fn window_bad_ratio(good: f64, valid: f64) -> Option<f64> {
    if valid <= 0.0 {
        return None;
    }
    Some((1.0 - good / valid).clamp(0.0, 1.0))
}

/// Normalized burn rate: bad_ratio / error_budget. None at zero traffic.
pub fn burn_rate(good: f64, valid: f64, target_percent: f64) -> Option<f64> {
    let bad = window_bad_ratio(good, valid)?;
    let budget = error_budget_fraction(target_percent);
    if budget <= 0.0 {
        return None; // target 100 has no budget; guarded at validation, defensive here
    }
    Some(bad / budget)
}

/// Fraction of the error budget still available over the whole window. May be
/// negative when the objective has been exceeded. None at zero traffic.
pub fn budget_remaining_fraction(
    good_total: f64,
    valid_total: f64,
    target_percent: f64,
) -> Option<f64> {
    let bad = window_bad_ratio(good_total, valid_total)?;
    let budget = error_budget_fraction(target_percent);
    if budget <= 0.0 {
        return None;
    }
    Some(1.0 - bad / budget)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowReq {
    /// Stable key like "300s" used to index the snapshot's per-window freshness map.
    pub name: String,
    pub secs: u64,
}

fn tiers_of(spec: &SloSpec) -> Vec<BurnRateTier> {
    spec.tiers.clone().unwrap_or_else(canonical_tiers)
}

/// The deduplicated set of windows the evaluator must query: every tier's long
/// and short window, plus the SLO's own timeWindow (the budget window).
pub fn required_windows(spec: &SloSpec) -> Vec<WindowReq> {
    let mut secs: std::collections::BTreeSet<u64> = std::collections::BTreeSet::new();
    for t in tiers_of(spec) {
        if let Ok(s) = parse_window_secs(&t.long_window) {
            secs.insert(s);
        }
        if let Ok(s) = parse_window_secs(&t.short_window) {
            secs.insert(s);
        }
    }
    if let Ok(s) = parse_window_secs(&spec.time_window.duration) {
        secs.insert(s);
    }
    secs.into_iter()
        .map(|s| WindowReq {
            name: format!("{s}s"),
            secs: s,
        })
        .collect()
}

/// Coordinated freshness: a window is recomputed when it has never been computed,
/// or when it is older than its refresh cadence. Refresh cadence grows with the
/// window length — short windows refresh at the base cadence, long windows far
/// less often — so a single evaluation tick only rescans the windows that moved.
/// Rule: refresh_cadence = max(base_cadence, window_secs / 12).
pub fn is_window_due(
    window_secs: u64,
    last_computed_unix: Option<i64>,
    now_unix: i64,
    base_cadence_secs: u64,
) -> bool {
    let Some(last) = last_computed_unix else {
        return true;
    };
    let refresh = base_cadence_secs.max(window_secs / 12);
    now_unix.saturating_sub(last) >= refresh as i64
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SloTierStatus {
    pub name: String,
    pub long_burn_rate: Option<f64>,
    pub short_burn_rate: Option<f64>,
    /// `valid` count over the tier's long window, for the min_valid_events floor.
    /// Additive (#[serde(default)]) so pre-existing snapshots still deserialize.
    #[serde(default)]
    pub long_window_valid: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SloGroupStatus {
    pub labels: BTreeMap<String, String>,
    pub sli: Option<f64>,
    pub budget_remaining: Option<f64>,
    pub tiers: Vec<SloTierStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SloStatusPayload {
    pub window: String,
    pub target_percent: f64,
    pub degraded: bool,
    pub groups: Vec<SloGroupStatus>,
    /// WindowReq.name -> unix seconds last computed (coordinated freshness ledger).
    pub window_computed_at: BTreeMap<String, i64>,
}

pub fn empty_payload(spec: &SloSpec) -> SloStatusPayload {
    SloStatusPayload {
        window: spec.time_window.duration.clone(),
        target_percent: spec.target_percent,
        degraded: false,
        groups: Vec::new(),
        window_computed_at: BTreeMap::new(),
    }
}

/// Seconds until the error budget is exhausted at the current burn rate:
/// t = remaining_fraction * window / burn_rate. None when burn <= 0 (nothing
/// burning); Some(0) when already over budget.
pub fn time_to_exhaustion_secs(
    budget_remaining: f64,
    burn_rate: f64,
    window_secs: u64,
) -> Option<u64> {
    if burn_rate <= 0.0 {
        return None;
    }
    if budget_remaining <= 0.0 {
        return Some(0);
    }
    Some((window_secs as f64 * budget_remaining / burn_rate) as u64)
}

pub fn fmt_burn(b: f64) -> String {
    format!("{b:.1}")
}
pub fn fmt_pct(f: f64) -> String {
    format!("{:.1}%", f * 100.0)
}

/// Compact human duration: largest two units of d/h/m/s.
pub fn fmt_duration_secs(secs: u64) -> String {
    let (d, r) = (secs / 86_400, secs % 86_400);
    let (h, r2) = (r / 3_600, r % 3_600);
    let (m, s) = (r2 / 60, r2 % 60);
    match (d, h, m) {
        (0, 0, 0) => format!("{s}s"),
        (0, 0, _) => format!("{m}m"),
        (0, _, _) if m > 0 => format!("{h}h{m}m"),
        (0, _, _) => format!("{h}h"),
        (_, _, _) if h > 0 => format!("{d}d{h}h"),
        _ => format!("{d}d"),
    }
}

/// (source, target) index pairs: earlier tiers inhibit later ones (spec §5).
pub fn tier_pairs(tiers: &[BurnRateTier]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for i in 0..tiers.len() {
        for j in (i + 1)..tiers.len() {
            out.push((i, j));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::slo::{SliSpec, TimeWindow};
    use proptest::prelude::*;
    use std::collections::BTreeMap;

    fn spec_with(tiers: Option<Vec<BurnRateTier>>, window: &str) -> SloSpec {
        SloSpec {
            sli: SliSpec {
                sql: "x".into(),
                label_columns: vec![],
            },
            target_percent: 99.9,
            time_window: TimeWindow {
                duration: window.into(),
                is_rolling: true,
                calendar: None,
            },
            min_valid_events: None,
            tiers,
            annotations: BTreeMap::new(),
            suppressed: false,
        }
    }

    #[test]
    fn error_budget_matches_definition() {
        assert!((error_budget_fraction(99.9) - 0.001).abs() < 1e-12);
        assert!((error_budget_fraction(99.0) - 0.01).abs() < 1e-12);
        assert!((error_budget_fraction(90.0) - 0.10).abs() < 1e-12);
    }

    #[test]
    fn burn_rate_canonical_example() {
        // 1.44% bad against a 0.1% budget = 14.4x
        let br = burn_rate(9856.0, 10000.0, 99.9).unwrap();
        assert!((br - 14.4).abs() < 1e-6, "got {br}");
    }

    #[test]
    fn zero_traffic_is_none_not_panic() {
        assert_eq!(burn_rate(0.0, 0.0, 99.9), None);
        assert_eq!(window_bad_ratio(0.0, 0.0), None);
        assert_eq!(budget_remaining_fraction(0.0, 0.0, 99.9), None);
    }

    #[test]
    fn budget_can_go_negative_over_budget() {
        // 100% bad against 0.1% budget -> hugely over budget -> strongly negative
        let rem = budget_remaining_fraction(0.0, 100.0, 99.9).unwrap();
        assert!(rem < 0.0);
        // exactly at budget -> ~0 remaining
        let rem = budget_remaining_fraction(999.0, 1000.0, 99.9).unwrap();
        assert!((rem - 0.0).abs() < 1e-6, "got {rem}");
        // perfect -> full budget
        let rem = budget_remaining_fraction(1000.0, 1000.0, 99.9).unwrap();
        assert!((rem - 1.0).abs() < 1e-12);
    }

    #[test]
    fn required_windows_dedup_union_of_tiers_and_budget() {
        let w = required_windows(&spec_with(None, "30d")); // canonical tiers
        let secs: std::collections::BTreeSet<u64> = w.iter().map(|r| r.secs).collect();
        // canonical: 5m,1h,30m,6h,6h,3d + budget 30d -> {300,1800,3600,21600,259200,2592000}
        for s in [300u64, 1800, 3600, 21600, 259200, 2_592_000] {
            assert!(secs.contains(&s), "missing {s}");
        }
        // 6h appears in two tiers but only once here
        assert_eq!(w.iter().filter(|r| r.secs == 21600).count(), 1);
    }

    #[test]
    fn freshness_short_windows_refresh_every_tick_long_windows_lag() {
        let now = 1_000_000i64;
        // short (5m) window with base cadence 60s: always due when >= base cadence old
        assert!(is_window_due(300, Some(now - 60), now, 60));
        assert!(is_window_due(300, None, now, 60)); // never computed -> due
                                                    // a 30d window computed 5 min ago is NOT due (its refresh cadence >> base)
        assert!(!is_window_due(2_592_000, Some(now - 300), now, 60));
        // but a 30d window computed 3 days ago IS due (refresh cadence is
        // window_secs/12 = 2.5 days, so 3 days exceeds it)
        assert!(is_window_due(2_592_000, Some(now - 259_200), now, 60));
    }

    #[test]
    fn empty_payload_carries_spec_metadata() {
        let p = empty_payload(&spec_with(None, "30d"));
        assert_eq!(p.window, "30d");
        assert_eq!(p.target_percent, 99.9);
        assert!(!p.degraded);
        assert!(p.groups.is_empty());
        assert!(p.window_computed_at.is_empty());
    }

    #[test]
    fn payload_json_roundtrips() {
        let p = SloStatusPayload {
            window: "30d".into(),
            target_percent: 99.9,
            degraded: false,
            groups: vec![SloGroupStatus {
                labels: std::collections::BTreeMap::from([("service".into(), "api".into())]),
                sli: Some(0.999),
                budget_remaining: Some(0.5),
                tiers: vec![SloTierStatus {
                    name: "fast-burn".into(),
                    long_burn_rate: Some(2.0),
                    short_burn_rate: Some(3.0),
                    long_window_valid: None,
                }],
            }],
            window_computed_at: std::collections::BTreeMap::from([("300s".into(), 1234i64)]),
        };
        let v = serde_json::to_value(&p).unwrap();
        let back: SloStatusPayload = serde_json::from_value(v).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn old_payload_without_long_window_valid_still_parses() {
        // Serialize a current payload, strip the new key, deserialize.
        let mut v = serde_json::to_value(SloTierStatus {
            name: "fast-burn".into(),
            long_burn_rate: Some(2.0),
            short_burn_rate: Some(3.0),
            long_window_valid: Some(100.0),
        })
        .unwrap();
        v.as_object_mut().unwrap().remove("long_window_valid");
        let back: SloTierStatus = serde_json::from_value(v).unwrap();
        assert_eq!(back.long_window_valid, None);
    }

    #[test]
    fn time_to_exhaustion_math() {
        // burn 1x over a 30d window with full budget -> exhausts in exactly the window.
        let w = 2_592_000u64;
        assert_eq!(time_to_exhaustion_secs(1.0, 1.0, w), Some(w));
        // burn 14.4x with half the budget left -> w * 0.5 / 14.4
        assert_eq!(
            time_to_exhaustion_secs(0.5, 14.4, w),
            Some((w as f64 * 0.5 / 14.4) as u64)
        );
        // exhausted already -> Some(0); no burn -> None
        assert_eq!(time_to_exhaustion_secs(-0.2, 2.0, w), Some(0));
        assert_eq!(time_to_exhaustion_secs(0.5, 0.0, w), None);
    }

    #[test]
    fn display_formatters() {
        assert_eq!(fmt_burn(14.4000001), "14.4");
        assert_eq!(fmt_pct(0.4192), "41.9%");
        assert_eq!(fmt_pct(-0.2), "-20.0%");
        assert_eq!(fmt_duration_secs(50), "50s");
        assert_eq!(fmt_duration_secs(35 * 60), "35m");
        assert_eq!(fmt_duration_secs(2 * 86400 + 4 * 3600), "2d4h");
    }

    #[test]
    fn tier_pairs_precedence_order() {
        let t = canonical_tiers();
        assert_eq!(tier_pairs(&t), vec![(0, 1), (0, 2), (1, 2)]);
    }

    proptest! {
        #[test]
        fn burn_rate_nonneg_and_monotonic(valid in 1u64..1_000_000, bad in 0u64..1_000_000, t in 50.0f64..99.999) {
            let bad = bad.min(valid);
            let good = (valid - bad) as f64;
            let br = burn_rate(good, valid as f64, t).unwrap();
            prop_assert!(br >= 0.0);
            // more bad events -> not-lower burn rate
            if bad < valid {
                let br2 = burn_rate(good - 1.0, valid as f64, t).unwrap();
                prop_assert!(br2 >= br - 1e-9);
            }
        }

        #[test]
        fn required_windows_secs_all_parse_and_positive(dur in prop::sample::select(vec!["7d","30d","90d"])) {
            let w = required_windows(&spec_with(None, dur));
            for r in &w { prop_assert!(r.secs > 0); }
            prop_assert!(w.iter().any(|r| r.secs == parse_window_secs(dur).unwrap()));
        }
    }
}
