use crate::api::auth::tenant;
use crate::api::error::ApiError;
use crate::api::identity::{validate_name, validate_namespace};
use crate::api::AppState;
use crate::domain::ids::RuleId;
use crate::domain::rollup::RuleRollup;
use crate::domain::rule::{Rule, RuleHealth, RuleSpec};
use crate::stores::{RuleCreate, RulePageKey};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

/// Serializable view of a rule's rolled-up alert state, nested under `rollup` on `RuleView`.
#[derive(Serialize)]
pub struct RuleRollupOut {
    pub alert_state: crate::domain::rollup::AlertState,
    pub firing_instance_count: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_fired_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_resolved_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_seen_at: Option<time::OffsetDateTime>,
    pub last_row_count: i32,
}

impl From<RuleRollup> for RuleRollupOut {
    fn from(r: RuleRollup) -> Self {
        RuleRollupOut {
            alert_state: r.state,
            firing_instance_count: r.firing_instance_count,
            last_fired_at: r.fired_at,
            last_resolved_at: r.resolved_at,
            last_seen_at: r.seen_at,
            last_row_count: r.row_count,
        }
    }
}

/// Rule representation with its health and rolled-up alert state, returned by GET and list.
#[derive(Serialize)]
pub struct RuleView {
    #[serde(flatten)]
    rule: Rule,
    /// When the rule row was last written (create, spec update, pause/resume);
    /// maintained by the store, not part of the domain `Rule`.
    #[serde(with = "time::serde::rfc3339")]
    updated_at: time::OffsetDateTime,
    health: RuleHealth,
    rollup: RuleRollupOut,
}

#[derive(Deserialize)]
pub struct ListParams {
    /// Optional health filter: "degraded" or "healthy".
    health: Option<String>,
    /// Optional identity filters (exact match).
    namespace: Option<String>,
    name: Option<String>,
    /// Page size, 1..=500 (default 100). Kept as a raw string so a malformed
    /// value gets a problem-details response instead of axum's plain-text
    /// query rejection.
    limit: Option<String>,
    /// Opaque resume token from a previous page's `next_cursor`.
    cursor: Option<String>,
}

/// Paginated listing page size bounds: `limit` defaults to 100 and is capped at 500.
const DEFAULT_PAGE_LIMIT: i64 = 100;
const MAX_PAGE_LIMIT: i64 = 500;

/// Parse and bound the `limit` query parameter (paginated mode only).
/// `None` means the parameter was absent and yields the default.
fn parse_limit(raw: Option<&str>) -> Result<i64, ApiError> {
    let Some(raw) = raw else {
        return Ok(DEFAULT_PAGE_LIMIT);
    };
    let n: i64 = raw.parse().map_err(|_| {
        ApiError::Validation(format!("invalid limit: {raw:?} (expected an integer)"))
    })?;
    if !(1..=MAX_PAGE_LIMIT).contains(&n) {
        return Err(ApiError::Validation(format!(
            "invalid limit: {n} (expected 1..={MAX_PAGE_LIMIT})"
        )));
    }
    Ok(n)
}

/// Version tag inside the cursor payload; lets the format evolve without
/// old tokens being misread.
const CURSOR_VERSION: &str = "v1";

/// Encode a keyset position as the opaque `next_cursor` token:
/// URL-safe base64 (no padding) over `v1:<created_at unix nanos>:<rule uuid>`.
fn encode_cursor(key: &RulePageKey) -> String {
    URL_SAFE_NO_PAD.encode(format!(
        "{CURSOR_VERSION}:{}:{}",
        key.created_at.unix_timestamp_nanos(),
        key.id.0
    ))
}

/// Decode and validate a client-supplied cursor. Any malformed token (bad
/// base64, wrong version, missing fields, unparsable timestamp or UUID) is a
/// `400 bad_request`; the token is opaque, so no detail beyond that is owed.
fn decode_cursor(raw: &str) -> Result<RulePageKey, ApiError> {
    let invalid = || ApiError::BadRequest("invalid cursor".to_string());
    let bytes = URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid())?;
    let s = String::from_utf8(bytes).map_err(|_| invalid())?;
    let mut parts = s.splitn(3, ':');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(CURSOR_VERSION), Some(nanos), Some(id)) => {
            let nanos: i128 = nanos.parse().map_err(|_| invalid())?;
            let created_at =
                time::OffsetDateTime::from_unix_timestamp_nanos(nanos).map_err(|_| invalid())?;
            let id = RuleId(Uuid::parse_str(id).map_err(|_| invalid())?);
            Ok(RulePageKey { created_at, id })
        }
        _ => Err(invalid()),
    }
}

/// Validate the spec: SQL must be a read-only SELECT and basic params sane.
fn validate_spec(spec: &RuleSpec) -> Result<(), ApiError> {
    crate::sqlguard::validate(&spec.sql).map_err(|e| ApiError::Validation(e.to_string()))?;
    if spec.interval_secs == 0 {
        return Err(ApiError::Validation("interval_secs must be > 0".into()));
    }
    if spec.resolve_after == 0 {
        return Err(ApiError::Validation("resolve_after must be >= 1".into()));
    }
    if let Some(max) = spec.max_interval_secs {
        if max < spec.interval_secs {
            return Err(ApiError::Validation(format!(
                "max_interval_secs ({max}) must be >= interval_secs ({})",
                spec.interval_secs
            )));
        }
    }
    crate::api::reject_reserved_label_columns(&spec.label_columns)?;
    Ok(())
}

