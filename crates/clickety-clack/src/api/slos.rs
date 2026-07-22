use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::AppState;
use crate::domain::ids::SloId;
use crate::domain::instance::{InstanceState, Status};
use crate::domain::slo::{parse_window_secs, Slo, SloSpec, RESERVED_SLO_LABELS, SLO_TIER_LABEL};
use crate::engine::slo_math::{time_to_exhaustion_secs, SloStatusPayload};
use crate::stores::{SloCreate, SloUpdate};

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
    match state.store.create_slo(t, &body.name, &body.spec).await? {
        SloCreate::Created(slo) => Ok(Json(slo)),
        SloCreate::NameConflict => Err(ApiError::Conflict(format!(
            "SLO name {:?} already exists",
            body.name
        ))),
    }
}

/// SLO representation with its `updated_at` and `budget_epoch`, returned by GET
/// and list (the SLO analogue of [`crate::api::rules::RuleView`]). Both are store
/// bookkeeping, so they live on the read view only: create/update/pause/resume
/// keep returning the bare [`Slo`]. `updated_at` is the last write of any kind;
/// `budget_epoch` is when the error budget last began (creation, or the last
/// budget-significant edit), which the budget-over-time chart uses to divide
/// reconstructed history from the real, observed budget.
#[derive(serde::Serialize)]
pub struct SloView {
    #[serde(flatten)]
    slo: Slo,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: time::OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    budget_epoch: time::OffsetDateTime,
}

impl From<(Slo, time::OffsetDateTime, time::OffsetDateTime)> for SloView {
    fn from(
        (slo, updated_at, budget_epoch): (Slo, time::OffsetDateTime, time::OffsetDateTime),
    ) -> Self {
        SloView {
            slo,
            updated_at,
            budget_epoch,
        }
    }
}

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<SloView>, ApiError> {
    let t = tenant(&state, &headers)?;
    state
        .store
        .get_slo(t, SloId(id))
        .await?
        .map(|row| Json(row.into()))
        .ok_or(ApiError::NotFound)
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<SloView>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let slos = state.store.list_slos(&t).await?;
    Ok(Json(slos.into_iter().map(Into::into).collect()))
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
        .await?;
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
    let ok = state.store.delete_slo(t, SloId(id)).await?;
    crate::api::deleted(ok)
}

/// Shared body of `pause`/`resume`: flip the paused flag, then return the
/// stored SLO. A miss on either step is a 404.
async fn set_paused(
    state: &AppState,
    headers: &HeaderMap,
    id: SloId,
    pause: bool,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(state, headers)?;
    let ok = if pause {
        state.store.pause_slo(t.clone(), id).await?
    } else {
        state.store.resume_slo(t.clone(), id).await?
    };
    if !ok {
        return Err(ApiError::NotFound);
    }
    state
        .store
        .get_slo(t, id)
        .await?
        .map(|(slo, _updated_at, _budget_epoch)| Json(slo))
        .ok_or(ApiError::NotFound)
}

