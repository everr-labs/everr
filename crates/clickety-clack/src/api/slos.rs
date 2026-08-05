use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::identity::{validate_name, validate_namespace};
use crate::api::AppState;
use crate::domain::ids::SloId;
use crate::domain::instance::{InstanceState, Status};
use crate::domain::slo::{parse_window_secs, Slo, SloSpec, SLO_TIER_LABEL};
use crate::engine::slo_math::{time_to_exhaustion_secs, SloStatusPayload};
use crate::stores::{SloCreate, SloUpdate};

#[derive(Deserialize)]
pub struct CreateSloBody {
    pub name: String,
    #[serde(default)]
    pub namespace: String,
    #[serde(flatten)]
    pub spec: SloSpec,
}

#[derive(Deserialize)]
pub struct UpdateSloBody {
    #[serde(flatten)]
    pub spec: SloSpec,
    pub version: Option<i64>,
}

/// Optional identity filters (exact match) for `GET /v1/slos`.
#[derive(Deserialize)]
pub struct SloListParams {
    pub namespace: Option<String>,
    pub name: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSloBody>,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_name(&body.name)?;
    validate_namespace(&body.namespace)?;
    validate_slo_spec(&body.spec)?;
    match state
        .store
        .create_slo(t, &body.namespace, &body.name, &body.spec)
        .await?
    {
        SloCreate::Created(slo) => Ok(Json(slo)),
        SloCreate::NameConflict => Err(ApiError::AlreadyExists(format!(
            "SLO name {:?} already exists in namespace {:?}",
            body.name, body.namespace
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
    Query(params): Query<SloListParams>,
) -> Result<Json<Vec<SloView>>, ApiError> {
    let t = tenant(&state, &headers)?;
    let slos = state
        .store
        .list_slos(&t, params.namespace.as_deref(), params.name.as_deref())
        .await?;
    Ok(Json(slos.into_iter().map(Into::into).collect()))
}

pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateSloBody>,
) -> Result<Json<Slo>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_slo_spec(&body.spec)?;
    let outcome = state
        .store
        .update_slo(t, SloId(id), &body.spec, body.version)
        .await?;
    match outcome {
        SloUpdate::Updated(slo) => Ok(Json(slo)),
        SloUpdate::NotFound => Err(ApiError::NotFound),
        SloUpdate::VersionConflict { current } => Err(ApiError::Conflict(format!(
            "slo version mismatch: expected {}, current {current}",
            body.version.unwrap_or_default()
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
    /// Null until the first evaluation writes a snapshot (the pending state).
    #[serde(with = "time::serde::rfc3339::option")]
    pub computed_at: Option<time::OffsetDateTime>,
    pub payload: Value,
    pub health: crate::stores::SloHealth,
}

/// `POST /v1/slos/test`: a dry-run probe. Validates the posted spec (the bare
/// spec, no identity: nothing is written, so none is needed), runs the SLI
/// query over the spec's own budget window against ClickHouse, with the window
/// bounded by [`sli_window_bounds`](crate::evaluator::slo::sli_window_bounds)
/// exactly as the evaluator bounds it, and returns the scalar SLI result, with no
/// DB write, no snapshot.
pub async fn test(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(spec): Json<SloSpec>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_slo_spec(&spec)?;
    let now = time::OffsetDateTime::now_utc();
    let secs = parse_window_secs(&spec.time_window.duration)
        .map_err(|e| ApiError::Validation(e.to_string()))?;
    let (start, end) =
        crate::evaluator::slo::sli_window_bounds(now, secs, state.slo_ingest_delay_secs)
            .map_err(ApiError::Validation)?;
    let params = vec![
        (
            "window_start".to_string(),
            crate::evaluator::slo::fmt_ch_datetime(start),
        ),
        (
            "window_end".to_string(),
            crate::evaluator::slo::fmt_ch_datetime(end),
        ),
    ];
    let rows = state
        .ch
        .query_rows_params(&t, &spec.sli.sql, &params, &[], Some("valid"))
        .await
        .map_err(|e| ApiError::Validation(format!("query failed: {e}")))?;
    let (good, valid) = match rows.as_slice() {
        [] => (0.0, 0.0),
        [row] => (
            row.extra.get("good").and_then(Value::as_f64).unwrap_or(0.0),
            row.value.unwrap_or(0.0),
        ),
        _ => {
            return Err(ApiError::Validation(
                "SLI query must return at most one row".into(),
            ))
        }
    };
    let sli = (valid > 0.0).then_some(good / valid);
    Ok(Json(json!({ "good": good, "valid": valid, "sli": sli })))
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<SloStatusOut>, ApiError> {
    let t = tenant(&state, &headers)?;
    // Three independent reads, issued concurrently. 404 is keyed on the health
    // read (the `slos` row itself, so it tracks the SLO's existence); a missing
    // snapshot row just means no evaluation has landed yet, which is the
    // pending state (`computed_at`/`payload` null), not an error.
    let (row, health, instances) = tokio::try_join!(
        state.store.get_slo_status(&t, SloId(id)),
        state.store.get_slo_health(&t, SloId(id)),
        state.store.load_slo_instances(&t, SloId(id)),
    )?;
    let health = health.ok_or(ApiError::NotFound)?;
    let (computed_at, payload) = match row {
        Some(row) => (
            Some(row.computed_at),
            enrich_status_payload(row.payload, &instances),
        ),
        None => (None, Value::Null),
    };
    Ok(Json(SloStatusOut {
        computed_at,
        payload,
        health,
    }))
}

/// Read-time-only enrichment of the stored `slo_status` snapshot for the
/// `/status` response: the payload gains `time_to_exhaustion_secs` and the
/// currently non-inactive burn-rate tier instances. Nothing computed here is
/// written back to the stored row.
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

    let firing_tiers: Vec<Value> = instances
        .iter()
        .filter(|i| i.status != Status::Inactive)
        .filter_map(|inst| {
            inst.labels.get(SLO_TIER_LABEL).map(|tier| {
                json!({
                "tier": tier,
                "status": serde_json::to_value(inst.status).unwrap_or(Value::Null),
                })
            })
        })
        .collect();

    let mut out = serde_json::to_value(&payload).unwrap_or(raw);
    let current_burn = payload
        .tiers
        .iter()
        .find(|tier| tier.long_burn_rate.is_some())
        .and_then(|tier| match (tier.long_burn_rate, tier.short_burn_rate) {
            (Some(long), Some(short)) => Some(long.min(short)),
            _ => None,
        });
    let tte = match (payload.budget_remaining, current_burn, budget_window_secs) {
        (Some(budget), Some(burn), Some(window_secs)) => {
            time_to_exhaustion_secs(budget, burn, window_secs)
        }
        _ => None,
    };
    if let Some(obj) = out.as_object_mut() {
        obj.insert("time_to_exhaustion_secs".into(), json!(tte));
        obj.insert("firing_tiers".into(), json!(firing_tiers));
    }
    out
}

/// Whether a span of SQL is executable code or something the parser treats as opaque.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SpanKind {
    Code,
    /// A comment (body and delimiters) or a quoted string/identifier, quotes included.
    NotCode,
}

/// Split `sql` into alternating code and non-code spans, concatenating back to the
/// input exactly.
///
/// Both callers below need the same notion of "which characters are really SQL", and
/// getting it right in only one of them is a bug: ClickHouse binds `{name:Type}` at the
/// token level, so a brace inside a string literal is ordinary text, and a scanner that
/// misses that can be steered by rule-authored SQL.
///
/// Recognized comment forms are `--` and `#` to end of line and `/* ... */` blocks
/// (unterminated running to end of input); literal forms are single-quoted strings and
/// double-quoted / backtick-quoted identifiers, each honoring both backslash and
/// doubled-quote escaping.
fn sql_spans(sql: &str) -> Vec<(SpanKind, String)> {
    fn flush(code: &mut String, out: &mut Vec<(SpanKind, String)>) {
        if !code.is_empty() {
            out.push((SpanKind::Code, std::mem::take(code)));
        }
    }

    let chars: Vec<char> = sql.chars().collect();
    let n = chars.len();
    let mut out: Vec<(SpanKind, String)> = Vec::new();
    let mut code = String::new();
    let mut i = 0;
    while i < n {
        let c = chars[i];
        // Line comment: `--` or `#` to the next newline (the newline stays code).
        if (c == '-' && chars.get(i + 1) == Some(&'-')) || c == '#' {
            flush(&mut code, &mut out);
            let start = i;
            while i < n && chars[i] != '\n' {
                i += 1;
            }
            out.push((SpanKind::NotCode, chars[start..i].iter().collect()));
            continue;
        }
        // Block comment: `/* ... */`.
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            flush(&mut code, &mut out);
            let start = i;
            while i < n && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            if i < n {
                i += 2; // the closing `*/`
            }
            out.push((SpanKind::NotCode, chars[start..i].iter().collect()));
            continue;
        }
        // Quoted string (`'`) or quoted identifier (`"` / backtick).
        if c == '\'' || c == '"' || c == '`' {
            flush(&mut code, &mut out);
            let start = i;
            i += 1;
            while i < n {
                let d = chars[i];
                if d == '\\' && i + 1 < n {
                    i += 2;
                    continue;
                }
                if d == c {
                    // A doubled quote is an escaped quote, not the close.
                    if chars.get(i + 1) == Some(&c) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push((SpanKind::NotCode, chars[start..i].iter().collect()));
            continue;
        }
        code.push(c);
        i += 1;
    }
    flush(&mut code, &mut out);
    out
}

/// Replace each ClickHouse-native `{name:Type}` query parameter with a
/// harmless numeric literal. `sqlguard::validate` parses SQL with
/// `sqlparser`'s `ClickHouseDialect`, which does not tokenize this
/// parameter syntax, so the substitution is scratch-only: it exists solely
/// to let the guard check statement shape (single read-only SELECT). The
/// placeholder-presence check in `validate_slo_spec` runs against the
/// [comment- and literal-stripped][sql_without_comments_and_literals] SQL.
///
/// Substitution happens only in code spans. A brace inside a string literal is
/// ordinary text, and treating it as the start of a placeholder is exploitable: the
/// span would run to the next `}` anywhere later in the SQL, deleting everything
/// between (statement separators included) from the copy the guard checks, while the
/// stored SQL that actually runs still contains it.
fn strip_ch_params(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    for (kind, text) in sql_spans(sql) {
        if kind == SpanKind::NotCode {
            out.push_str(&text);
            continue;
        }
        let mut rest = text.as_str();
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
    }
    out
}

/// A copy of `sql` with comment bodies and quoted-literal contents blanked to spaces,
/// so a substring search sees only executable SQL. ClickHouse binds `{name:Type}`
/// query parameters at the token level, never inside a comment or a string/identifier
/// literal, so a placeholder that appears only there is inert: the window filter would
/// silently drop and the SLO would scan its whole table. Spans are blanked in place
/// (not deleted), so this can never fabricate a `{...}` span by splicing text across a
/// stripped region.
fn sql_without_comments_and_literals(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    for (kind, text) in sql_spans(sql) {
        match kind {
            SpanKind::Code => out.push_str(&text),
            SpanKind::NotCode => out.extend(std::iter::repeat_n(' ', text.chars().count())),
        }
    }
    out
}

/// Upper bound on the SLO's `timeWindow.duration` (and, via proportional scaling, every
/// derived tier window): 366 days. Rolling windows are meant to cover up to about a year,
/// and the cap doubles as a safety bound: the evaluator computes
/// `eval_ts - Duration::seconds(secs)`, which panics if the result leaves the range
/// `OffsetDateTime` can represent (±9999).
const MAX_WINDOW_SECS: u64 = 366 * 86_400;

/// Lower bound on the SLO's `timeWindow.duration`: 1 day. Burn-rate tiers scale to the
/// budget window (`domain::slo::tiers_for_window`); at exactly a day two of them collapse
/// onto the short-window floor, still leaving a page/ticket split, and below a day all
/// three merge into one. A single tier cannot separate a fast page from a slow ticket by
/// timescale, so sub-day windows are rejected rather than evaluated: that granularity is a
/// threshold rule's job.
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

/// Static validation for an SLO spec; never touches ClickHouse. Column presence
/// (`good`/`valid`) is validated at evaluation/test time.
pub(crate) fn validate_slo_spec(spec: &SloSpec) -> Result<(), ApiError> {
    // 1. SLI SQL must be a single read-only SELECT.
    crate::sqlguard::validate(&strip_ch_params(&spec.sli.sql))
        .map_err(|e| ApiError::Validation(e.to_string()))?;

    // 2. Both window placeholders must be present as real query parameters, else the
    //    window has no effect. Check the comment- and literal-stripped SQL: one hidden
    //    in a comment or string parses fine but ClickHouse never binds it, so the SLO
    //    would quietly ignore its window and scan far more data than intended.
    let code = sql_without_comments_and_literals(&spec.sli.sql);
    if !code.contains("{window_start:") || !code.contains("{window_end:") {
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

    Ok(())
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
        assert_eq!(strip_ch_params("{a:Int}-{b:Int}"), "0-0");
        assert_eq!(strip_ch_params("{}"), "0");
        assert_eq!(strip_ch_params("no params here"), "no params here");
    }

    #[test]
    fn strip_ch_params_fails_safe_on_unmatched_brace() {
        // Unmatched braces remain invalid instead of being stripped.
        assert_eq!(strip_ch_params("SELECT {a"), "SELECT {a");
        let s = spec("SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end");
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn strip_ch_params_does_not_let_a_second_statement_through_the_guard() {
        let bounds = "ts >= {window_start:DateTime} AND ts < {window_end:DateTime}";
        for sql in [
            // The plain form: a separator sitting in open code.
            format!("SELECT 1 AS good, 1 AS valid FROM t WHERE {bounds}; DROP TABLE t"),
            // A brace inside a string literal must not open a strip span. If it does,
            // everything up to the next `}` (the `;`s and the second statement with
            // them) vanishes from the copy the guard sees, while the stored SQL still
            // carries all three statements.
            format!(
                "SELECT 1 AS good, 1 AS valid FROM t WHERE {bounds} \
                 AND a = '{{' ; DROP TABLE t ; SELECT 1 WHERE '}}' = ''"
            ),
            // Same trick with a quoted identifier rather than a string.
            format!(
                "SELECT 1 AS good, 1 AS valid FROM t WHERE {bounds} \
                 AND \"{{\" = 1 ; DROP TABLE t ; SELECT 1 WHERE \"}}\" = 1"
            ),
            // And with the brace hidden in a comment.
            format!(
                "SELECT 1 AS good, 1 AS valid FROM t WHERE {bounds} -- {{\n\
                 ; DROP TABLE t ; SELECT 1 -- }}\n"
            ),
        ] {
            let s = spec(&sql);
            assert!(
                validate_slo_spec(&s).is_err(),
                "multi-statement SQL must be rejected: {sql}"
            );
        }
    }

    /// The guard must reject the extra statements without rejecting the literals
    /// themselves: a brace in a string is legal SQL a rule author may well write.
    #[test]
    fn a_brace_inside_a_literal_is_left_alone() {
        assert_eq!(strip_ch_params("SELECT '{' AS a"), "SELECT '{' AS a");
        assert_eq!(
            strip_ch_params("SELECT '{a:Int}' AS a, {b:Int} AS b"),
            "SELECT '{a:Int}' AS a, 0 AS b"
        );
        let s = spec(
            "SELECT 1 AS good, 1 AS valid FROM t \
             WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime} AND a = '{'",
        );
        assert!(validate_slo_spec(&s).is_ok());
    }

    #[test]
    fn sql_without_comments_and_literals_blanks_every_hiding_place() {
        let f = sql_without_comments_and_literals;
        assert!(!f("a -- {window_start:DateTime}\n b").contains("{window_start:"));
        assert!(!f("a # {window_start:DateTime}\n b").contains("{window_start:"));
        assert!(!f("a /* {window_start:DateTime} */ b").contains("{window_start:"));
        assert!(!f("a '{window_start:DateTime}' b").contains("{window_start:"));
        assert!(!f(r#"a "{window_start:DateTime}" b"#).contains("{window_start:"));
        assert!(!f("'it''s {window_end:DateTime}'").contains("{window_end:"));
        assert!(f("ts >= {window_start:DateTime} -- c").contains("{window_start:DateTime}"));
    }

    #[test]
    fn window_placeholders_hidden_in_a_comment_or_string_are_rejected() {
        for sql in [
            "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= 0 -- {window_start:DateTime} {window_end:DateTime}",
            "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= 0 /* {window_start:DateTime} {window_end:DateTime} */",
            "SELECT 1 AS good, 1 AS valid, '{window_start:DateTime}{window_end:DateTime}' AS n FROM t WHERE ts >= 0",
        ] {
            let s = spec(sql);
            assert!(
                matches!(validate_slo_spec(&s), Err(ApiError::Validation(ref m)) if m.contains("window_start")),
                "placeholders hidden in a comment/string must be rejected: {sql}"
            );
        }
    }

    #[test]
    fn real_window_placeholders_pass_despite_a_decoy_in_a_comment() {
        let s = spec("SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime} -- {window_start:DateTime}");
        assert!(validate_slo_spec(&s).is_ok());
    }

    fn spec(sql: &str) -> SloSpec {
        SloSpec {
            sli: SliSpec { sql: sql.into() },
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
    fn rejects_non_select_sql() {
        let s = spec(
            "DELETE FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
        );
        assert!(validate_slo_spec(&s).is_err());
    }

    #[test]
    fn rejects_missing_window_placeholders() {
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
        s.time_window.duration = "1M".into();
        assert!(validate_slo_spec(&s).is_err());
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
        let mut s = spec(GOOD_SQL);
        s.time_window.duration = "12h".into();
        let err = validate_slo_spec(&s).unwrap_err();
        let ApiError::Validation(msg) = err else {
            panic!("expected Validation, got {err:?}")
        };
        assert!(msg.contains("12h"), "message was: {msg}");
        assert!(msg.contains("minimum"), "message was: {msg}");
    }
}
