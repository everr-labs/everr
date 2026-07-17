use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::ids::SloId;
use crate::domain::slo::{parse_window_secs, Slo, SloSpec};
use crate::stores::{SloCreate, SloUpdate};

fn tenant(state: &AppState, headers: &HeaderMap) -> Result<crate::domain::ids::TenantId, ApiError> {
    state
        .auth
        .tenant_from(headers)
        .ok_or(ApiError::Unauthorized)
}

#[derive(Deserialize)]
pub struct CreateSloBody {
    pub name: String,
    #[serde(flatten)]
    pub spec: SloSpec,
}

#[derive(Deserialize)]
pub struct UpdateSloBody {
    pub name: String,
    #[serde(flatten)]
    pub spec: SloSpec,
    pub version: Option<i64>,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSloBody>,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_name(&body.name)?;
    validate_slo_spec(&body.spec)?;
    match state
        .store
        .create_slo(t, &body.name, &body.spec)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
    {
        SloCreate::Created(slo) => Ok(Json(slo)),
        SloCreate::NameConflict => Err(ApiError::Conflict(format!(
            "SLO name {:?} already exists",
            body.name
        ))),
    }
}

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(&state, &headers)?;
    state
        .store
        .get_slo(t, SloId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Slo>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let slos = state
        .store
        .list_slos(&t)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(slos))
}

pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateSloBody>,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_name(&body.name)?;
    validate_slo_spec(&body.spec)?;
    let outcome = state
        .store
        .update_slo(t, SloId(id), &body.name, &body.spec, body.version)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    match outcome {
        SloUpdate::Updated(slo) => Ok(Json(slo)),
        SloUpdate::NotFound => Err(ApiError::NotFound),
        SloUpdate::VersionConflict { current } => Err(ApiError::Conflict(format!(
            "slo version mismatch: expected {}, current {current}",
            body.version.unwrap_or_default()
        ))),
        SloUpdate::NameConflict => Err(ApiError::Conflict(format!(
            "SLO name {:?} already exists",
            body.name
        ))),
    }
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .delete_slo(t, SloId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if ok {
        Ok(Json(json!({ "deleted": true })))
    } else {
        Err(ApiError::NotFound)
    }
}

pub async fn pause(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .pause_slo(t.clone(), SloId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if !ok {
        return Err(ApiError::NotFound);
    }
    state
        .store
        .get_slo(t, SloId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

pub async fn resume(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state
        .store
        .resume_slo(t.clone(), SloId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if !ok {
        return Err(ApiError::NotFound);
    }
    state
        .store
        .get_slo(t, SloId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

/// Read-only view of the evaluator's latest status snapshot for an SLO
/// (Task 8's `slo_status` row), returned verbatim: no derived/filtered
/// fields are added here.
#[derive(serde::Serialize)]
pub struct SloStatusOut {
    #[serde(with = "time::serde::rfc3339")]
    pub computed_at: time::OffsetDateTime,
    pub payload: Value,
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<SloStatusOut>, ApiError> {
    let t = tenant(&state, &headers)?;
    let row = state
        .store
        .get_slo_status(&t, SloId(id))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(SloStatusOut {
        computed_at: row.computed_at,
        payload: row.payload,
    }))
}

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
pub(crate) fn validate_slo_spec(spec: &SloSpec) -> Result<(), ApiError> {
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
pub(crate) fn validate_name(name: &str) -> Result<(), ApiError> {
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

    #[test]
    fn strip_ch_params_replaces_balanced_spans_with_zero() {
        assert_eq!(
            strip_ch_params("SELECT {window_start:DateTime}"),
            "SELECT 0"
        );
        assert_eq!(strip_ch_params("{a:Int}-{b:Int}"), "0-0"); // multiple/adjacent
        assert_eq!(strip_ch_params("{}"), "0"); // empty braces
        assert_eq!(strip_ch_params("no params here"), "no params here");
    }

    #[test]
    fn strip_ch_params_fails_safe_on_unmatched_brace() {
        // An unmatched trailing '{' is left intact, so sqlguard::validate will
        // fail to parse it -> reject, never silently smuggle.
        assert_eq!(strip_ch_params("SELECT {a"), "SELECT {a");
        let s = spec("SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end");
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn strip_ch_params_does_not_let_a_second_statement_through_the_guard() {
        // Content inside a brace pair is nulled to "0" for the shape check;
        // a top-level ';' second statement outside braces is still rejected.
        let s = spec("SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}; DROP TABLE t");
        assert!(validate_slo_spec(&s).is_err());
    }

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