pub async fn pause(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Slo>, ApiError> {
    set_paused(&state, &headers, SloId(id), true).await
}

pub async fn resume(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Slo>, ApiError> {
    set_paused(&state, &headers, SloId(id), false).await
}

/// Read-only view of the evaluator's latest status snapshot for an SLO
/// (the `slo_status` row, see [`crate::stores::pg::SloStatusRow`]). `payload`
/// is the stored snapshot enriched at read time only (see [`enrich_status_payload`]):
/// the stored row itself is never written back. `health` is a sibling read
/// from the `slos` row itself (see [`crate::stores::SloHealth`]).
#[derive(serde::Serialize)]
pub struct SloStatusOut {
    #[serde(with = "time::serde::rfc3339")]
    pub computed_at: time::OffsetDateTime,
    pub payload: Value,
    pub health: crate::stores::SloHealth,
}

/// `POST /v1/slos/:id/test`: a dry-run probe (`:id` is ignored, like
/// `rules::test`). Validates the posted spec, runs the SLI query over the
/// spec's own budget window against ClickHouse, and returns the per-group
/// results -- no DB write, no snapshot.
pub async fn test(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(_id): Path<Uuid>,
    Json(body): Json<CreateSloBody>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_slo_spec(&body.spec)?;
    let now = time::OffsetDateTime::now_utc();
    let secs = parse_window_secs(&body.spec.time_window.duration)
        .map_err(|e| ApiError::Validation(e.to_string()))?;
    // Defensive: `validate_slo_spec` above already caps this to `MAX_WINDOW_SECS`, so
    // this is unreachable for specs accepted by validation. Kept anyway because
    // `OffsetDateTime - Duration` PANICS on overflow and this is the second of the
    // two panic sites (see `evaluator::slo::evaluate_slo`).
    let secs_i64 = i64::try_from(secs)
        .map_err(|_| ApiError::Validation("window duration out of range".into()))?;
    let start = now
        .checked_sub(time::Duration::seconds(secs_i64))
        .ok_or_else(|| ApiError::Validation("window duration out of range".into()))?;
    let params = vec![
        (
            "window_start".to_string(),
            crate::evaluator::slo::fmt_ch_datetime(start),
        ),
        (
            "window_end".to_string(),
            crate::evaluator::slo::fmt_ch_datetime(now),
        ),
    ];
    let rows = state
        .ch
        .query_rows_params(
            &t,
            &body.spec.sli.sql,
            &params,
            &body.spec.sli.label_columns,
            Some("valid"),
        )
        .await
        .map_err(|e| ApiError::Validation(format!("query failed: {e}")))?;
    let groups: Vec<Value> = rows
        .iter()
        .map(|r| {
            let valid = r.value.unwrap_or(0.0);
            let good = r.extra.get("good").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let sli = if valid > 0.0 {
                Some(good / valid)
            } else {
                None
            };
            json!({ "labels": r.labels, "good": good, "valid": valid, "sli": sli })
        })
        .collect();
    Ok(Json(json!({ "matched": groups.len(), "groups": groups })))
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<SloStatusOut>, ApiError> {
    let t = tenant(&state, &headers)?;
    // Three independent reads, issued concurrently. 404 stays keyed on the
    // snapshot row (checked first below); health is a sibling read that the
    // snapshot's existence already guarantees in practice.
    let (row, health, instances) = tokio::try_join!(
        state.store.get_slo_status(&t, SloId(id)),
        state.store.get_slo_health(&t, SloId(id)),
        state.store.load_slo_instances(&t, SloId(id)),
    )?;
    let row = row.ok_or(ApiError::NotFound)?;
    let health = health.ok_or(ApiError::NotFound)?;
    let payload = enrich_status_payload(row.payload, &instances);
    Ok(Json(SloStatusOut {
        computed_at: row.computed_at,
        payload,
        health,
    }))
}

/// Read-time-only enrichment of the stored `slo_status` snapshot for the
/// `/status` response (spec §8.2): each `payload.groups[*]` gains
/// `time_to_exhaustion_secs` (projected from the group's current budget/burn)
/// and `firing_tiers` (the group's currently non-inactive burn-rate-tier
/// instances). Nothing computed here is written back to the stored row.
///
/// If the stored payload doesn't deserialize as `SloStatusPayload` (a legacy
/// or corrupt row), the raw payload is served unmodified instead of erroring:
/// the read path must not 500 on old data.
fn enrich_status_payload(raw: Value, instances: &[InstanceState]) -> Value {
    let payload: SloStatusPayload = match SloStatusPayload::deserialize(&raw) {
        Ok(p) => p,
        Err(_) => return raw,
    };
    let budget_window_secs = parse_window_secs(&payload.window).ok();

    // One pass over the instances: bucket each non-inactive tier instance under
    // its labels minus the injected `slo_tier` discriminator, keeping the
    // stored instance order within each bucket.
    let mut tiers_by_labels: HashMap<BTreeMap<String, String>, Vec<Value>> = HashMap::new();
    for inst in instances.iter().filter(|i| i.status != Status::Inactive) {
        let mut labels = inst.labels.clone();
        let Some(tier) = labels.remove(SLO_TIER_LABEL) else {
            continue;
        };
        tiers_by_labels.entry(labels).or_default().push(json!({
            "tier": tier,
            "status": serde_json::to_value(inst.status).unwrap_or(Value::Null),
        }));
    }

    let mut out = serde_json::to_value(&payload).unwrap_or(raw);
    if let Some(groups) = out.get_mut("groups").and_then(Value::as_array_mut) {
        for (g, v) in payload.groups.iter().zip(groups) {
            let firing_tiers = tiers_by_labels.get(&g.labels).cloned().unwrap_or_default();
            // The exhaustion horizon is projected from the current spend rate: the
            // fastest tier with a computed long-window burn (tiers are stored
            // fastest-first, in `BASE_TIERS` order via `tiers_for_spec`), taking its
            // `min(long, short)`. That min drops to 0 the moment spending stops, so a
            // budget recovering after a burst shows no horizon even while a slower
            // tier still fires on it. Mirrors the frontend's `ccSloCurrentBurn`.
            let current_burn = g
                .tiers
                .iter()
                .find(|tier| tier.long_burn_rate.is_some())
                .and_then(|tier| match (tier.long_burn_rate, tier.short_burn_rate) {
                    (Some(long), Some(short)) => Some(long.min(short)),
                    _ => None,
                });
            let tte = match (g.budget_remaining, current_burn, budget_window_secs) {
                (Some(budget), Some(burn), Some(window_secs)) => {
                    time_to_exhaustion_secs(budget, burn, window_secs)
                }
                _ => None,
            };
            if let Some(obj) = v.as_object_mut() {
                obj.insert("time_to_exhaustion_secs".into(), json!(tte));
                obj.insert("firing_tiers".into(), json!(firing_tiers));
            }
        }
    }
    out
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

/// Upper bound on any window duration (the SLO's `timeWindow.duration` and every
/// tier's `long_window`/`short_window`): 366 days, i.e. `366 * 86_400` seconds.
/// Two reasons: (a) product bound — rolling windows are meant to cover up to
/// about a year, never longer; (b) safety bound — the evaluator computes
/// `eval_ts - Duration::seconds(secs)` via `time::OffsetDateTime`, which PANICS
/// if the result falls outside the representable year range (±9999). Capping
/// every window here keeps that subtraction always in range for any spec that
/// passes validation.
const MAX_WINDOW_SECS: u64 = 366 * 86_400;

/// Lower bound on the SLO's `timeWindow.duration`: 1 day. The burn-rate tiers are
/// scaled to the budget window (`domain::slo::tiers_for_window`); at exactly a day
/// the fast- and slow-burn tiers already collapse onto the same short-window floor,
/// and below a day all three merge, so the multi-window method can no longer
/// separate a fast page from a slow ticket by timescale. Sub-day monitoring is a
/// threshold rule's job, not an error-budget SLO's, so reject the window rather
/// than evaluate a degenerate tier set.
const MIN_WINDOW_SECS: u64 = 86_400;

fn validate_window_secs(dur: &str) -> Result<u64, ApiError> {
    let secs = parse_window_secs(dur).map_err(|e| ApiError::Validation(e.to_string()))?;
    if secs > MAX_WINDOW_SECS {
        return Err(ApiError::Validation(format!(
            "window duration {dur:?} exceeds the maximum of 366 days ({MAX_WINDOW_SECS} seconds)"
        )));
    }
    if secs < MIN_WINDOW_SECS {
        return Err(ApiError::Validation(format!(
            "window duration {dur:?} is below the minimum of 1 day ({MIN_WINDOW_SECS} seconds)"
        )));
    }
    Ok(secs)
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
    validate_window_secs(&spec.time_window.duration)?;

    // 5. Reserved label prefix (mirrors rule validation).
    crate::api::reject_reserved_label_columns(&spec.sli.label_columns)?;
    // `slo` and `slo_tier` are injected by the pipeline itself (the synthetic
    // `slo` routing label and the per-tier instance discriminator), so a user
    // label column with either name would be silently clobbered.
    if let Some(col) = spec
        .sli
        .label_columns
        .iter()
        .find(|c| RESERVED_SLO_LABELS.contains(&c.as_str()))
    {
        return Err(ApiError::Validation(format!(
            "label column {col:?} collides with a label the SLO pipeline injects \
             (\"slo\", \"slo_tier\"); pick a different column alias"
        )));
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
    use crate::domain::slo::{SliSpec, TimeWindow};
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
    fn rejects_pipeline_injected_label_names() {
        for reserved in RESERVED_SLO_LABELS {
            let mut s = spec(GOOD_SQL);
            s.sli.label_columns = vec!["service".into(), reserved.into()];
            let err = validate_slo_spec(&s).unwrap_err();
            let ApiError::Validation(msg) = err else {
                panic!("expected Validation, got {err:?}")
            };
            assert!(msg.contains(reserved), "message was: {msg}");
        }
        // A merely similar name stays allowed.
        let mut s = spec(GOOD_SQL);
        s.sli.label_columns = vec!["slo_name".into()];
        assert!(validate_slo_spec(&s).is_ok());
    }

    #[test]
    fn accepts_window_at_the_366_day_cap() {
        let mut s = spec(GOOD_SQL);
        s.time_window.duration = "366d".into();
        assert!(validate_slo_spec(&s).is_ok());
    }

    #[test]
    fn rejects_time_window_duration_over_the_cap() {
        let mut s = spec(GOOD_SQL);
        s.time_window.duration = "700000w".into();
        let err = validate_slo_spec(&s).unwrap_err();
        let ApiError::Validation(msg) = err else {
            panic!("expected Validation, got {err:?}")
        };
        assert!(msg.contains("700000w"), "message was: {msg}");
        assert!(msg.contains("366"), "message was: {msg}");
    }

    #[test]
    fn accepts_window_at_the_one_day_minimum() {
        let mut s = spec(GOOD_SQL);
        s.time_window.duration = "1d".into();
        assert!(validate_slo_spec(&s).is_ok());
    }

    #[test]
    fn rejects_time_window_duration_below_the_minimum() {
        // Below a day the scaled burn tiers collapse onto the short-window floor
        // (see `tiers_for_window`); reject rather than evaluate a degenerate set.
        let mut s = spec(GOOD_SQL);
        s.time_window.duration = "12h".into();
        let err = validate_slo_spec(&s).unwrap_err();
        let ApiError::Validation(msg) = err else {
            panic!("expected Validation, got {err:?}")
        };
        assert!(msg.contains("12h"), "message was: {msg}");
        assert!(msg.contains("minimum"), "message was: {msg}");
    }

    #[test]
    fn name_rules() {
        assert!(validate_name("checkout-availability").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("has space").is_err());
        assert!(validate_name(&"x".repeat(129)).is_err());
    }
}