/// `POST /v1/rules` body: first-class identity plus the flattened spec.
#[derive(Deserialize)]
pub struct CreateRuleBody {
    pub name: String,
    #[serde(default)]
    pub namespace: String,
    #[serde(flatten)]
    pub spec: RuleSpec,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateRuleBody>,
) -> Result<Json<Rule>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_name(&body.name)?;
    validate_namespace(&body.namespace)?;
    validate_spec(&body.spec)?;
    match state
        .store
        .create_rule(t, &body.namespace, &body.name, &body.spec)
        .await?
    {
        RuleCreate::Created(rule) => Ok(Json(rule)),
        RuleCreate::NameConflict => Err(ApiError::Conflict(format!(
            "rule name {:?} already exists in namespace {:?}",
            body.name, body.namespace
        ))),
    }
}

/// `PUT /v1/rules/:id` body: a full rule spec plus an optional optimistic-concurrency
/// guard. `version` (top-level, not part of the spec) must equal the stored version or
/// the update is rejected with `409`; omitting it means last-write-wins.
#[derive(Deserialize)]
pub struct UpdateRuleBody {
    #[serde(flatten)]
    pub spec: RuleSpec,
    pub version: Option<i64>,
}

/// Replace a rule's spec in place. Preserves the rule id, tenant, paused flag and
/// (unless `label_columns` changed, see the store's `update_rule` docs) instance state;
/// bumps `version`. Validation is identical to create.
pub async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateRuleBody>,
) -> Result<Json<Rule>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_spec(&body.spec)?;
    let outcome = state
        .store
        .update_rule(t, RuleId(id), &body.spec, body.version)
        .await?;
    match outcome {
        crate::stores::RuleUpdate::Updated(rule) => Ok(Json(rule)),
        crate::stores::RuleUpdate::NotFound => Err(ApiError::NotFound),
        crate::stores::RuleUpdate::VersionConflict { current } => Err(ApiError::Conflict(format!(
            "rule version mismatch: expected {}, current {current}",
            body.version.unwrap_or_default()
        ))),
    }
}

pub async fn get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<RuleView>, ApiError> {
    let t = tenant(&state, &headers)?;
    let (rule, health, rollup, updated_at) = state
        .store
        .get_rule_with_health(t, RuleId(id))
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(RuleView {
        rule,
        updated_at,
        health,
        rollup: rollup.into(),
    }))
}

pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let ok = state.store.delete_rule(t, RuleId(id)).await?;
    crate::api::deleted(ok)
}

/// Shared body of `pause`/`resume`: flip the paused flag, then return the
/// stored rule. A miss on either step is a 404.
async fn set_paused(
    state: &AppState,
    headers: &HeaderMap,
    id: RuleId,
    pause: bool,
) -> Result<Json<Rule>, ApiError> {
    let t = tenant(state, headers)?;
    let ok = if pause {
        state.store.pause_rule(t.clone(), id).await?
    } else {
        state.store.resume_rule(t.clone(), id).await?
    };
    if !ok {
        return Err(ApiError::NotFound);
    }
    state
        .store
        .get_rule(t, id)
        .await?
        .map(Json)
        .ok_or(ApiError::NotFound)
}

