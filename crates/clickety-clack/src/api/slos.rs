use crate::api::error::ApiError;
use crate::domain::slo::{parse_window_secs, SloSpec};

/// Replace each ClickHouse-native `{name:Type}` query parameter with a
/// harmless numeric literal. `sqlguard::validate` parses SQL with
/// `sqlparser`'s `ClickHouseDialect`, which does not tokenize this
/// parameter syntax, so the substitution is scratch-only: it exists solely
/// to let the guard check statement shape (single read-only SELECT). The
/// placeholder-presence check in `validate_slo_spec` runs against the
/// original, unmodified SQL.
fn strip_ch_params(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut rest = sql;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        match rest.find('}') {
            Some(end) => {
                out.push('0');
                rest = &rest[end + 1..];
            }
            None => break,
        }
    }
    out.push_str(rest);
    out
}

/// Static validation for an SLO spec — never touches ClickHouse. Column
/// presence (`good`/`valid`) is validated at evaluation/test time (Plan 2).
pub fn validate_slo_spec(spec: &SloSpec) -> Result<(), ApiError> {
    // 1. SLI SQL must be a single read-only SELECT.
    crate::sqlguard::validate(&strip_ch_params(&spec.sli.sql))
        .map_err(|e| ApiError::Validation(e.to_string()))?;

    // 2. Both window placeholders must be present, else the window has no effect.
    let sql = &spec.sli.sql;
    if !sql.contains("{window_start:") || !sql.contains("{window_end:") {
        return Err(ApiError::Validation(
            "SLI sql must reference both {window_start:DateTime} and {window_end:DateTime}".into(),
        ));
    }

    // 3. Objective range.
    if !(spec.target_percent > 0.0 && spec.target_percent < 100.0) {
        return Err(ApiError::Validation(format!(
            "targetPercent must be > 0 and < 100 (got {})",
            spec.target_percent
        )));
    }

    // 4. v1 is rolling only.
    if !spec.time_window.is_rolling || spec.time_window.calendar.is_some() {
        return Err(ApiError::Validation(
            "calendar-aligned windows are not supported in v1 (set isRolling: true, omit calendar)"
                .into(),
        ));
    }
    parse_window_secs(&spec.time_window.duration)
        .map_err(|e| ApiError::Validation(e.to_string()))?;

    // 5. Reserved label prefix (mirrors rule validation).
    if let Some(col) = spec
        .sli
        .label_columns
        .iter()
        .find(|c| c.starts_with("__cc_"))
    {
        return Err(ApiError::Validation(format!(
            "label column {col:?} uses the reserved \"__cc_\" prefix"
        )));
    }

    // 6. Explicit tiers, if given, must be well-formed.
    if let Some(tiers) = &spec.tiers {
        if tiers.is_empty() {
            return Err(ApiError::Validation(
                "tiers, if present, must be non-empty".into(),
            ));
        }
        for t in tiers {
            if t.name.trim().is_empty() {
                return Err(ApiError::Validation("tier name must not be empty".into()));
            }
            if t.burn_rate.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
                return Err(ApiError::Validation(format!(
                    "tier {:?} burn_rate must be > 0",
                    t.name
                )));
            }
            let long = parse_window_secs(&t.long_window)
                .map_err(|e| ApiError::Validation(e.to_string()))?;
            let short = parse_window_secs(&t.short_window)
                .map_err(|e| ApiError::Validation(e.to_string()))?;
            if long <= short {
                return Err(ApiError::Validation(format!(
                    "tier {:?} long_window must be greater than short_window",
                    t.name
                )));
            }
        }
    }

    Ok(())
}

/// A tenant-unique SLO name: 1..=128 chars, `[A-Za-z0-9_.-]`.
pub fn validate_name(name: &str) -> Result<(), ApiError> {
    let ok = (1..=128).contains(&name.len())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if ok {
        Ok(())
    } else {
        Err(ApiError::Validation(
            "name must be 1-128 chars of [A-Za-z0-9_.-]".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::slo::{canonical_tiers, SliSpec, TimeWindow};
    use std::collections::BTreeMap;

    fn spec(sql: &str) -> SloSpec {
        SloSpec {
            sli: SliSpec {
                sql: sql.into(),
                label_columns: vec![],
            },
            target_percent: 99.9,
            time_window: TimeWindow {
                duration: "30d".into(),
                is_rolling: true,
                calendar: None,
            },
            min_valid_events: None,
            tiers: None,
            annotations: BTreeMap::new(),
            suppressed: false,
        }
    }

    const GOOD_SQL: &str = "SELECT countIf(ok) AS good, count() AS valid FROM t \
         WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";

    #[test]
    fn accepts_a_well_formed_spec() {
        assert!(validate_slo_spec(&spec(GOOD_SQL)).is_ok());
    }

    #[test]
    fn rejects_non_select_sql() {
        let s = spec(
            "DELETE FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
        );
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn rejects_missing_window_placeholders() {
        // valid SELECT but no window params -> would scan the whole table
        let s = spec("SELECT countIf(ok) AS good, count() AS valid FROM t");
        let err = validate_slo_spec(&s).unwrap_err();
        assert!(matches!(err, ApiError::Validation(_)));
    }

    #[test]
    fn rejects_missing_only_one_placeholder() {
        let s = spec("SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime}");
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn rejects_target_percent_out_of_range() {
        let mut s = spec(GOOD_SQL);
        s.target_percent = 0.0;
        assert!(validate_slo_spec(&s).is_err());
        s.target_percent = 100.0;
        assert!(validate_slo_spec(&s).is_err());
        s.target_percent = 150.0;
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn rejects_calendar_window_in_v1() {
        let mut s = spec(GOOD_SQL);
        s.time_window.is_rolling = false;
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn rejects_unparseable_window_duration() {
        let mut s = spec(GOOD_SQL);
        s.time_window.duration = "1M".into(); // calendar unit
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn rejects_reserved_label_prefix() {
        let mut s = spec(GOOD_SQL);
        s.sli.label_columns = vec!["__cc_x".into()];
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn rejects_bad_tier_windows() {
        let mut s = spec(GOOD_SQL);
        let mut tiers = canonical_tiers();
        tiers[0].long_window = "5m".into(); // long !> short (both 5m)
        s.tiers = Some(tiers);
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn accepts_explicit_valid_tiers() {
        let mut s = spec(GOOD_SQL);
        s.tiers = Some(canonical_tiers());
        assert!(validate_slo_spec(&s).is_ok());
    }

    #[test]
    fn name_rules() {
        assert!(validate_name("checkout-availability").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("has space").is_err());
        assert!(validate_name(&"x".repeat(129)).is_err());
    }
}