pub async fn pause(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Rule>, ApiError> {
    set_paused(&state, &headers, RuleId(id), true).await
}

pub async fn resume(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Rule>, ApiError> {
    set_paused(&state, &headers, RuleId(id), false).await
}

/// List rules: keyset pagination over `(created_at, id)`, returning
/// `{ "items": [RuleView...], "next_cursor": ... }`. `next_cursor` is null on
/// the last page. Honors the optional `health` filter.
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    let filter = match params.health.as_deref() {
        None => None,
        Some("degraded") => Some("degraded"),
        Some("healthy") => Some("healthy"),
        Some(other) => {
            return Err(ApiError::Validation(format!(
                "invalid health filter: {other} (expected 'degraded' or 'healthy')"
            )))
        }
    };
    let view = |(rule, health, rollup, updated_at): (
        Rule,
        RuleHealth,
        RuleRollup,
        time::OffsetDateTime,
    )| {
        serde_json::to_value(RuleView {
            rule,
            updated_at,
            health,
            rollup: rollup.into(),
        })
        .unwrap()
    };

    let limit = parse_limit(params.limit.as_deref())?;
    let after = params.cursor.as_deref().map(decode_cursor).transpose()?;
    let (rules, next) = state
        .store
        .list_rules_page(
            &t,
            filter,
            params.namespace.as_deref(),
            params.name.as_deref(),
            after.as_ref(),
            limit,
        )
        .await?;
    let items: Vec<Value> = rules.into_iter().map(view).collect();
    Ok(Json(json!({
        "items": items,
        "next_cursor": next.map(|k| encode_cursor(&k)),
    })))
}

/// Ad-hoc evaluation: run the SQL now and return the matched rows. No state change.
pub async fn test(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(spec): Json<RuleSpec>,
) -> Result<Json<Value>, ApiError> {
    let t = tenant(&state, &headers)?;
    validate_spec(&spec)?;
    let rows = state
        .ch
        .query_rows(
            &t,
            &spec.sql,
            &spec.label_columns,
            spec.value_column.as_deref(),
        )
        .await
        .map_err(|e| ApiError::Validation(format!("query failed: {e}")))?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "labels": r.labels,
                "value": r.value,
            })
        })
        .collect();
    Ok(Json(json!({ "matched": out.len(), "rows": out })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;

    fn spec(label_columns: Vec<String>) -> RuleSpec {
        RuleSpec {
            sql: "SELECT 1".into(),
            interval_secs: 30,
            for_secs: 0,
            label_columns,
            value_column: None,
            severity: Severity::Info,
            annotations: BTreeMap::new(),
            resolve_after: 1,
            max_interval_secs: None,
            suppressed: false,
        }
    }

    #[test]
    fn rejects_reserved_label_prefix() {
        assert!(validate_spec(&spec(vec!["host".into()])).is_ok());
        assert!(validate_spec(&spec(vec!["__cc_health".into()])).is_err());
        assert!(validate_spec(&spec(vec!["__cc_anything".into()])).is_err());
    }

    #[test]
    fn max_interval_secs_must_be_at_least_the_interval() {
        let mut s = spec(vec!["host".into()]);
        assert!(
            validate_spec(&s).is_ok(),
            "None = feature off, always valid"
        );

        s.max_interval_secs = Some(29);
        let err = validate_spec(&s).expect_err("max below interval must be rejected");
        assert!(
            matches!(err, ApiError::Validation(ref d) if d.contains("max_interval_secs")),
            "expected a 422 validation error naming the field, got {err:?}"
        );

        s.max_interval_secs = Some(30);
        assert!(validate_spec(&s).is_ok(), "max == interval is allowed");
        s.max_interval_secs = Some(3600);
        assert!(validate_spec(&s).is_ok());
    }

    #[test]
    fn cursor_round_trips() {
        let key = RulePageKey {
            created_at: time::macros::datetime!(2026-06-14 12:00:00.123456 UTC),
            id: RuleId(Uuid::new_v4()),
        };
        let token = encode_cursor(&key);
        // Opaque on the wire: URL-safe, no separators leaking structure.
        assert!(!token.contains(':'));
        assert_eq!(decode_cursor(&token).unwrap(), key);
    }

    #[test]
    fn cursor_survives_microsecond_truncation() {
        // Postgres timestamptz is microsecond-precision; a key read back from
        // the DB must encode/decode without drift.
        let key = RulePageKey {
            created_at: time::OffsetDateTime::from_unix_timestamp_nanos(1_765_432_100_987_654_000)
                .unwrap(),
            id: RuleId(Uuid::new_v4()),
        };
        assert_eq!(decode_cursor(&encode_cursor(&key)).unwrap(), key);
    }

    #[test]
    fn garbage_cursors_are_bad_requests() {
        let cases = [
            "not base64!!",
            "",
            // Valid base64 of non-cursor payloads:
            &URL_SAFE_NO_PAD.encode("hello"),
            &URL_SAFE_NO_PAD.encode("v2:0:00000000-0000-0000-0000-000000000000"), // wrong version
            &URL_SAFE_NO_PAD.encode("v1:0"),                                      // missing uuid
            &URL_SAFE_NO_PAD.encode("v1:xyz:00000000-0000-0000-0000-000000000000"), // bad nanos
            &URL_SAFE_NO_PAD.encode("v1:0:not-a-uuid"),
            // Nanos far outside the representable OffsetDateTime range:
            &URL_SAFE_NO_PAD
                .encode("v1:99999999999999999999999999999999:00000000-0000-0000-0000-000000000000"),
            &URL_SAFE_NO_PAD.encode(vec![0xffu8, 0xfe]), // not utf8
        ];
        for raw in cases {
            let err = decode_cursor(raw).expect_err(&format!("cursor {raw:?} must be rejected"));
            assert!(
                matches!(err, ApiError::BadRequest(_)),
                "expected 400 bad_request for {raw:?}, got {err:?}"
            );
        }
    }

    #[test]
    fn limit_defaults_and_bounds() {
        assert_eq!(parse_limit(None).unwrap(), 100, "absent -> default");
        assert_eq!(parse_limit(Some("1")).unwrap(), 1);
        assert_eq!(parse_limit(Some("500")).unwrap(), 500);

        for bad in ["0", "-1", "501", "abc", "", "1.5", "1e2"] {
            let err = parse_limit(Some(bad)).expect_err(&format!("limit {bad:?} must be rejected"));
            assert!(
                matches!(err, ApiError::Validation(_)),
                "expected 422 validation for limit {bad:?}, got {err:?}"
            );
        }
    }
}
