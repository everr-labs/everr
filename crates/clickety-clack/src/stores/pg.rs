use crate::crypto::SecretCipher;
use crate::domain::channel::{Channel, ChannelConfig};
use crate::domain::event::{Event, EventStatus};
use crate::domain::ids::{InstanceKey, RuleId, SloId, SourceId, TenantId};
use crate::domain::inhibition::InhibitionRule;
use crate::domain::instance::{FiringInstance, InstanceState, StaleInstance, Status};
use crate::domain::receiver::Receiver;
use crate::domain::rollup::RuleRollup;
use crate::domain::routing::{Matcher, Route};
use crate::domain::rule::{Rule, RuleHealth, RuleSpec};
use crate::domain::silence::Silence;
use crate::domain::subscription::Subscription;
use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::Row;
use std::collections::BTreeMap;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlx: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("migrate: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("crypto: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),
}

#[derive(Clone)]
pub struct PgStore {
    pool: PgPool,
    /// Engine self-observability (`cc.scheduler.drift` on the claim path). Disabled by
    /// default; attached by `main` when engine telemetry is configured.
    metrics: crate::otel::EngineMetrics,
    /// The SLO evaluation cadence (`CC_SLO_BASE_CADENCE_SECS`), used to spread
    /// `next_eval` jitter phases at SLO create/resume the way rules use their
    /// own `interval_secs`. Defaults to the config default.
    slo_base_cadence_secs: u32,
}

/// Cadence outcome of one rule evaluation, applied inside the same transaction as
/// the eval batch (see [`PgStore::persist_eval_batch`]).
///
/// `quiet` means the evaluation produced no present row AND left no instance
/// pending or firing; only then may the effective interval stretch. Anything
/// active (including pending instances mid for-duration, and firing instances
/// counting absences toward `resolve_after`) resets the stretch, so a firing
/// rule is never on a stretched cadence.
#[derive(Debug, Clone, Copy)]
pub struct EvalCadence {
    pub quiet: bool,
    /// The spec's base interval at evaluation time.
    pub interval_secs: u32,
    /// The spec's stretch cap; `None` = adaptive cadence off (no state written).
    pub max_interval_secs: Option<u32>,
    /// The evaluation timestamp; anchors the next_eval adjustment.
    pub eval_ts: OffsetDateTime,
}

/// Outcome of [`PgStore::create_rule`].
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum RuleCreate {
    Created(Rule),
    /// A rule with this (tenant, namespace, name) already exists.
    NameConflict,
}

/// Outcome of [`PgStore::update_rule`].
// Same trade-off as `SloCreate` below: boxing `Updated`'s payload would tax every
// caller for a lint about the outcome enum's stack footprint (never hot-path-cloned).
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum RuleUpdate {
    /// The rule was updated; carries the new stored rule (version already bumped).
    Updated(Rule),
    /// No rule with that id exists for the tenant.
    NotFound,
    /// The caller supplied an expected version that no longer matches.
    VersionConflict { current: i64 },
}

/// Outcome of [`PgStore::create_slo`].
// `Slo` carries an owned `SloSpec` (label columns, tiers, annotations); boxing the
// `Created` payload would force callers to deref through a `Box` everywhere and break
// direct `Slo == Slo` comparisons in the store tests, for a lint that's purely about
// the outcome enum's stack footprint (never hot-path-cloned).
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum SloCreate {
    Created(crate::domain::slo::Slo),
    NameConflict,
}

/// Outcome of [`PgStore::update_slo`].
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum SloUpdate {
    Updated(crate::domain::slo::Slo),
    NotFound,
    VersionConflict { current: i64 },
}

/// Outcome of [`PgStore::insert_receiver`] (create-only).
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum ReceiverInsert {
    Created(Receiver),
    /// A receiver with this (tenant, name) already exists.
    NameConflict,
    /// One or more referenced channels do not exist, detected under the channel-row
    /// lock inside the write transaction (see [`lock_referenced_channels`]); also fires
    /// when a concurrent `delete_channel` removed a channel the boundary pre-check had
    /// just seen. Carries the missing names in request order (the API renders a 422).
    MissingChannels(Vec<String>),
}

/// Outcome of [`PgStore::create_receiver`] (upsert).
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum ReceiverUpsert {
    Stored(Receiver),
    /// See [`ReceiverInsert::MissingChannels`].
    MissingChannels(Vec<String>),
}

/// Lock the referenced channel rows (`FOR KEY SHARE`) inside the caller's write
/// transaction and return the requested names that do not exist (empty = all present,
/// order-preserving and deduped). The lock is what makes a receiver write serialize
/// against [`PgStore::delete_channel`] (which takes `FOR UPDATE` on the channel row):
/// `FOR KEY SHARE` and `FOR UPDATE` conflict, so the two can't both proceed, and
/// several receiver writes referencing the same channel still run concurrently
/// (`FOR KEY SHARE` does not self-conflict).
async fn lock_referenced_channels(
    conn: &mut sqlx::PgConnection,
    tenant: &TenantId,
    channels: &[String],
) -> Result<Vec<String>, StoreError> {
    let present: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM channels WHERE tenant=$1 AND name = ANY($2) FOR KEY SHARE",
    )
    .bind(tenant.as_str())
    .bind(channels)
    .fetch_all(conn)
    .await?;
    let mut missing = Vec::new();
    for name in channels {
        if !present.contains(name) && !missing.contains(name) {
            missing.push(name.clone());
        }
    }
    Ok(missing)
}

/// True if a sqlx error is a Postgres unique-constraint violation (SQLSTATE 23505).
fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error()
        .and_then(|d| d.code())
        .map(|c| c == "23505")
        .unwrap_or(false)
}

/// Outcome of [`PgStore::delete_channel`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelDelete {
    Deleted,
    NotFound,
    /// At least one receiver still references the channel; carries the referring
    /// receiver names (the API surfaces them in the 409 detail).
    InUse(Vec<String>),
}

/// Keyset position within the `(created_at, id)`-ordered rule listing: the key
/// of the last row already served. See [`PgStore::list_rules_page`]. The API
/// layer encodes/decodes this as the opaque `cursor` query parameter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RulePageKey {
    pub created_at: OffsetDateTime,
    pub id: RuleId,
}

/// A stored SLO status snapshot, as read by [`PgStore::get_slo_status`]. `payload`
/// holds the per-group status + per-window freshness timestamps computed by the
/// evaluator (see [`crate::engine::slo_math::SloStatusPayload`] for its shape).
#[derive(Debug, Clone)]
pub struct SloStatusRow {
    pub slo: crate::domain::ids::SloId,
    pub tenant: TenantId,
    pub payload: serde_json::Value,
    pub computed_at: OffsetDateTime,
}

/// SLO health, as read by [`PgStore::get_slo_health`]. Lean sibling of [`RuleHealth`]
/// (no `consecutive_failures`/`last_error_at`, which the `/status` health object doesn't
/// surface); serialized as-is into the `/v1/slos/:id/status` response.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SloHealth {
    pub status: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub degraded_since: Option<OffsetDateTime>,
    pub last_error: Option<String>,
}

/// Lean per-SLO projection for dispatch-time inhibition synthesis (see
/// `dispatcher::slo_inhibit`), returned by [`PgStore::list_slos_for_dispatch`]. Dispatch
/// never needs the full [`crate::domain::slo::Slo`] (SQL text, target, window...) — just
/// identity and the label columns that fan the tier group out. Tiers are the
/// canonical set for every SLO, so the consumer reads them from `canonical_tiers()`.
#[derive(Debug, Clone, PartialEq)]
pub struct SloDispatchInfo {
    pub id: crate::domain::ids::SloId,
    pub tenant: TenantId,
    pub label_columns: Vec<String>,
}

fn status_str(s: Status) -> &'static str {
    match s {
        Status::Inactive => "inactive",
        Status::Pending => "pending",
        Status::Firing => "firing",
    }
}

fn status_from(s: &str) -> Status {
    match s {
        "pending" => Status::Pending,
        "firing" => Status::Firing,
        _ => Status::Inactive,
    }
}

/// absent_count is a small non-negative counter; clamp DB value defensively.
fn absent_count_from_db(v: i32) -> u32 {
    v.max(0) as u32
}

/// absent_count never realistically exceeds i32::MAX (it's bounded by resolve_after).
fn absent_count_to_db(v: u32) -> i32 {
    i32::try_from(v).unwrap_or(i32::MAX)
}

/// Which table an instance row came from, deciding the [`SourceId`] variant its
/// `source` uuid column wraps into. `Rule` for `instances`, `Slo` for
/// `slo_instances`; union reads carry it as a per-row SQL literal (see
/// [`PgStore::list_alerts`]).
#[derive(Clone, Copy)]
enum SourceKind {
    Rule,
    Slo,
}

impl SourceKind {
    fn wrap(self, id: Uuid) -> SourceId {
        match self {
            SourceKind::Rule => SourceId::Rule(RuleId(id)),
            SourceKind::Slo => SourceId::Slo(SloId(id)),
        }
    }

    /// Decode the `source_kind` SQL literal of a union read. The literals are
    /// crate-controlled constants, so anything unexpected is a programming error.
    fn from_db(s: &str) -> SourceKind {
        match s {
            "rule" => SourceKind::Rule,
            "slo" => SourceKind::Slo,
            other => unreachable!("unknown source_kind literal '{other}'"),
        }
    }
}

fn row_to_instance(
    r: &sqlx::postgres::PgRow,
    kind: SourceKind,
) -> Result<InstanceState, StoreError> {
    let labels: BTreeMap<String, String> = serde_json::from_value(r.get("labels"))?;
    Ok(InstanceState {
        key: InstanceKey(r.get("key")),
        source: kind.wrap(r.get("source")),
        tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
        status: status_from(r.get::<&str, _>("status")),
        labels,
        value: r.get("value"),
        active_since: r.get("active_since"),
        last_seen: r.get("last_seen"),
        absent_count: absent_count_from_db(r.get::<i32, _>("absent_count")),
    })
}

fn row_to_silence(r: &sqlx::postgres::PgRow) -> Result<Silence, StoreError> {
    Ok(Silence {
        id: r.get("id"),
        tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
        matchers: serde_json::from_value(r.get("matchers"))?,
        starts_at: r.get("starts_at"),
        ends_at: r.get("ends_at"),
        comment: r.get("comment"),
        author: r.get("author"),
        created_at: r.get("created_at"),
    })
}

fn row_to_inhibition(r: &sqlx::postgres::PgRow) -> Result<InhibitionRule, StoreError> {
    Ok(InhibitionRule {
        id: r.get("id"),
        tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
        source_matchers: serde_json::from_value(r.get("source_matchers"))?,
        target_matchers: serde_json::from_value(r.get("target_matchers"))?,
        equal: serde_json::from_value(r.get("equal"))?,
        created_at: r.get("created_at"),
    })
}

/// Build a [`Rule`] from a row's `spec`/`version`/`paused` columns. `id` and `tenant`
/// come from the caller: the tenant-scoped point reads already hold them as arguments
/// (and don't select those columns), while the listing/claim paths read them off the
/// row first.
fn rule_from_row(r: &PgRow, id: RuleId, tenant: TenantId) -> Result<Rule, StoreError> {
    let spec: RuleSpec = serde_json::from_value(r.get("spec"))?;
    Ok(Rule {
        id,
        tenant,
        namespace: r.get("namespace"),
        name: r.get("name"),
        spec,
        version: r.get("version"),
        paused: r.get("paused"),
    })
}

/// Insert one event into the outbox within `tx`. Returns the generated row id (used
/// to delete the row after a successful publish).
async fn insert_outbox_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ev: &Event,
) -> Result<Uuid, StoreError> {
    let id = Uuid::new_v4();
    let payload = serde_json::to_value(ev)?;
    sqlx::query("INSERT INTO event_outbox (id, tenant, payload) VALUES ($1,$2,$3)")
        .bind(id)
        .bind(ev.tenant.as_str())
        .bind(&payload)
        .execute(&mut **tx)
        .await?;
    Ok(id)
}

/// The eval-batch instance upsert, rule side. Differs from
/// [`SLO_INSTANCES_UPSERT_SQL`] only in table and id column.
const INSTANCES_UPSERT_SQL: &str =
    "INSERT INTO instances (key, rule, tenant, status, labels, value, active_since, last_seen, absent_count)
     SELECT * FROM unnest($1::text[], $2::uuid[], $3::text[], $4::text[], $5::jsonb[], $6::float8[], $7::timestamptz[], $8::timestamptz[], $9::int[])
     ON CONFLICT (key) DO UPDATE SET
       status=EXCLUDED.status, labels=EXCLUDED.labels, value=EXCLUDED.value,
       active_since=EXCLUDED.active_since, last_seen=EXCLUDED.last_seen, absent_count=EXCLUDED.absent_count
     WHERE instances.tenant = EXCLUDED.tenant";

/// The eval-batch instance upsert, SLO side (see [`INSTANCES_UPSERT_SQL`]).
const SLO_INSTANCES_UPSERT_SQL: &str =
    "INSERT INTO slo_instances (key, slo, tenant, status, labels, value, active_since, last_seen, absent_count)
     SELECT * FROM unnest($1::text[], $2::uuid[], $3::text[], $4::text[], $5::jsonb[], $6::float8[], $7::timestamptz[], $8::timestamptz[], $9::int[])
     ON CONFLICT (key) DO UPDATE SET
       status=EXCLUDED.status, labels=EXCLUDED.labels, value=EXCLUDED.value,
       active_since=EXCLUDED.active_since, last_seen=EXCLUDED.last_seen, absent_count=EXCLUDED.absent_count
     WHERE slo_instances.tenant = EXCLUDED.tenant";

/// Shared write path of [`PgStore::persist_eval_batch`] and
/// [`PgStore::persist_slo_eval_batch`]: marshal the batch into unnest arrays, upsert
/// the instance rows via `upsert_sql` ([`INSTANCES_UPSERT_SQL`] or
/// [`SLO_INSTANCES_UPSERT_SQL`]), and insert one outbox row per event. Returns the
/// generated outbox ids in `events` order.
async fn write_eval_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    upsert_sql: &str,
    instances: &[InstanceState],
    events: &[Event],
) -> Result<Vec<Uuid>, StoreError> {
    let n = instances.len();
    let mut keys = Vec::with_capacity(n);
    let mut rules = Vec::with_capacity(n);
    let mut tenants = Vec::with_capacity(n);
    let mut statuses = Vec::with_capacity(n);
    let mut labels_arr = Vec::with_capacity(n);
    let mut values = Vec::with_capacity(n);
    let mut active = Vec::with_capacity(n);
    let mut last_seen = Vec::with_capacity(n);
    let mut absent = Vec::with_capacity(n);
    for s in instances {
        keys.push(s.key.0.clone());
        rules.push(s.source.uuid()); // the rule/slo id column of the target table
        tenants.push(s.tenant.as_str().to_string());
        statuses.push(status_str(s.status).to_string());
        labels_arr.push(serde_json::to_value(&s.labels)?);
        values.push(s.value);
        active.push(s.active_since);
        last_seen.push(s.last_seen);
        absent.push(absent_count_to_db(s.absent_count));
    }

    let ids: Vec<Uuid> = (0..events.len()).map(|_| Uuid::new_v4()).collect();
    let ev_tenants: Vec<String> = events
        .iter()
        .map(|e| e.tenant.as_str().to_string())
        .collect();
    let payloads: Vec<serde_json::Value> = events
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<_, _>>()?;

    if !instances.is_empty() {
        sqlx::query(upsert_sql)
            .bind(&keys)
            .bind(&rules)
            .bind(&tenants)
            .bind(&statuses)
            .bind(&labels_arr)
            .bind(&values)
            .bind(&active)
            .bind(&last_seen)
            .bind(&absent)
            .execute(&mut **tx)
            .await?;
    }
    if !events.is_empty() {
        sqlx::query(
            "INSERT INTO event_outbox (id, tenant, payload)
             SELECT * FROM unnest($1::uuid[], $2::text[], $3::jsonb[])",
        )
        .bind(&ids)
        .bind(&ev_tenants)
        .bind(&payloads)
        .execute(&mut **tx)
        .await?;
    }
    Ok(ids)
}

impl PgStore {
    pub async fn connect(url: &str) -> Result<Self, StoreError> {
        let pool = PgPoolOptions::new()
            .max_connections(16)
            .connect(url)
            .await?;
        Ok(Self {
            pool,
            metrics: crate::otel::EngineMetrics::disabled(),
            slo_base_cadence_secs: 30,
        })
    }

    /// Attach the engine-metrics handle so the claim path records scheduling drift.
    pub fn with_engine_metrics(mut self, metrics: crate::otel::EngineMetrics) -> Self {
        self.metrics = metrics;
        self
    }

    /// Attach the configured SLO base cadence so create/resume arm `next_eval`
    /// at a jitter phase within it.
    pub fn with_slo_base_cadence(mut self, secs: u32) -> Self {
        self.slo_base_cadence_secs = secs;
        self
    }

    pub async fn migrate(&self) -> Result<(), StoreError> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }

    // ---- rules ----

    /// Create a rule. Its first `next_eval` is now plus the rule's deterministic
    /// jitter phase (`hash(rule_id) % interval_secs`), so rules created together
    /// on the same round interval spread across it instead of all becoming due on
    /// the same tick. The claim paths advance by whole intervals afterwards, which
    /// preserves the stagger. First evaluation therefore lands within one interval
    /// of creation rather than immediately.
    pub async fn create_rule(
        &self,
        tenant: TenantId,
        namespace: &str,
        name: &str,
        spec: &RuleSpec,
    ) -> Result<RuleCreate, StoreError> {
        let id = Uuid::new_v4();
        let spec_json = serde_json::to_value(spec)?;
        let phase = crate::domain::cadence::jitter_offset_secs(id, spec.interval_secs);
        let res = sqlx::query(
            "INSERT INTO rules (id, tenant, namespace, name, spec, next_eval)
             VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6::int))",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(namespace)
        .bind(name)
        .bind(&spec_json)
        .bind(phase as i32)
        .execute(&self.pool)
        .await;
        match res {
            Ok(_) => Ok(RuleCreate::Created(Rule {
                id: RuleId(id),
                tenant,
                namespace: namespace.to_string(),
                name: name.to_string(),
                spec: spec.clone(),
                version: 1,
                paused: false,
            })),
            Err(e) if is_unique_violation(&e) => Ok(RuleCreate::NameConflict),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn get_rule(&self, tenant: TenantId, id: RuleId) -> Result<Option<Rule>, StoreError> {
        let row = sqlx::query(
            "SELECT namespace, name, spec, version, paused FROM rules WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(None),
            Some(r) => Ok(Some(rule_from_row(&r, id, tenant)?)),
        }
    }

    /// Load many rules by id in one round trip (batch counterpart of
    /// [`Self::get_rule`] for the evaluator's claim path). Rows carry their
    /// stored tenant; the caller matches it against each job's tenant, keeping
    /// the same tenant scoping as the per-id read. Missing ids are simply absent.
    pub async fn get_rules_by_ids(&self, ids: &[RuleId]) -> Result<Vec<Rule>, StoreError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let raw: Vec<Uuid> = ids.iter().map(|r| r.0).collect();
        let rows = sqlx::query(
            "SELECT id, tenant, namespace, name, spec, version, paused FROM rules WHERE id = ANY($1)",
        )
        .bind(&raw)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let tenant = TenantId::from_trusted(r.get::<String, _>("tenant"));
            out.push(rule_from_row(r, RuleId(r.get("id")), tenant)?);
        }
        Ok(out)
    }

    /// Update a rule's spec in place, preserving its id, tenant, paused flag and (where
    /// the identities still align) its instance state. Bumps `version` by one.
    ///
    /// `expected_version`: `Some(v)` is an optimistic-concurrency guard — if the stored
    /// version differs, nothing is written and `RuleUpdate::VersionConflict` is returned.
    /// `None` means last-write-wins.
    ///
    /// Side effects, all in one transaction:
    /// - `label_columns` changed (as a set): existing instances are DELETED. Their keys
    ///   hash the old label set and can never match a future evaluation, so keeping them
    ///   would strand pending/firing rows forever. The rule's rollup is reset to
    ///   `inactive` in the same breath so reads stay consistent until the next eval.
    ///   No Resolved events are synthesized (same silent teardown as rule deletion).
    /// - `sql` changed: `consecutive_failures`/`last_error` reset, so a fixed query is
    ///   never one old failure away from degrading. `health_status` itself is left
    ///   alone — recovery still flows through `record_rule_success` so the paired
    ///   RuleHealth Resolved event is emitted on the next successful eval.
    /// - `interval_secs` changed: `next_eval` is pulled forward to
    ///   `LEAST(next_eval, now + jitter_phase(new_interval))`, guaranteeing the
    ///   scheduler honors the new cadence within one new interval (a long stale
    ///   `next_eval` from a previous long interval cannot linger) while re-arming the
    ///   rule at its deterministic anti-stampede phase for the new interval.
    /// - `interval_secs` or `max_interval_secs` changed: the persisted adaptive
    ///   stretch (`eval_backoff_secs`) is reset, so the new cadence parameters start
    ///   from the base interval.
    pub async fn update_rule(
        &self,
        tenant: TenantId,
        id: RuleId,
        spec: &RuleSpec,
        expected_version: Option<i64>,
    ) -> Result<RuleUpdate, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT namespace, name, spec, version, paused FROM rules WHERE id=$1 AND tenant=$2 FOR UPDATE",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(RuleUpdate::NotFound);
        };
        let current: i64 = row.get("version");
        if let Some(expected) = expected_version {
            if expected != current {
                tx.rollback().await?;
                return Ok(RuleUpdate::VersionConflict { current });
            }
        }
        let old_spec: RuleSpec = serde_json::from_value(row.get("spec"))?;
        let paused: bool = row.get("paused");

        let sql_changed = old_spec.sql != spec.sql;
        let interval_changed = old_spec.interval_secs != spec.interval_secs;
        let cadence_changed =
            interval_changed || old_spec.max_interval_secs != spec.max_interval_secs;
        // Instance keys hash the SORTED label set, so column order is irrelevant to
        // identity: compare label_columns as sets.
        let label_set = |cols: &[String]| {
            let mut v = cols.to_vec();
            v.sort();
            v.dedup();
            v
        };
        let labels_changed = label_set(&old_spec.label_columns) != label_set(&spec.label_columns);

        let spec_json = serde_json::to_value(spec)?;
        sqlx::query(
            "UPDATE rules SET spec=$3, version = version + 1, updated_at = now()
             WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .bind(&spec_json)
        .execute(&mut *tx)
        .await?;

        // The follow-up statements below re-check the tenant even though the row was
        // already resolved tenant-scoped under FOR UPDATE (defense in depth: no query
        // on a tenant-owned table runs keyed by id alone).
        if sql_changed {
            sqlx::query(
                "UPDATE rules SET consecutive_failures = 0, last_error = NULL, last_error_at = NULL
                 WHERE id=$1 AND tenant=$2",
            )
            .bind(id.0)
            .bind(tenant.as_str())
            .execute(&mut *tx)
            .await?;
        }
        if interval_changed {
            // Re-arm at the rule's jitter phase for the NEW interval. The phase is
            // strictly less than the interval, so the "honors the new cadence within
            // one new interval" guarantee still holds, and a bulk interval change
            // re-staggers the affected rules instead of synchronizing them.
            let phase = crate::domain::cadence::jitter_offset_secs(id.0, spec.interval_secs);
            sqlx::query(
                "UPDATE rules SET next_eval = LEAST(next_eval, now() + make_interval(secs => $2::int))
                 WHERE id=$1 AND tenant=$3",
            )
            .bind(id.0)
            .bind(phase as i32)
            .bind(tenant.as_str())
            .execute(&mut *tx)
            .await?;
        }
        if cadence_changed {
            // New cadence parameters start unstretched; the next quiet evaluation
            // rebuilds the backoff from the new base/cap.
            sqlx::query("UPDATE rules SET eval_backoff_secs = 0 WHERE id=$1 AND tenant=$2")
                .bind(id.0)
                .bind(tenant.as_str())
                .execute(&mut *tx)
                .await?;
        }
        if labels_changed {
            sqlx::query("DELETE FROM instances WHERE rule=$1 AND tenant=$2")
                .bind(id.0)
                .bind(tenant.as_str())
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "UPDATE rules SET alert_state='inactive', firing_instance_count=0, last_row_count=0
                 WHERE id=$1 AND tenant=$2",
            )
            .bind(id.0)
            .bind(tenant.as_str())
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(RuleUpdate::Updated(Rule {
            id,
            tenant,
            namespace: row.get("namespace"),
            name: row.get("name"),
            spec: spec.clone(),
            version: current + 1,
            paused,
        }))
    }

    pub async fn delete_rule(&self, tenant: TenantId, id: RuleId) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM rules WHERE id=$1 AND tenant=$2")
            .bind(id.0)
            .bind(tenant.as_str())
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Pause a rule (exclude it from evaluation). Idempotent. Returns false if no
    /// such rule exists for the tenant.
    pub async fn pause_rule(&self, tenant: TenantId, id: RuleId) -> Result<bool, StoreError> {
        let res = sqlx::query(
            "UPDATE rules SET paused = true, updated_at = now() WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Resume a paused rule: clear the flag, re-arm `next_eval` at the rule's
    /// deterministic jitter phase (within one interval, so a bulk resume does not
    /// stampede ClickHouse on one tick), and restart the for-duration / resolve
    /// counters for its pending instances so unobserved pause time can't trigger a
    /// spurious fire. Firing instances are left untouched (frozen -> real resolve
    /// only when truly clear). Idempotent. Returns false if no such rule exists
    /// for the tenant.
    pub async fn resume_rule(&self, tenant: TenantId, id: RuleId) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        // The phase is derived from the stored spec's interval; read it in the same
        // transaction so a concurrent spec update cannot desync phase and interval.
        let interval: Option<i32> = sqlx::query_scalar(
            "SELECT (spec->>'interval_secs')::int FROM rules WHERE id=$1 AND tenant=$2 FOR UPDATE",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(interval) = interval else {
            tx.rollback().await?;
            return Ok(false);
        };
        let phase = crate::domain::cadence::jitter_offset_secs(id.0, interval.max(0) as u32);
        let res = sqlx::query(
            "UPDATE rules SET paused = false,
                    next_eval = now() + make_interval(secs => $3::int),
                    updated_at = now()
             WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .bind(phase as i32)
        .execute(&mut *tx)
        .await?;
        if res.rows_affected() == 0 {
            tx.rollback().await?;
            return Ok(false);
        }
        sqlx::query(
            "UPDATE instances SET active_since = NULL, absent_count = 0
             WHERE rule=$1 AND tenant=$2 AND status='pending'",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    /// Test-only access to the underlying pool for raw setup/assertions.
    #[doc(hidden)]
    pub fn pool_for_test(&self) -> &sqlx::PgPool {
        &self.pool
    }

    /// Claim rules whose next_eval <= now, advance next_eval by interval, return them.
    /// Single-shard form of [`Self::claim_due_rules_sharded`]: with one shard owning
    /// shard 0, the shard predicate is always true, so this claims across all tenants.
    pub async fn claim_due_rules(
        &self,
        now: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<Rule>, StoreError> {
        self.claim_due_rules_sharded(now, limit, &[0], 1).await
    }

    /// Like [`Self::claim_due_rules`], but only claims rules whose tenant maps into
    /// `owned_shards`. This is the lower of two independent hash layers: here `hashtext`
    /// maps each tenant to a shard index in `[0, shard_count)`; the scheduler's separate
    /// rendezvous-hash layer decides which node owns which shard index. Together they let
    /// replicas claim disjoint tenant slices concurrently. The modulo is made non-negative
    /// with `((hashtext(tenant) % N) + N) % N` because Postgres `%` can return negatives.
    pub async fn claim_due_rules_sharded(
        &self,
        now: OffsetDateTime,
        limit: i64,
        owned_shards: &[i32],
        shard_count: i32,
    ) -> Result<Vec<Rule>, StoreError> {
        // NOTE: next_eval advances from `now`, not the original due time, so a backlog can drift scheduling by up to one tick.
        // `due.next_eval` is the pre-update due time; it feeds the `cc.scheduler.drift`
        // metric (claim time minus due time) without changing scheduling semantics.
        //
        // The advance uses the rule's EFFECTIVE interval: the adaptive stretch
        // (`eval_backoff_secs`, written by the evaluator after quiet evaluations),
        // clamped into [interval_secs, max_interval_secs] at read time. The clamp
        // makes stale stretch state harmless: a lowered or removed
        // `max_interval_secs` takes effect at the very next claim, and rules that
        // never opted in (backoff 0, max NULL) advance by exactly `interval_secs`.
        let rows = sqlx::query(
            "WITH due AS (
                SELECT id, next_eval FROM rules
                WHERE next_eval <= $1 AND NOT paused
                  AND (((hashtext(tenant::text)::bigint % $3) + $3) % $3)::int = ANY($4)
                ORDER BY next_eval LIMIT $2 FOR UPDATE SKIP LOCKED
             )
             UPDATE rules r
             SET next_eval = $1 + make_interval(secs => GREATEST(
                    LEAST(r.eval_backoff_secs, COALESCE((r.spec->>'max_interval_secs')::int, 0)),
                    (r.spec->>'interval_secs')::int))
             FROM due WHERE r.id = due.id
             RETURNING r.id, r.tenant, r.namespace, r.name, r.spec, r.version, r.paused, due.next_eval AS due_at",
        )
        .bind(now)
        .bind(limit)
        .bind(shard_count)
        .bind(owned_shards)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::new();
        for r in rows {
            let rule = rule_from_row(
                &r,
                RuleId(r.get("id")),
                TenantId::from_trusted(r.get::<String, _>("tenant")),
            )?;
            self.metrics.record_scheduler_drift(
                crate::otel::metrics::elapsed_seconds(r.get::<OffsetDateTime, _>("due_at"), now),
                rule.tenant.as_str(),
            );
            out.push(rule);
        }
        Ok(out)
    }

    pub async fn record_eval_error(
        &self,
        id: RuleId,
        tenant: &TenantId,
        err: &str,
    ) -> Result<(), StoreError> {
        // An erroring rule is never left on a stretched cadence: drop the adaptive
        // backoff and, if it was stretched, pull next_eval back to base cadence so
        // the retry happens within one interval (the CASE keeps this a no-op for
        // unstretched rules). Tenant-scoped for defense in depth (the caller holds
        // the claimed rule's tenant).
        sqlx::query(
            "UPDATE rules SET last_error=$2, last_eval=now(),
                    eval_backoff_secs = 0,
                    next_eval = CASE WHEN eval_backoff_secs > 0
                        THEN LEAST(next_eval, now() + make_interval(secs => (spec->>'interval_secs')::int))
                        ELSE next_eval END
             WHERE id=$1 AND tenant=$3",
        )
        .bind(id.0)
        .bind(err)
        .bind(tenant.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ---- rule health ----

    /// Record a query failure for `rule`: bump the consecutive-failure counter and store the
    /// (already-scrubbed, already-capped) error. If this crosses `threshold` from a healthy
    /// state, flip to degraded and write a `RuleHealth`/`Firing` event to the outbox in the
    /// same transaction. Returns the event + outbox id to publish, or `None`.
    pub async fn record_rule_failure(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        err: &str,
        threshold: i32,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        // Same cadence guard as `record_eval_error`: a failing query resets any
        // adaptive stretch immediately so degraded rules retry at base cadence.
        let row = sqlx::query(
            "UPDATE rules
                SET consecutive_failures = consecutive_failures + 1,
                    last_error = $2, last_error_at = now(), last_eval = now(),
                    eval_backoff_secs = 0,
                    next_eval = CASE WHEN eval_backoff_secs > 0
                        THEN LEAST(next_eval, now() + make_interval(secs => (spec->>'interval_secs')::int))
                        ELSE next_eval END
              WHERE id = $1 AND tenant = $3
            RETURNING consecutive_failures, health_status, name,
                      (spec->>'suppressed')::bool AS suppressed",
        )
        .bind(rule.0)
        .bind(err)
        .bind(tenant.as_str())
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            // Rule deleted mid-flight: nothing to do.
            tx.commit().await?;
            return Ok(None);
        };
        let failures: i32 = row.get("consecutive_failures");
        let status: String = row.get("health_status");
        let name: String = row.get("name");
        // Specs stored before the key existed read NULL -> not suppressed.
        let suppressed: bool = row.get::<Option<bool>, _>("suppressed").unwrap_or(false);

        if status == "healthy" && failures >= threshold {
            sqlx::query(
                "UPDATE rules SET health_status='degraded', degraded_since=now() WHERE id=$1 AND tenant=$2",
            )
            .bind(rule.0)
            .bind(tenant.as_str())
            .execute(&mut *tx)
            .await?;
            let mut ann = BTreeMap::new();
            ann.insert(
                "summary".to_string(),
                format!(
                    "Rule {} degraded after {} consecutive failures",
                    rule.0, failures
                ),
            );
            ann.insert("last_error".to_string(), err.to_string());
            let mut ev = Event::rule_health(tenant.clone(), rule, EventStatus::Firing, ann, now);
            // A preview (suppressed) rule must never notify, its health events included.
            // Stamped here so the outbox payload carries the flag for the relay too.
            ev.suppressed = suppressed;
            ev.name = name;
            let id = insert_outbox_event(&mut tx, &ev).await?;
            tx.commit().await?;
            return Ok(Some((ev, id)));
        }

        tx.commit().await?;
        Ok(None)
    }

    /// Record a query success for `rule`: reset the failure counter and clear the stored error.
    /// If the rule was degraded, flip to healthy and write a `RuleHealth`/`Resolved` event to the
    /// outbox in the same transaction. Returns the recovery event + outbox id, or `None`.
    pub async fn record_rule_success(
        &self,
        rule: RuleId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        // Conditional reset: on the common already-healthy path this matches no row and writes
        // nothing, avoiding a per-evaluation write to the hot `rules` table.
        let row = sqlx::query(
            "UPDATE rules
                SET consecutive_failures = 0, last_error = NULL, last_error_at = NULL
              WHERE id = $1 AND tenant = $2
                AND (consecutive_failures <> 0 OR last_error IS NOT NULL OR health_status <> 'healthy')
            RETURNING health_status, name, (spec->>'suppressed')::bool AS suppressed",
        )
        .bind(rule.0)
        .bind(tenant.as_str())
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            // Already clean (or rule absent for this tenant): nothing to reset, no recovery.
            tx.commit().await?;
            return Ok(None);
        };
        let status: String = row.get("health_status");
        let name: String = row.get("name");
        let suppressed: bool = row.get::<Option<bool>, _>("suppressed").unwrap_or(false);

        if status == "degraded" {
            sqlx::query(
                "UPDATE rules SET health_status='healthy', degraded_since=NULL WHERE id=$1 AND tenant=$2",
            )
            .bind(rule.0)
            .bind(tenant.as_str())
            .execute(&mut *tx)
            .await?;
            let mut ann = BTreeMap::new();
            ann.insert("summary".to_string(), format!("Rule {} recovered", rule.0));
            let mut ev = Event::rule_health(tenant.clone(), rule, EventStatus::Resolved, ann, now);
            ev.suppressed = suppressed;
            ev.name = name;
            let id = insert_outbox_event(&mut tx, &ev).await?;
            tx.commit().await?;
            return Ok(Some((ev, id)));
        }

        tx.commit().await?;
        Ok(None)
    }

    fn health_from_row(r: &PgRow) -> RuleHealth {
        RuleHealth {
            status: r.get("health_status"),
            consecutive_failures: r.get("consecutive_failures"),
            degraded_since: r.get("degraded_since"),
            last_error: r.get("last_error"),
            last_error_at: r.get("last_error_at"),
        }
    }

    fn rollup_from_row(r: &PgRow) -> crate::domain::rollup::RuleRollup {
        crate::domain::rollup::RuleRollup {
            state: crate::domain::rollup::AlertState::from_db(&r.get::<String, _>("alert_state")),
            firing_instance_count: r.get("firing_instance_count"),
            fired_at: r.get("last_fired_at"),
            resolved_at: r.get("last_resolved_at"),
            seen_at: r.get("last_seen_at"),
            row_count: r.get("last_row_count"),
        }
    }

    /// Like `get_rule`, but also returns the rule's health (for the API representation)
    /// and `updated_at` (maintained by every rule write: the insert default on create,
    /// `now()` on spec update, pause and resume).
    pub async fn get_rule_with_health(
        &self,
        tenant: TenantId,
        id: RuleId,
    ) -> Result<Option<(Rule, RuleHealth, RuleRollup, OffsetDateTime)>, StoreError> {
        let row = sqlx::query(
            "SELECT namespace, name, spec, version, paused, updated_at, health_status, consecutive_failures,
                    degraded_since, last_error, last_error_at,
                    alert_state, firing_instance_count, last_fired_at,
                    last_resolved_at, last_seen_at, last_row_count
               FROM rules WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(None),
            Some(r) => {
                let health = Self::health_from_row(&r);
                let rollup = Self::rollup_from_row(&r);
                let updated_at = r.get("updated_at");
                let rule = rule_from_row(&r, id, tenant)?;
                Ok(Some((rule, health, rollup, updated_at)))
            }
        }
    }

    /// One keyset page of the rule listing, ordered by `(created_at, id)`.
    ///
    /// `after` is the exclusive resume position (the key of the last row on the
    /// previous page); `None` starts from the beginning. `health` is
    /// `Some("degraded")` / `Some("healthy")` or `None` for all. Returns at most
    /// `limit` rows plus, when more rows remain past the page, the key to resume
    /// from (the returned page's last row).
    pub async fn list_rules_page(
        &self,
        tenant: &TenantId,
        health: Option<&str>,
        namespace: Option<&str>,
        name: Option<&str>,
        after: Option<&RulePageKey>,
        limit: i64,
    ) -> Result<
        (
            Vec<(Rule, RuleHealth, RuleRollup, OffsetDateTime)>,
            Option<RulePageKey>,
        ),
        StoreError,
    > {
        // Fetch one extra row: its presence (not its content) tells us whether a
        // next page exists, so `next` is only set when resuming would yield rows.
        let rows = sqlx::query(
            "SELECT id, created_at, updated_at, namespace, name, spec, version, paused, health_status, consecutive_failures,
                    degraded_since, last_error, last_error_at,
                    alert_state, firing_instance_count, last_fired_at,
                    last_resolved_at, last_seen_at, last_row_count
               FROM rules
              WHERE tenant=$1 AND ($2::text IS NULL OR health_status=$2)
                AND ($3::text IS NULL OR namespace=$3)
                AND ($4::text IS NULL OR name=$4)
                AND ($5::timestamptz IS NULL OR (created_at, id) > ($5, $6))
              ORDER BY created_at, id
              LIMIT $7",
        )
        .bind(tenant.as_str())
        .bind(health)
        .bind(namespace)
        .bind(name)
        .bind(after.map(|k| k.created_at))
        .bind(after.map(|k| k.id.0))
        .bind(limit + 1)
        .fetch_all(&self.pool)
        .await?;
        let has_more = rows.len() as i64 > limit;
        let mut out = Vec::with_capacity(rows.len().min(limit as usize));
        let mut last_key = None;
        for r in rows.iter().take(limit as usize) {
            let health = Self::health_from_row(r);
            let rollup = Self::rollup_from_row(r);
            let id = RuleId(r.get("id"));
            last_key = Some(RulePageKey {
                created_at: r.get("created_at"),
                id,
            });
            let rule = rule_from_row(r, id, tenant.clone())?;
            out.push((rule, health, rollup, r.get("updated_at")));
        }
        Ok((out, if has_more { last_key } else { None }))
    }

    // ---- idempotency ----

    /// Returns true if this (rule, eval_ts) was newly claimed; false if already applied.
    pub async fn try_claim_eval(
        &self,
        rule: RuleId,
        eval_ts: OffsetDateTime,
    ) -> Result<bool, StoreError> {
        let res = sqlx::query(
            "INSERT INTO evaluations (rule, eval_ts) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(rule.0)
        .bind(eval_ts)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    /// Batch counterpart of [`Self::try_claim_eval`]: claim every `(id, eval_ts)`
    /// pair in one round trip. Returns one bool per input pair, in input order,
    /// with the same row-level conflict semantics as the per-pair claim: `true`
    /// iff this call newly claimed that pair. A pair repeated within one call
    /// wins at its first occurrence only, matching what the per-pair claim did
    /// when the loop reached the duplicate.
    ///
    /// The mapping back to input positions goes through `WITH ORDINALITY` (never
    /// timestamp equality in Rust): Postgres rounds `timestamptz` to
    /// microseconds, so a returned `eval_ts` need not bit-compare to the input.
    /// Shared by the rule- and SLO-side claims, which differ only in table.
    async fn try_claim_batch(
        &self,
        table: &str,
        id_column: &str,
        pairs_ids: Vec<Uuid>,
        pairs_ts: Vec<OffsetDateTime>,
        total: usize,
        dedup_index: &[Option<usize>],
    ) -> Result<Vec<bool>, StoreError> {
        let mut claimed = vec![false; total];
        if pairs_ids.is_empty() {
            return Ok(claimed);
        }
        let sql = format!(
            "WITH input({id_column}, eval_ts, ord) AS (
                SELECT * FROM UNNEST($1::uuid[], $2::timestamptz[]) WITH ORDINALITY
             ), inserted AS (
                INSERT INTO {table} ({id_column}, eval_ts)
                SELECT {id_column}, eval_ts FROM input
                ON CONFLICT DO NOTHING
                RETURNING {id_column}, eval_ts
             )
             SELECT input.ord FROM input JOIN inserted USING ({id_column}, eval_ts)"
        );
        let ords: Vec<i64> = sqlx::query_scalar(&sql)
            .bind(&pairs_ids)
            .bind(&pairs_ts)
            .fetch_all(&self.pool)
            .await?;
        // `dedup_index[i]` is the position of input pair `i` in the deduped
        // arrays (None for a repeat, which by definition lost the claim).
        for (i, unique_pos) in dedup_index.iter().enumerate() {
            if let Some(pos) = unique_pos {
                claimed[i] = ords.contains(&(*pos as i64 + 1));
            }
        }
        Ok(claimed)
    }

    /// Dedup helper for the batch claims: split `(uuid, ts)` pairs into parallel
    /// unnest arrays of first occurrences, plus the input-position -> unique-position
    /// mapping (`None` marks a repeated pair).
    #[allow(clippy::type_complexity)]
    fn dedup_claim_pairs(
        pairs: &[(Uuid, OffsetDateTime)],
    ) -> (Vec<Uuid>, Vec<OffsetDateTime>, Vec<Option<usize>>) {
        let mut ids = Vec::with_capacity(pairs.len());
        let mut tss = Vec::with_capacity(pairs.len());
        let mut index = Vec::with_capacity(pairs.len());
        let mut seen: std::collections::HashMap<(Uuid, OffsetDateTime), usize> =
            std::collections::HashMap::new();
        for &(id, ts) in pairs {
            match seen.entry((id, ts)) {
                std::collections::hash_map::Entry::Occupied(_) => index.push(None),
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert(ids.len());
                    index.push(Some(ids.len()));
                    ids.push(id);
                    tss.push(ts);
                }
            }
        }
        (ids, tss, index)
    }

    /// Claim many (rule, eval_ts) pairs in one round trip; see [`Self::try_claim_batch`].
    pub async fn try_claim_evals(
        &self,
        pairs: &[(RuleId, OffsetDateTime)],
    ) -> Result<Vec<bool>, StoreError> {
        let raw: Vec<(Uuid, OffsetDateTime)> = pairs.iter().map(|&(r, ts)| (r.0, ts)).collect();
        let (ids, tss, index) = Self::dedup_claim_pairs(&raw);
        self.try_claim_batch("evaluations", "rule", ids, tss, pairs.len(), &index)
            .await
    }

    // ---- instances ----

    /// Load a rule's instances, tenant-scoped. Callers already resolve the rule via
    /// `get_rule(tenant, rule)`; the tenant predicate here is defense-in-depth so a
    /// mismatched (tenant, rule) pair can never read another tenant's instances.
    pub async fn load_instances(
        &self,
        tenant: &TenantId,
        rule: RuleId,
    ) -> Result<Vec<InstanceState>, StoreError> {
        let rows = sqlx::query(
            "SELECT key, rule AS source, tenant, status, labels, value, active_since, last_seen, absent_count
             FROM instances WHERE rule=$1 AND tenant=$2",
        )
        .bind(rule.0)
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            out.push(row_to_instance(r, SourceKind::Rule)?);
        }
        Ok(out)
    }

    /// Single-instance upsert. A thin wrapper over [`Self::persist_eval_batch`] (the
    /// production write path) so the upsert semantics — including the tenant-guarded
    /// conflict update — cannot drift from it. Test-only convenience today.
    pub async fn upsert_instance(&self, s: &InstanceState) -> Result<(), StoreError> {
        self.persist_eval_batch(std::slice::from_ref(s), &[], None, None, None)
            .await?;
        Ok(())
    }

    /// Union of rule-side and SLO-side (burn-rate) firing/pending alerts. Each arm
    /// stamps a `source_kind` literal so the mapper wraps the row's uuid into the
    /// right [`SourceId`] variant (SLO rows also carry the `slo_tier` label); the
    /// `ORDER BY` applies to the combined result set.
    pub async fn list_alerts(&self, tenant: TenantId) -> Result<Vec<InstanceState>, StoreError> {
        let rows = sqlx::query(
            "SELECT key, rule AS source, 'rule' AS source_kind, tenant, status, labels, value,
                    active_since, last_seen, absent_count
             FROM instances WHERE tenant=$1 AND status != 'inactive'
             UNION ALL
             SELECT key, slo AS source, 'slo' AS source_kind, tenant, status, labels, value,
                    active_since, last_seen, absent_count
             FROM slo_instances WHERE tenant=$1 AND status != 'inactive'
             ORDER BY active_since DESC",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            let kind = SourceKind::from_db(r.get::<&str, _>("source_kind"));
            out.push(row_to_instance(r, kind)?);
        }
        Ok(out)
    }

    // ---- subscriptions ----

    pub async fn create_subscription(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
        url: &str,
    ) -> Result<Subscription, StoreError> {
        let id = Uuid::new_v4();
        let enc = crate::crypto::encrypt_str(cipher, url)?;
        let row = sqlx::query(
            "INSERT INTO subscriptions (id, tenant, webhook_url) VALUES ($1,$2,$3)
             RETURNING created_at",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(&enc)
        .fetch_one(&self.pool)
        .await?;
        Ok(Subscription {
            id,
            tenant,
            webhook_url: url.to_string(),
            created_at: row.get("created_at"),
        })
    }

    pub async fn subscriptions_for(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
    ) -> Result<Vec<Subscription>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, webhook_url, created_at FROM subscriptions
             WHERE tenant=$1 ORDER BY created_at",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            let enc: String = r.get("webhook_url");
            let webhook_url = crate::crypto::decrypt_str(cipher, &enc)?;
            out.push(Subscription {
                id: r.get("id"),
                tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
                webhook_url,
                created_at: r.get("created_at"),
            });
        }
        Ok(out)
    }

    /// Delete a subscription by id. Tenant-scoped: an id belonging to another tenant is
    /// treated as not found. Returns whether a row was removed.
    pub async fn delete_subscription(
        &self,
        tenant: TenantId,
        id: Uuid,
    ) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM subscriptions WHERE tenant=$1 AND id=$2")
            .bind(tenant.as_str())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    // ---- notification log ----

    /// Begin a notification: insert a `pending` row keyed by `dedup_key`.
    /// Returns true if newly inserted (caller should attempt delivery); false if a
    /// row already exists (already sent, or pending/in-flight) — caller skips to
    /// avoid a duplicate send. NOTE: a row left `pending` by a crash mid-send blocks
    /// redelivery of that exact event to that target; Phase 3 adds a stale-pending sweep.
    pub async fn try_begin_notification(
        &self,
        dedup_key: &str,
        tenant: TenantId,
        channel: &str,
        target: &str,
    ) -> Result<bool, StoreError> {
        let res = sqlx::query(
            "INSERT INTO notifications (dedup_key, tenant, channel, target)
             VALUES ($1,$2,$3,$4) ON CONFLICT (dedup_key) DO NOTHING",
        )
        .bind(dedup_key)
        .bind(tenant.as_str())
        .bind(channel)
        .bind(target)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    /// Tenant-scoped for defense in depth: dedup keys are content hashes generated
    /// server-side, but no notifications query runs keyed by dedup_key alone.
    pub async fn mark_notification_sent(
        &self,
        tenant: &TenantId,
        dedup_key: &str,
        attempts: u32,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "UPDATE notifications SET status='sent', attempts=$2, updated_at=now()
             WHERE dedup_key=$1 AND tenant=$3",
        )
        .bind(dedup_key)
        .bind(attempts as i32)
        .bind(tenant.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_notification_failed(
        &self,
        tenant: &TenantId,
        dedup_key: &str,
        attempts: u32,
        error: &str,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "UPDATE notifications SET status='failed', attempts=$2, last_error=$3, updated_at=now()
             WHERE dedup_key=$1 AND tenant=$4",
        )
        .bind(dedup_key)
        .bind(attempts as i32)
        .bind(error)
        .bind(tenant.as_str())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Test/inspection helper: fetch (status, attempts) for a tenant's dedup_key.
    pub async fn notification_status(
        &self,
        tenant: &TenantId,
        dedup_key: &str,
    ) -> Result<Option<(String, i32)>, StoreError> {
        let row = sqlx::query(
            "SELECT status, attempts FROM notifications WHERE dedup_key=$1 AND tenant=$2",
        )
        .bind(dedup_key)
        .bind(tenant.as_str())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| (r.get::<String, _>("status"), r.get::<i32, _>("attempts"))))
    }

    // ---- channels ----

    /// Create or replace a named channel by (tenant, name). Upsert semantics
    /// (PUT-like): re-issuing the same name replaces its config, which is how a
    /// secret is rotated without touching the receivers that reference it.
    /// Create-only channel insert: `None` if a channel with this name already
    /// exists for the tenant (the caller surfaces a 409; the stored config —
    /// including its encrypted secret — is never overwritten). The upsert path
    /// is [`Self::create_channel`].
    pub async fn insert_channel(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
        name: &str,
        config: &ChannelConfig,
    ) -> Result<Option<Channel>, StoreError> {
        let id = Uuid::new_v4();
        let cfg_json = crate::crypto::encrypt_channel(cipher, config)?;
        let row = sqlx::query(
            "INSERT INTO channels (id, tenant, name, config) VALUES ($1,$2,$3,$4)
             ON CONFLICT (tenant, name) DO NOTHING
             RETURNING id",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(name)
        .bind(&cfg_json)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| Channel {
            id: r.get("id"),
            tenant,
            name: name.to_string(),
            config: config.clone(),
        }))
    }

    /// Create or replace a channel by (tenant, name), replacing the stored
    /// (encrypted) config wholesale. The create-only path is [`Self::insert_channel`].
    pub async fn create_channel(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
        name: &str,
        config: &ChannelConfig,
    ) -> Result<Channel, StoreError> {
        let id = Uuid::new_v4();
        let cfg_json = crate::crypto::encrypt_channel(cipher, config)?;
        let row = sqlx::query(
            "INSERT INTO channels (id, tenant, name, config) VALUES ($1,$2,$3,$4)
             ON CONFLICT (tenant, name) DO UPDATE SET config = EXCLUDED.config
             RETURNING id",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(name)
        .bind(&cfg_json)
        .fetch_one(&self.pool)
        .await?;
        Ok(Channel {
            id: row.get("id"),
            tenant,
            name: name.to_string(),
            config: config.clone(),
        })
    }

    pub async fn get_channel(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
        name: &str,
    ) -> Result<Option<Channel>, StoreError> {
        let row = sqlx::query(
            "SELECT id, tenant, name, config FROM channels WHERE tenant=$1 AND name=$2",
        )
        .bind(tenant.as_str())
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(None),
            Some(r) => Ok(Some(Self::channel_from_row(cipher, &r)?)),
        }
    }

    pub async fn list_channels(
        &self,
        cipher: &dyn SecretCipher,
        tenant: TenantId,
    ) -> Result<Vec<Channel>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, name, config FROM channels WHERE tenant=$1 ORDER BY name",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| Self::channel_from_row(cipher, r))
            .collect()
    }

    /// Load a set of channels by name (dispatcher resolution path). Names with no
    /// stored channel are simply absent from the result; the caller decides how to
    /// treat the gap (the flusher skips them with an error log).
    pub async fn channels_by_names(
        &self,
        cipher: &dyn SecretCipher,
        tenant: &TenantId,
        names: &[String],
    ) -> Result<Vec<Channel>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, name, config FROM channels WHERE tenant=$1 AND name = ANY($2)",
        )
        .bind(tenant.as_str())
        .bind(names)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| Self::channel_from_row(cipher, r))
            .collect()
    }

    /// Which of `names` exist as channels for the tenant (receiver-validation path).
    pub async fn existing_channel_names(
        &self,
        tenant: &TenantId,
        names: &[String],
    ) -> Result<Vec<String>, StoreError> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT name FROM channels WHERE tenant=$1 AND name = ANY($2)",
        )
        .bind(tenant.as_str())
        .bind(names)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Names of the receivers that reference channel `name`.
    pub async fn receivers_referencing_channel(
        &self,
        tenant: &TenantId,
        name: &str,
    ) -> Result<Vec<String>, StoreError> {
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT name FROM receivers
             WHERE tenant=$1 AND channels @> to_jsonb(ARRAY[$2::text])
             ORDER BY name",
        )
        .bind(tenant.as_str())
        .bind(name)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Delete a channel unless a receiver still references it.
    ///
    /// The referrer check races receiver creation: a `FOR SHARE` over the referrers
    /// locks no rows when there are none, so a concurrent receiver write could
    /// validate the channel, commit a reference to it, and slip past a referrer check
    /// that had already run. Because receiver channel lists are JSON with no foreign
    /// key, that would strand a dangling reference. Instead we take `FOR UPDATE` on the
    /// channel row itself, up front, as the single serialization point: receiver writes
    /// take `FOR KEY SHARE` on the channels they reference (see
    /// [`lock_referenced_channels`]), which conflicts with this `FOR UPDATE`. Either a
    /// receiver write commits before we take the lock (and its row is then visible to
    /// the referrer check), or it blocks until we remove the channel (and then observes
    /// it gone and aborts). No interleaving leaves a reference to a deleted channel.
    pub async fn delete_channel(
        &self,
        tenant: TenantId,
        name: &str,
    ) -> Result<ChannelDelete, StoreError> {
        let mut tx = self.pool.begin().await?;
        let locked: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM channels WHERE tenant=$1 AND name=$2 FOR UPDATE")
                .bind(tenant.as_str())
                .bind(name)
                .fetch_optional(&mut *tx)
                .await?;
        if locked.is_none() {
            tx.rollback().await?;
            return Ok(ChannelDelete::NotFound);
        }
        // The channel row is now locked `FOR UPDATE`, so no concurrent receiver write
        // referencing it can be mid-flight; every committed referrer is visible here and
        // no new one can commit until we release the lock.
        let referrers: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM receivers
             WHERE tenant=$1 AND channels @> to_jsonb(ARRAY[$2::text])
             ORDER BY name",
        )
        .bind(tenant.as_str())
        .bind(name)
        .fetch_all(&mut *tx)
        .await?;
        if !referrers.is_empty() {
            tx.rollback().await?;
            return Ok(ChannelDelete::InUse(referrers));
        }
        sqlx::query("DELETE FROM channels WHERE tenant=$1 AND name=$2")
            .bind(tenant.as_str())
            .bind(name)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(ChannelDelete::Deleted)
    }

    fn channel_from_row(cipher: &dyn SecretCipher, r: &PgRow) -> Result<Channel, StoreError> {
        let v: serde_json::Value = r.get("config");
        let config = crate::crypto::decrypt_channel(cipher, &v)?;
        Ok(Channel {
            id: r.get("id"),
            tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
            name: r.get("name"),
            config,
        })
    }

    // ---- receivers ----

    /// Create-only receiver insert. [`ReceiverInsert::NameConflict`] if a receiver with
    /// this name already exists for the tenant (the caller surfaces a 409). The upsert
    /// path is [`Self::create_receiver`]. Referenced channels are locked and confirmed to
    /// exist inside the write transaction (see [`Self::create_receiver`]); a channel
    /// removed by a concurrent delete surfaces as [`ReceiverInsert::MissingChannels`].
    /// The channel check precedes the insert, so unknown channels (422) win over a name
    /// conflict (409), matching the boundary order.
    pub async fn insert_receiver(
        &self,
        tenant: TenantId,
        name: &str,
        channels: &[String],
        annotations: &BTreeMap<String, String>,
    ) -> Result<ReceiverInsert, StoreError> {
        let id = Uuid::new_v4();
        let ch_json = serde_json::to_value(channels)?;
        let ann_json = serde_json::to_value(annotations)?;
        let mut tx = self.pool.begin().await?;
        let missing = lock_referenced_channels(&mut tx, &tenant, channels).await?;
        if !missing.is_empty() {
            tx.rollback().await?;
            return Ok(ReceiverInsert::MissingChannels(missing));
        }
        let row = sqlx::query(
            "INSERT INTO receivers (id, tenant, name, channels, annotations) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (tenant, name) DO NOTHING
             RETURNING id",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(name)
        .bind(&ch_json)
        .bind(&ann_json)
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(match row {
            Some(r) => ReceiverInsert::Created(Receiver {
                id: r.get("id"),
                tenant,
                name: name.to_string(),
                channels: channels.to_vec(),
                annotations: annotations.clone(),
            }),
            None => ReceiverInsert::NameConflict,
        })
    }

    /// Create or replace a receiver by (tenant, name). Upsert semantics (PUT-like):
    /// re-issuing the same name updates its channel references. The create-only path is
    /// [`Self::insert_receiver`]. `channels` non-emptiness is enforced at the API
    /// boundary; the column holds a JSON array of channel names and never any secret.
    ///
    /// Referenced-channel existence is enforced *inside* the write transaction, under a
    /// `FOR KEY SHARE` lock on each channel row ([`lock_referenced_channels`]), so the
    /// insert cannot race a `delete_channel` into a dangling reference. The API boundary
    /// still pre-checks existence for a friendly 422 on the common (non-racing) case;
    /// the in-transaction check is the authority that closes the race, and reports a
    /// channel a concurrent delete removed as [`ReceiverUpsert::MissingChannels`].
    pub async fn create_receiver(
        &self,
        tenant: TenantId,
        name: &str,
        channels: &[String],
        annotations: &BTreeMap<String, String>,
    ) -> Result<ReceiverUpsert, StoreError> {
        let id = Uuid::new_v4();
        let ch_json = serde_json::to_value(channels)?;
        let ann_json = serde_json::to_value(annotations)?;
        let mut tx = self.pool.begin().await?;
        let missing = lock_referenced_channels(&mut tx, &tenant, channels).await?;
        if !missing.is_empty() {
            tx.rollback().await?;
            return Ok(ReceiverUpsert::MissingChannels(missing));
        }
        let row = sqlx::query(
            "INSERT INTO receivers (id, tenant, name, channels, annotations) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (tenant, name) DO UPDATE
                SET channels = EXCLUDED.channels, annotations = EXCLUDED.annotations
             RETURNING id",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(name)
        .bind(&ch_json)
        .bind(&ann_json)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(ReceiverUpsert::Stored(Receiver {
            id: row.get("id"),
            tenant,
            name: name.to_string(),
            channels: channels.to_vec(),
            annotations: annotations.clone(),
        }))
    }

    pub async fn get_receiver(
        &self,
        tenant: TenantId,
        name: &str,
    ) -> Result<Option<Receiver>, StoreError> {
        let row = sqlx::query(
            "SELECT id, tenant, name, channels, annotations
             FROM receivers WHERE tenant=$1 AND name=$2",
        )
        .bind(tenant.as_str())
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(None),
            Some(r) => {
                let channels: Vec<String> = serde_json::from_value(r.get("channels"))?;
                let annotations: BTreeMap<String, String> =
                    serde_json::from_value(r.get("annotations"))?;
                Ok(Some(Receiver {
                    id: r.get("id"),
                    tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
                    name: r.get("name"),
                    channels,
                    annotations,
                }))
            }
        }
    }

    pub async fn list_receivers(&self, tenant: TenantId) -> Result<Vec<Receiver>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, name, channels, annotations
             FROM receivers WHERE tenant=$1 ORDER BY name",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            let channels: Vec<String> = serde_json::from_value(r.get("channels"))?;
            let annotations: BTreeMap<String, String> =
                serde_json::from_value(r.get("annotations"))?;
            out.push(Receiver {
                id: r.get("id"),
                tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
                name: r.get("name"),
                channels,
                annotations,
            });
        }
        Ok(out)
    }

    pub async fn delete_receiver(&self, tenant: TenantId, name: &str) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM receivers WHERE tenant=$1 AND name=$2")
            .bind(tenant.as_str())
            .bind(name)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    // ---- routes ----

    #[allow(clippy::too_many_arguments)]
    pub async fn create_route(
        &self,
        tenant: TenantId,
        matchers: &[Matcher],
        receiver: &str,
        continue_matching: bool,
        priority: i32,
        group_by: Option<&[String]>,
        group_wait_secs: Option<u32>,
        group_interval_secs: Option<u32>,
        repeat_interval_secs: Option<u32>,
    ) -> Result<Route, StoreError> {
        let id = Uuid::new_v4();
        let m_json = serde_json::to_value(matchers)?;
        let gb_json: Option<serde_json::Value> = match group_by {
            Some(g) => Some(serde_json::to_value(g)?),
            None => None,
        };
        sqlx::query(
            "INSERT INTO routes
               (id, tenant, matchers, receiver, continue_matching, priority,
                group_by, group_wait_secs, group_interval_secs, repeat_interval_secs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(&m_json)
        .bind(receiver)
        .bind(continue_matching)
        .bind(priority)
        .bind(&gb_json)
        .bind(group_wait_secs.map(|v| v as i32))
        .bind(group_interval_secs.map(|v| v as i32))
        .bind(repeat_interval_secs.map(|v| v as i32))
        .execute(&self.pool)
        .await?;
        Ok(Route {
            id,
            tenant,
            matchers: matchers.to_vec(),
            receiver: receiver.to_string(),
            continue_matching,
            priority,
            group_by: group_by.map(|g| g.to_vec()),
            group_wait_secs,
            group_interval_secs,
            repeat_interval_secs,
        })
    }

    /// Full-body replace of a route (PUT semantics). `created_at` is preserved, so the
    /// route keeps its position among equal priorities. Returns None when no route with
    /// that id exists for the tenant.
    #[allow(clippy::too_many_arguments)]
    pub async fn update_route(
        &self,
        tenant: TenantId,
        id: Uuid,
        matchers: &[Matcher],
        receiver: &str,
        continue_matching: bool,
        priority: i32,
        group_by: Option<&[String]>,
        group_wait_secs: Option<u32>,
        group_interval_secs: Option<u32>,
        repeat_interval_secs: Option<u32>,
    ) -> Result<Option<Route>, StoreError> {
        let m_json = serde_json::to_value(matchers)?;
        let gb_json: Option<serde_json::Value> = match group_by {
            Some(g) => Some(serde_json::to_value(g)?),
            None => None,
        };
        let res = sqlx::query(
            "UPDATE routes
                SET matchers=$3, receiver=$4, continue_matching=$5, priority=$6,
                    group_by=$7, group_wait_secs=$8, group_interval_secs=$9,
                    repeat_interval_secs=$10
              WHERE tenant=$1 AND id=$2",
        )
        .bind(tenant.as_str())
        .bind(id)
        .bind(&m_json)
        .bind(receiver)
        .bind(continue_matching)
        .bind(priority)
        .bind(&gb_json)
        .bind(group_wait_secs.map(|v| v as i32))
        .bind(group_interval_secs.map(|v| v as i32))
        .bind(repeat_interval_secs.map(|v| v as i32))
        .execute(&self.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Ok(None);
        }
        Ok(Some(Route {
            id,
            tenant,
            matchers: matchers.to_vec(),
            receiver: receiver.to_string(),
            continue_matching,
            priority,
            group_by: group_by.map(|g| g.to_vec()),
            group_wait_secs,
            group_interval_secs,
            repeat_interval_secs,
        }))
    }

    /// All routes for a tenant, in evaluation order (priority asc, then creation order).
    pub async fn routes_for(&self, tenant: TenantId) -> Result<Vec<Route>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, matchers, receiver, continue_matching, priority,
                    group_by, group_wait_secs, group_interval_secs, repeat_interval_secs
             FROM routes WHERE tenant=$1 ORDER BY priority ASC, created_at ASC",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            let matchers: Vec<Matcher> = serde_json::from_value(r.get("matchers"))?;
            let group_by: Option<Vec<String>> =
                match r.get::<Option<serde_json::Value>, _>("group_by") {
                    Some(v) => Some(serde_json::from_value(v)?),
                    None => None,
                };
            out.push(Route {
                id: r.get("id"),
                tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
                matchers,
                receiver: r.get("receiver"),
                continue_matching: r.get("continue_matching"),
                priority: r.get("priority"),
                group_by,
                group_wait_secs: r.get::<Option<i32>, _>("group_wait_secs").map(|v| v as u32),
                group_interval_secs: r
                    .get::<Option<i32>, _>("group_interval_secs")
                    .map(|v| v as u32),
                repeat_interval_secs: r
                    .get::<Option<i32>, _>("repeat_interval_secs")
                    .map(|v| v as u32),
            });
        }
        Ok(out)
    }

    pub async fn delete_route(&self, tenant: TenantId, id: Uuid) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM routes WHERE tenant=$1 AND id=$2")
            .bind(tenant.as_str())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    // ---- silences ----

    pub async fn create_silence(
        &self,
        tenant: TenantId,
        matchers: &[Matcher],
        starts_at: OffsetDateTime,
        ends_at: OffsetDateTime,
        comment: &str,
        author: &str,
    ) -> Result<Silence, StoreError> {
        let id = Uuid::new_v4();
        let m_json = serde_json::to_value(matchers)?;
        let created_at = OffsetDateTime::now_utc();
        sqlx::query(
            "INSERT INTO silences (id, tenant, matchers, starts_at, ends_at, comment, author, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(&m_json)
        .bind(starts_at)
        .bind(ends_at)
        .bind(comment)
        .bind(author)
        .bind(created_at)
        .execute(&self.pool)
        .await?;
        Ok(Silence {
            id,
            tenant,
            matchers: matchers.to_vec(),
            starts_at,
            ends_at,
            comment: comment.to_string(),
            author: author.to_string(),
            created_at,
        })
    }

    pub async fn list_silences(&self, tenant: TenantId) -> Result<Vec<Silence>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, matchers, starts_at, ends_at, comment, author, created_at
             FROM silences WHERE tenant=$1 ORDER BY created_at DESC",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_silence).collect()
    }

    pub async fn list_active_silences(
        &self,
        tenant: TenantId,
        now: OffsetDateTime,
    ) -> Result<Vec<Silence>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, matchers, starts_at, ends_at, comment, author, created_at
             FROM silences WHERE tenant=$1 AND starts_at <= $2 AND ends_at > $2",
        )
        .bind(tenant.as_str())
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_silence).collect()
    }

    pub async fn delete_silence(&self, tenant: TenantId, id: Uuid) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM silences WHERE tenant=$1 AND id=$2")
            .bind(tenant.as_str())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    // ---- inhibitions ----

    pub async fn create_inhibition(
        &self,
        tenant: TenantId,
        source_matchers: &[Matcher],
        target_matchers: &[Matcher],
        equal: &[String],
    ) -> Result<InhibitionRule, StoreError> {
        let id = Uuid::new_v4();
        let src = serde_json::to_value(source_matchers)?;
        let tgt = serde_json::to_value(target_matchers)?;
        let eq = serde_json::to_value(equal)?;
        let created_at = OffsetDateTime::now_utc();
        sqlx::query(
            "INSERT INTO inhibitions (id, tenant, source_matchers, target_matchers, equal, created_at)
             VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(&src)
        .bind(&tgt)
        .bind(&eq)
        .bind(created_at)
        .execute(&self.pool)
        .await?;
        Ok(InhibitionRule {
            id,
            tenant,
            source_matchers: source_matchers.to_vec(),
            target_matchers: target_matchers.to_vec(),
            equal: equal.to_vec(),
            created_at,
        })
    }

    pub async fn list_inhibitions(
        &self,
        tenant: TenantId,
    ) -> Result<Vec<InhibitionRule>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, tenant, source_matchers, target_matchers, equal, created_at
             FROM inhibitions WHERE tenant=$1 ORDER BY created_at ASC",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_inhibition).collect()
    }

    pub async fn delete_inhibition(&self, tenant: TenantId, id: Uuid) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM inhibitions WHERE tenant=$1 AND id=$2")
            .bind(tenant.as_str())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Firing instances for a tenant, enriched with the rule's severity (projected
    /// straight out of the spec JSONB, so a snapshot refresh never decodes every full
    /// rule spec just to read one field). Used as the inhibition source-set.
    pub async fn list_firing(&self, tenant: TenantId) -> Result<Vec<FiringInstance>, StoreError> {
        let rows = sqlx::query(
            "SELECT i.key AS key, i.rule AS rule, i.labels AS labels,
                    r.spec->'severity' AS severity
             FROM instances i JOIN rules r ON r.id = i.rule
             WHERE i.tenant=$1 AND i.status=$2",
        )
        .bind(tenant.as_str())
        .bind(status_str(Status::Firing))
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let labels: BTreeMap<String, String> = serde_json::from_value(r.get("labels"))?;
            let severity: crate::domain::rule::Severity = serde_json::from_value(
                r.get::<Option<serde_json::Value>, _>("severity")
                    .unwrap_or(serde_json::Value::Null),
            )?;
            out.push(FiringInstance {
                key: InstanceKey(r.get("key")),
                source: SourceId::Rule(RuleId(r.get("rule"))),
                severity,
                labels,
            });
        }
        Ok(out)
    }

    // ---- reconciliation / housekeeping ----

    /// Instances still pending/firing whose last evaluation is older than
    /// max(4 * interval_secs, 60s) — i.e. the rule effectively stopped being evaluated.
    /// Enriched with severity + annotations from the rule spec so the caller can
    /// synthesize a Resolved event. `now` is passed in for testability.
    ///
    /// The staleness window is GREATEST(4 * interval_secs, 60) seconds, applied per rule
    /// from the rule spec. This SQL is the authoritative definition; the reconcile_it
    /// integration test (stale_query_uses_per_rule_interval) guards the per-rule behavior.
    ///
    /// At most `limit` rows are returned, ordered oldest-first, so the caller can drain a
    /// backlog in bounded chunks instead of one unbounded sweep. Because reconciliation
    /// resets each returned instance out of the pending/firing set, successive calls with
    /// the same `now` advance through the backlog without an OFFSET.
    pub async fn list_stale_instances(
        &self,
        now: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<StaleInstance>, StoreError> {
        let rows = sqlx::query(
            "SELECT i.key AS key, i.rule AS rule, i.tenant AS tenant, i.status AS status,
                    i.labels AS labels, i.value AS value,
                    r.spec->'severity' AS severity, r.spec->'annotations' AS annotations,
                    r.spec->'suppressed' AS suppressed, r.name AS name
             FROM instances i JOIN rules r ON r.id = i.rule
             WHERE i.status IN ('pending','firing')
               AND NOT r.paused
               AND r.health_status <> 'degraded'
               -- A failing-but-not-yet-degraded rule (consecutive_failures > 0, still
               -- 'healthy') froze deliberately (freeze-on-error): the reaper must not
               -- resolve its instances before the degrade threshold decides. Without
               -- this guard, a degrade_after > 4 configuration races the 4x-cadence
               -- staleness window and the reaper wins, resolving instances a source
               -- that is about to legitimately degrade.
               AND r.consecutive_failures = 0
               AND i.last_seen < ($1::timestamptz
                   - make_interval(secs => GREATEST(4 * (r.spec->>'interval_secs')::int, 60)))
             ORDER BY i.last_seen
             LIMIT $2",
        )
        .bind(now)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let labels: BTreeMap<String, String> = serde_json::from_value(r.get("labels"))?;
            // Projected spec fields (severity/annotations/suppressed), not the full
            // JSONB blob: everything else in the spec is dead weight on this path.
            let severity: crate::domain::rule::Severity = serde_json::from_value(
                r.get::<Option<serde_json::Value>, _>("severity")
                    .unwrap_or(serde_json::Value::Null),
            )?;
            let annotations: BTreeMap<String, String> =
                match r.get::<Option<serde_json::Value>, _>("annotations") {
                    Some(v) if !v.is_null() => serde_json::from_value(v)?,
                    _ => BTreeMap::new(),
                };
            let suppressed = match r.get::<Option<serde_json::Value>, _>("suppressed") {
                Some(serde_json::Value::Bool(b)) => b,
                _ => false,
            };
            out.push(StaleInstance {
                key: InstanceKey(r.get("key")),
                source: SourceId::Rule(RuleId(r.get("rule"))),
                tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
                status: status_from(r.get::<&str, _>("status")),
                labels,
                value: r.get("value"),
                severity,
                annotations,
                suppressed,
                name: r.get("name"),
            });
        }
        Ok(out)
    }

    /// Delete silences whose end time is before `cutoff` (housekeeping). Returns the
    /// number of rows removed.
    pub async fn gc_silences(&self, cutoff: OffsetDateTime) -> Result<u64, StoreError> {
        let res = sqlx::query("DELETE FROM silences WHERE ends_at < $1")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }

    // ---- event outbox ----

    /// Atomic write of an instance state change AND its event-to-publish, in one
    /// transaction. Returns the new outbox row id (used to delete the row after a
    /// successful publish). This is the durability primitive: the event can never be
    /// lost relative to the state write.
    pub async fn upsert_instance_with_outbox(
        &self,
        s: &InstanceState,
        ev: &Event,
    ) -> Result<Uuid, StoreError> {
        // Delegates to the batch write path (one transaction, instance upsert + outbox
        // row) so the single-row primitive shares its exact semantics.
        let ids = self
            .persist_eval_batch(
                std::slice::from_ref(s),
                std::slice::from_ref(ev),
                None,
                None,
                None,
            )
            .await?;
        Ok(ids[0])
    }

    /// Persist a batch of instance next-states and, atomically, an outbox row per event, in
    /// ONE transaction. Returns the generated outbox ids in `events` order (for the
    /// publish-then-delete dance). Empty input is a no-op. The whole rule evaluation thus
    /// commits all-or-nothing.
    ///
    /// `unnest` arrays give a fixed 9-param upsert regardless of N, so there is no parameter
    /// limit; a pathologically large instance set could be chunked into successive
    /// transactions if lock duration ever became a concern (not needed today).
    ///
    /// `cadence` (evaluator path only) applies the adaptive-backoff transition for
    /// the evaluated rule in the same transaction, so the persisted stretch can
    /// never disagree with the committed instance state. This is the chosen seam
    /// for the backoff write: the claim paths cannot decide it (they run BEFORE
    /// the evaluation whose outcome drives the transition), and a separate
    /// post-eval write would break the reset-with-the-state-that-caused-it
    /// atomicity. The transition itself is the pure function
    /// [`crate::domain::cadence::next_backoff_secs`]. `None` max = feature off =
    /// nothing read or written (the claim-path clamp neutralizes any stale state).
    ///
    /// `rule_tenant` tenant-scopes the per-rule rollup/cadence writes (defense in
    /// depth) and must be `Some` whenever `rollup` or `cadence` is. The evaluator
    /// passes the claimed rule's tenant; the maintenance sweep (cross-tenant
    /// instance batches, no rollup, no cadence) passes `None`.
    pub async fn persist_eval_batch(
        &self,
        instances: &[InstanceState],
        events: &[Event],
        rollup: Option<(RuleId, crate::domain::rollup::RuleRollup)>,
        cadence: Option<(RuleId, EvalCadence)>,
        rule_tenant: Option<&TenantId>,
    ) -> Result<Vec<Uuid>, StoreError> {
        debug_assert!(
            (rollup.is_none() && cadence.is_none()) || rule_tenant.is_some(),
            "rule_tenant is required for rollup/cadence writes"
        );
        debug_assert!(
            instances
                .iter()
                .all(|s| matches!(s.source, SourceId::Rule(_))),
            "persist_eval_batch writes the rule-side `instances` table; SLO-sourced \
             instances belong in persist_slo_eval_batch"
        );
        let cadence_on = matches!(&cadence, Some((_, c)) if c.max_interval_secs.is_some());
        if instances.is_empty() && events.is_empty() && rollup.is_none() && !cadence_on {
            return Ok(Vec::new());
        }

        let mut tx = self.pool.begin().await?;
        let ids = write_eval_batch(&mut tx, INSTANCES_UPSERT_SQL, instances, events).await?;

        // Tenant predicate for the per-rule writes below; NULL only on the
        // maintenance path, which writes neither rollup nor cadence.
        let rt: Option<&str> = rule_tenant.map(|t| t.as_str());

        if let Some((rule_id, r)) = rollup {
            // COALESCE the only-advance timestamps: a None this eval must not clear a
            // prior value. last_seen_at/firing_instance_count/alert_state/last_row_count
            // are authoritative for the eval and always overwrite.
            sqlx::query(
                "UPDATE rules SET
                   alert_state = $2,
                   firing_instance_count = $3,
                   last_row_count = $4,
                   last_fired_at = COALESCE($5, last_fired_at),
                   last_resolved_at = COALESCE($6, last_resolved_at),
                   last_seen_at = COALESCE($7, last_seen_at),
                   updated_at = now()
                 WHERE id = $1 AND tenant = $8",
            )
            .bind(rule_id.0)
            .bind(r.state.as_db())
            .bind(r.firing_instance_count)
            .bind(r.row_count)
            .bind(r.fired_at)
            .bind(r.resolved_at)
            .bind(r.seen_at)
            .bind(rt)
            .execute(&mut *tx)
            .await?;
        }

        if let Some((rule_id, c)) = cadence {
            if let Some(max) = c.max_interval_secs {
                if c.quiet {
                    // Read-modify-write inside the batch transaction: fetch the
                    // current stretch, advance it with the pure transition, and
                    // push next_eval out to the new effective interval. GREATEST
                    // keeps this monotone against the claim's earlier advance.
                    let cur: Option<i32> = sqlx::query_scalar(
                        "SELECT eval_backoff_secs FROM rules WHERE id = $1 AND tenant = $2",
                    )
                    .bind(rule_id.0)
                    .bind(rt)
                    .fetch_optional(&mut *tx)
                    .await?;
                    // None: rule deleted mid-flight; nothing to schedule.
                    if let Some(cur) = cur {
                        let next = crate::domain::cadence::next_backoff_secs(
                            cur.max(0) as u32,
                            c.interval_secs,
                            max,
                            true,
                        );
                        if next != cur.max(0) as u32 {
                            sqlx::query(
                                "UPDATE rules SET eval_backoff_secs = $2,
                                        next_eval = GREATEST(next_eval, $3 + make_interval(secs => $2::int))
                                 WHERE id = $1 AND tenant = $4",
                            )
                            .bind(rule_id.0)
                            .bind(next as i32)
                            .bind(c.eval_ts)
                            .bind(rt)
                            .execute(&mut *tx)
                            .await?;
                        }
                    }
                } else {
                    // Active evaluation: reset the stretch and pull next_eval back
                    // to base cadence NOW (not after one more stretched gap), so a
                    // rule that just went pending/firing is immediately re-checked
                    // at interval_secs. The guard makes this a no-op round trip
                    // for rules that were not stretched.
                    sqlx::query(
                        "UPDATE rules SET eval_backoff_secs = 0,
                                next_eval = LEAST(next_eval, $2 + make_interval(secs => $3::int))
                         WHERE id = $1 AND tenant = $4 AND eval_backoff_secs <> 0",
                    )
                    .bind(rule_id.0)
                    .bind(c.eval_ts)
                    .bind(c.interval_secs as i32)
                    .bind(rt)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }
        tx.commit().await?;
        Ok(ids)
    }

    /// Delete a set of outbox rows after their events published successfully. Empty no-op.
    pub async fn delete_outbox_batch(&self, ids: &[Uuid]) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        sqlx::query("DELETE FROM event_outbox WHERE id = ANY($1)")
            .bind(ids)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Claim outbox rows created strictly before `cutoff` (the grace boundary),
    /// oldest first. `FOR UPDATE SKIP LOCKED` avoids two callers contending on the same
    /// rows within a single query; the real single-relay guarantee is the maintenance
    /// lease. Duplicate publishes (if two relays ever overlap) are deduped downstream.
    pub async fn claim_outbox(
        &self,
        cutoff: OffsetDateTime,
        batch: i64,
    ) -> Result<Vec<(Uuid, Event)>, StoreError> {
        let rows = sqlx::query(
            "SELECT id, payload FROM event_outbox
             WHERE created_at < $1
             ORDER BY created_at
             LIMIT $2
             FOR UPDATE SKIP LOCKED",
        )
        .bind(cutoff)
        .bind(batch)
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let id: Uuid = r.get("id");
            let ev: Event = serde_json::from_value(r.get("payload"))?;
            out.push((id, ev));
        }
        Ok(out)
    }

    /// Delete one outbox row after its event was published successfully.
    pub async fn delete_outbox(&self, id: Uuid) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM event_outbox WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ---- slos ----

    /// Create an SLO. Like [`Self::create_rule`], its first `next_eval` is now
    /// plus a deterministic jitter phase (`hash(slo_id) % base_cadence`), so
    /// SLOs bulk-created by an apply spread across the cadence instead of all
    /// becoming due on the same tick and stampeding ClickHouse every cadence
    /// (the claim path advances by whole cadences, preserving the stagger).
    pub async fn create_slo(
        &self,
        tenant: TenantId,
        namespace: &str,
        name: &str,
        spec: &crate::domain::slo::SloSpec,
    ) -> Result<SloCreate, StoreError> {
        use crate::domain::ids::SloId;
        let id = Uuid::new_v4();
        let spec_json = serde_json::to_value(spec)?;
        let phase = crate::domain::cadence::jitter_offset_secs(id, self.slo_base_cadence_secs);
        let res = sqlx::query(
            "INSERT INTO slos (id, tenant, namespace, name, spec, next_eval)
             VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6::int))",
        )
        .bind(id)
        .bind(tenant.as_str())
        .bind(namespace)
        .bind(name)
        .bind(&spec_json)
        .bind(phase as i32)
        .execute(&self.pool)
        .await;
        match res {
            Ok(_) => Ok(SloCreate::Created(crate::domain::slo::Slo {
                id: SloId(id),
                tenant,
                namespace: namespace.to_string(),
                name: name.to_string(),
                spec: spec.clone(),
                version: 1,
                paused: false,
            })),
            Err(e) if is_unique_violation(&e) => Ok(SloCreate::NameConflict),
            Err(e) => Err(e.into()),
        }
    }

    /// One SLO plus its `updated_at` and `budget_epoch`. `updated_at` is bumped
    /// by every SLO write (create default, and `now()` on update/pause/resume);
    /// `budget_epoch` advances only on a budget-significant edit (sli / target /
    /// window) — see [`Self::update_slo`]. Both are store bookkeeping, returned
    /// alongside rather than on `Slo` (which mirrors the consumer definition).
    pub async fn get_slo(
        &self,
        tenant: TenantId,
        id: crate::domain::ids::SloId,
    ) -> Result<
        Option<(
            crate::domain::slo::Slo,
            time::OffsetDateTime,
            time::OffsetDateTime,
        )>,
        StoreError,
    > {
        let row = sqlx::query(
            "SELECT id, tenant, namespace, name, spec, version, paused, updated_at, budget_epoch FROM slos WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(None),
            Some(r) => Ok(Some((
                Self::slo_from_row(&r)?,
                r.get("updated_at"),
                r.get("budget_epoch"),
            ))),
        }
    }

    /// Update an SLO's spec in place, preserving its id, tenant, namespace, name
    /// (identity is immutable after create), and `paused` flag. Bumps `version`
    /// by one.
    ///
    /// `expected_version`: `Some(v)` is an optimistic-concurrency guard — if the stored
    /// version differs, nothing is written and `SloUpdate::VersionConflict` is
    /// returned. `None` means last-write-wins.
    pub async fn update_slo(
        &self,
        tenant: TenantId,
        id: crate::domain::ids::SloId,
        spec: &crate::domain::slo::SloSpec,
        expected_version: Option<i64>,
    ) -> Result<SloUpdate, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT namespace, name, version, paused, spec FROM slos WHERE id=$1 AND tenant=$2 FOR UPDATE",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(SloUpdate::NotFound);
        };
        let current: i64 = row.get("version");
        let paused: bool = row.get("paused");
        if let Some(expected) = expected_version {
            if expected != current {
                tx.rollback().await?;
                return Ok(SloUpdate::VersionConflict { current });
            }
        }
        // Does this edit redefine the objective (sli / targetPercent / timeWindow)
        // rather than just rename or re-annotate? Shared with the evaluator through
        // `objective_fingerprint` so the two can't disagree. An unparseable stored
        // spec (specs are validated on write) counts as changed — the safe default.
        let objective_changed =
            match serde_json::from_value::<crate::domain::slo::SloSpec>(row.get("spec")) {
                Ok(old) => {
                    crate::domain::slo::objective_fingerprint(&old)
                        != crate::domain::slo::objective_fingerprint(spec)
                }
                Err(_) => true,
            };
        let spec_json = serde_json::to_value(spec)?;
        // A redefining edit invalidates the status snapshot (its numbers describe
        // the old query) and resets `budget_epoch` (pre-edit history is no longer
        // comparable). Clearing the snapshot in the spec-write transaction lets
        // `apply` take effect on the next tick; the evaluator's fingerprint check is
        // the backstop for every other path.
        //
        // The existing `slo_instances` rows go too: `label_columns` is part of the
        // objective fingerprint, so a redefined objective can hash to instance keys a
        // future evaluation never reproduces. Left in place, their pending/firing rows
        // stay visible in `list_alerts` until a later evaluation happens to resolve
        // them, and forever if the SLO is paused. This mirrors the rule update path's
        // instance teardown on a label change (a silent teardown, no Resolved events).
        if objective_changed {
            sqlx::query("DELETE FROM slo_status WHERE slo=$1 AND tenant=$2")
                .bind(id.0)
                .bind(tenant.as_str())
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM slo_instances WHERE slo=$1 AND tenant=$2")
                .bind(id.0)
                .bind(tenant.as_str())
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query(
            "UPDATE slos SET spec=$3, version = version + 1, updated_at = now(),
                 budget_epoch = CASE WHEN $4 THEN now() ELSE budget_epoch END
             WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .bind(&spec_json)
        .bind(objective_changed)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(SloUpdate::Updated(crate::domain::slo::Slo {
            id,
            tenant,
            namespace: row.get("namespace"),
            name: row.get("name"),
            spec: spec.clone(),
            version: current + 1,
            paused,
        }))
    }

    pub async fn delete_slo(
        &self,
        tenant: TenantId,
        id: crate::domain::ids::SloId,
    ) -> Result<bool, StoreError> {
        let res = sqlx::query("DELETE FROM slos WHERE id=$1 AND tenant=$2")
            .bind(id.0)
            .bind(tenant.as_str())
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Pause an SLO (exclude it from evaluation). Idempotent. Returns false if no
    /// such SLO exists for the tenant.
    pub async fn pause_slo(
        &self,
        tenant: TenantId,
        id: crate::domain::ids::SloId,
    ) -> Result<bool, StoreError> {
        let res = sqlx::query(
            "UPDATE slos SET paused = true, updated_at = now() WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Resume a paused SLO. Idempotent. Returns false if no such SLO exists for the
    /// tenant.
    /// Resume a paused SLO: clear the flag and re-arm `next_eval` at the SLO's
    /// deterministic jitter phase within one cadence (mirrors
    /// [`Self::resume_rule`]), so a bulk resume does not make every SLO due at
    /// once.
    pub async fn resume_slo(
        &self,
        tenant: TenantId,
        id: crate::domain::ids::SloId,
    ) -> Result<bool, StoreError> {
        let phase = crate::domain::cadence::jitter_offset_secs(id.0, self.slo_base_cadence_secs);
        let res = sqlx::query(
            "UPDATE slos
             SET paused = false, updated_at = now(),
                 next_eval = now() + make_interval(secs => $3::int)
             WHERE id=$1 AND tenant=$2",
        )
        .bind(id.0)
        .bind(tenant.as_str())
        .bind(phase as i32)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    /// SLOs of the tenant, optionally filtered by `namespace` and/or `name`
    /// (exact match; `None` means unfiltered), each with its `updated_at` and
    /// `budget_epoch` (see [`Self::get_slo`]).
    pub async fn list_slos(
        &self,
        tenant: &TenantId,
        namespace: Option<&str>,
        name: Option<&str>,
    ) -> Result<
        Vec<(
            crate::domain::slo::Slo,
            time::OffsetDateTime,
            time::OffsetDateTime,
        )>,
        StoreError,
    > {
        let rows = sqlx::query(
            "SELECT id, tenant, namespace, name, spec, version, paused, updated_at, budget_epoch
               FROM slos
              WHERE tenant=$1
                AND ($2::text IS NULL OR namespace=$2)
                AND ($3::text IS NULL OR name=$3)
              ORDER BY created_at, id",
        )
        .bind(tenant.as_str())
        .bind(namespace)
        .bind(name)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| {
                Ok((
                    Self::slo_from_row(r)?,
                    r.get("updated_at"),
                    r.get("budget_epoch"),
                ))
            })
            .collect()
    }

    fn slo_from_row(r: &PgRow) -> Result<crate::domain::slo::Slo, StoreError> {
        use crate::domain::ids::SloId;
        use crate::domain::slo::{Slo, SloSpec};
        let spec: SloSpec = serde_json::from_value(r.get("spec"))?;
        Ok(Slo {
            id: SloId(r.get("id")),
            tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
            namespace: r.get("namespace"),
            name: r.get("name"),
            spec,
            version: r.get("version"),
            paused: r.get("paused"),
        })
    }

    /// Lean projection of SLOs for dispatch-time inhibition synthesis (see
    /// `dispatcher::slo_inhibit`), called on every snapshot refresh
    /// (`FilterCache::load`). Projects only `label_columns` out of the spec rather
    /// than decoding the full [`crate::domain::slo::Slo`] (SQL text, target, window...).
    pub async fn list_slos_for_dispatch(
        &self,
        tenant: &TenantId,
    ) -> Result<Vec<SloDispatchInfo>, StoreError> {
        use crate::domain::ids::SloId;
        let rows = sqlx::query(
            "SELECT id, tenant, spec->'sli'->'label_columns' AS label_columns
             FROM slos WHERE tenant=$1",
        )
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            // SQL NULL when the JSON key is absent — treat missing and null identically.
            let label_columns: Vec<String> =
                match r.get::<Option<serde_json::Value>, _>("label_columns") {
                    Some(v) if !v.is_null() => serde_json::from_value(v)?,
                    _ => Vec::new(),
                };
            out.push(SloDispatchInfo {
                id: SloId(r.get("id")),
                tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
                label_columns,
            });
        }
        Ok(out)
    }

    // ---- slo evaluation: due-scan ----

    /// Like [`Self::claim_due_rules_sharded`], but against `slos`. There is no per-SLO
    /// interval column (unlike rules' `spec->>'interval_secs'`) — the scheduler passes
    /// the base cadence via `base_cadence_secs` and every claimed SLO advances by that
    /// same fixed amount (no adaptive stretch axis for SLOs).
    pub async fn claim_due_slos_sharded(
        &self,
        now: OffsetDateTime,
        batch: i64,
        owned_shards: &[i32],
        shard_count: i32,
        base_cadence_secs: i32,
    ) -> Result<Vec<crate::domain::slo::Slo>, StoreError> {
        let rows = sqlx::query(
            "WITH due AS (
                 SELECT id FROM slos
                 WHERE next_eval <= $1 AND NOT paused
                   AND (((hashtext(tenant::text)::bigint % $3) + $3) % $3)::int = ANY($4)
                 ORDER BY next_eval LIMIT $2 FOR UPDATE SKIP LOCKED
             )
             UPDATE slos s
             SET next_eval = $1 + make_interval(secs => $5)
             FROM due WHERE s.id = due.id
             RETURNING s.id, s.tenant, s.namespace, s.name, s.spec, s.version, s.paused",
        )
        .bind(now)
        .bind(batch)
        .bind(shard_count)
        .bind(owned_shards)
        .bind(base_cadence_secs)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::slo_from_row).collect()
    }

    // ---- slo evaluation: idempotency ----

    /// Returns true if this (slo, eval_ts) was newly claimed; false if already applied.
    /// Mirrors [`Self::try_claim_eval`] against `slo_evaluations`.
    pub async fn try_claim_slo_eval(
        &self,
        slo: crate::domain::ids::SloId,
        eval_ts: OffsetDateTime,
    ) -> Result<bool, StoreError> {
        let res = sqlx::query(
            "INSERT INTO slo_evaluations (slo, eval_ts) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(slo.0)
        .bind(eval_ts)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    /// Claim many (slo, eval_ts) pairs in one round trip; see [`Self::try_claim_batch`].
    pub async fn try_claim_slo_evals(
        &self,
        pairs: &[(crate::domain::ids::SloId, OffsetDateTime)],
    ) -> Result<Vec<bool>, StoreError> {
        let raw: Vec<(Uuid, OffsetDateTime)> = pairs.iter().map(|&(s, ts)| (s.0, ts)).collect();
        let (ids, tss, index) = Self::dedup_claim_pairs(&raw);
        self.try_claim_batch("slo_evaluations", "slo", ids, tss, pairs.len(), &index)
            .await
    }

    /// Load many SLOs by id in one round trip (batch counterpart of
    /// [`Self::get_slo`] for the SLO evaluator's claim path). Rows carry their
    /// stored tenant; the caller matches it against each job's tenant, keeping
    /// the same tenant scoping as the per-id read. Missing ids are simply absent.
    pub async fn get_slos_by_ids(
        &self,
        ids: &[crate::domain::ids::SloId],
    ) -> Result<Vec<crate::domain::slo::Slo>, StoreError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let raw: Vec<Uuid> = ids.iter().map(|s| s.0).collect();
        let rows = sqlx::query(
            "SELECT id, tenant, namespace, name, spec, version, paused FROM slos WHERE id = ANY($1)",
        )
        .bind(&raw)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::slo_from_row).collect()
    }

    // ---- slo evaluation: health ----

    /// Record a query failure for `slo`: bump the consecutive-failure counter and store the
    /// error. If this crosses `degrade_after` from a healthy state, flip to degraded and write
    /// an `SloHealth`/`Firing` event to the outbox in the same transaction, mirroring
    /// [`Self::record_rule_failure`]. Returns the event + outbox id to publish, or `None`.
    pub async fn record_slo_failure(
        &self,
        slo: crate::domain::ids::SloId,
        tenant: &TenantId,
        err: &str,
        degrade_after: u32,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT health_status, consecutive_failures, name,
                    (spec->>'suppressed')::bool AS suppressed
               FROM slos WHERE id=$1 AND tenant=$2 FOR UPDATE",
        )
        .bind(slo.0)
        .bind(tenant.as_str())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(None);
        };
        let was: String = row.get("health_status");
        let name: String = row.get("name");
        // Specs stored before the key existed read NULL -> not suppressed.
        let suppressed: bool = row.get::<Option<bool>, _>("suppressed").unwrap_or(false);
        let n: i32 = row.get::<i32, _>("consecutive_failures") + 1;
        let now_degraded = n >= degrade_after as i32;
        let transitioned = now_degraded && was != "degraded";
        sqlx::query(
            "UPDATE slos SET consecutive_failures=$3, last_error=$4, last_error_at=$5,
                 health_status = CASE WHEN $6 THEN 'degraded' ELSE health_status END,
                 degraded_since = CASE WHEN $7 THEN $5 ELSE degraded_since END
             WHERE id=$1 AND tenant=$2",
        )
        .bind(slo.0)
        .bind(tenant.as_str())
        .bind(n)
        .bind(err)
        .bind(now)
        .bind(now_degraded)
        .bind(transitioned)
        .execute(&mut *tx)
        .await?;

        if transitioned {
            let mut ann = BTreeMap::new();
            ann.insert(
                "summary".to_string(),
                format!("SLO {} degraded: {}", slo.0, err),
            );
            ann.insert("last_error".to_string(), err.to_string());
            let mut ev = Event::slo_health(tenant.clone(), slo, EventStatus::Firing, ann, now);
            ev.name = name;
            // A preview (suppressed) SLO must never notify, its health events included.
            ev.suppressed = suppressed;
            let id = insert_outbox_event(&mut tx, &ev).await?;
            tx.commit().await?;
            return Ok(Some((ev, id)));
        }

        tx.commit().await?;
        Ok(None)
    }

    /// Record a query success for `slo`: reset the failure counter and clear the stored
    /// error. If the SLO was degraded, flip to healthy and write an `SloHealth`/`Resolved`
    /// event to the outbox in the same transaction, mirroring [`Self::record_rule_success`].
    /// Returns the recovery event + outbox id, or `None`.
    pub async fn record_slo_success(
        &self,
        slo: crate::domain::ids::SloId,
        tenant: &TenantId,
        now: OffsetDateTime,
    ) -> Result<Option<(Event, Uuid)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "UPDATE slos SET consecutive_failures=0, last_error=NULL, last_error_at=NULL
              WHERE id = $1 AND tenant = $2
                AND (consecutive_failures <> 0 OR last_error IS NOT NULL OR health_status <> 'healthy')
            RETURNING health_status, name, (spec->>'suppressed')::bool AS suppressed",
        )
        .bind(slo.0)
        .bind(tenant.as_str())
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            tx.commit().await?;
            return Ok(None);
        };
        let status: String = row.get("health_status");
        let name: String = row.get("name");
        // Specs stored before the key existed read NULL -> not suppressed.
        let suppressed: bool = row.get::<Option<bool>, _>("suppressed").unwrap_or(false);

        if status == "degraded" {
            sqlx::query(
                "UPDATE slos SET health_status='healthy', degraded_since=NULL WHERE id=$1 AND tenant=$2",
            )
            .bind(slo.0)
            .bind(tenant.as_str())
            .execute(&mut *tx)
            .await?;
            let mut ann = BTreeMap::new();
            ann.insert("summary".to_string(), format!("SLO {} recovered", slo.0));
            let mut ev = Event::slo_health(tenant.clone(), slo, EventStatus::Resolved, ann, now);
            ev.name = name;
            // A preview (suppressed) SLO must never notify, its health events included.
            ev.suppressed = suppressed;
            let id = insert_outbox_event(&mut tx, &ev).await?;
            tx.commit().await?;
            return Ok(Some((ev, id)));
        }

        tx.commit().await?;
        Ok(None)
    }

    /// Lean health read for the `/v1/slos/:id/status` response's `health` sibling field.
    /// `None` iff the SLO doesn't exist for this tenant.
    pub async fn get_slo_health(
        &self,
        tenant: &TenantId,
        slo: crate::domain::ids::SloId,
    ) -> Result<Option<SloHealth>, StoreError> {
        let row = sqlx::query(
            "SELECT health_status, degraded_since, last_error FROM slos WHERE id=$1 AND tenant=$2",
        )
        .bind(slo.0)
        .bind(tenant.as_str())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| SloHealth {
            status: r.get("health_status"),
            degraded_since: r.get("degraded_since"),
            last_error: r.get("last_error"),
        }))
    }

    // ---- slo evaluation: status snapshot ----

    pub async fn upsert_slo_status(
        &self,
        slo: crate::domain::ids::SloId,
        tenant: &TenantId,
        payload: &serde_json::Value,
        computed_at: OffsetDateTime,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO slo_status (slo, tenant, payload, computed_at) VALUES ($1,$2,$3,$4)
             ON CONFLICT (slo) DO UPDATE SET payload=EXCLUDED.payload, computed_at=EXCLUDED.computed_at, tenant=EXCLUDED.tenant",
        )
        .bind(slo.0)
        .bind(tenant.as_str())
        .bind(payload)
        .bind(computed_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_slo_status(
        &self,
        tenant: &TenantId,
        slo: crate::domain::ids::SloId,
    ) -> Result<Option<SloStatusRow>, StoreError> {
        let row = sqlx::query(
            "SELECT slo, tenant, payload, computed_at FROM slo_status WHERE slo=$1 AND tenant=$2",
        )
        .bind(slo.0)
        .bind(tenant.as_str())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| SloStatusRow {
            slo: crate::domain::ids::SloId(r.get("slo")),
            tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
            payload: r.get("payload"),
            computed_at: r.get("computed_at"),
        }))
    }

    // ---- slo instances (burn-rate alerting) ----

    /// Load an SLO's instances, tenant-scoped. Mirrors [`Self::load_instances`] against
    /// `slo_instances`; callers already resolve the SLO via `get_slo(tenant, slo)`, the
    /// tenant predicate here is defense-in-depth as there. Ordered by `key` so
    /// derived views (e.g. the `/status` `firing_tiers` array) are deterministic.
    pub async fn load_slo_instances(
        &self,
        tenant: &TenantId,
        slo: crate::domain::ids::SloId,
    ) -> Result<Vec<InstanceState>, StoreError> {
        let rows = sqlx::query(
            "SELECT key, slo AS source, tenant, status, labels, value, active_since, last_seen, absent_count
             FROM slo_instances WHERE slo=$1 AND tenant=$2 ORDER BY key",
        )
        .bind(slo.0)
        .bind(tenant.as_str())
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::new();
        for r in &rows {
            out.push(row_to_instance(r, SourceKind::Slo)?);
        }
        Ok(out)
    }

    /// Mirrors [`Self::persist_eval_batch`] steps 1-2 (the unnest-upsert + outbox
    /// insert) against `slo_instances`. There is no rollup/cadence write here — SLOs
    /// have no per-row rollup counters and no adaptive cadence axis (see
    /// [`Self::claim_due_slos_sharded`]). Returns the generated outbox ids in `events`
    /// order. Empty input is a no-op.
    pub async fn persist_slo_eval_batch(
        &self,
        instances: &[InstanceState],
        events: &[Event],
    ) -> Result<Vec<Uuid>, StoreError> {
        debug_assert!(
            instances
                .iter()
                .all(|s| matches!(s.source, SourceId::Slo(_))),
            "persist_slo_eval_batch writes the `slo_instances` table; rule-sourced \
             instances belong in persist_eval_batch"
        );
        if instances.is_empty() && events.is_empty() {
            return Ok(Vec::new());
        }

        let mut tx = self.pool.begin().await?;
        let ids = write_eval_batch(&mut tx, SLO_INSTANCES_UPSERT_SQL, instances, events).await?;
        tx.commit().await?;
        Ok(ids)
    }

    /// Firing SLO instances for a tenant, enriched with the instance's per-tier
    /// severity (from the `slo_tier` label against the canonical tiers). Mirrors
    /// [`Self::list_firing`]; used as an inhibition source-set once burn-rate alerts
    /// join the union (Task 10).
    pub async fn list_firing_slos(
        &self,
        tenant: &TenantId,
    ) -> Result<Vec<FiringInstance>, StoreError> {
        let rows =
            sqlx::query("SELECT key, slo, labels FROM slo_instances WHERE tenant=$1 AND status=$2")
                .bind(tenant.as_str())
                .bind(status_str(Status::Firing))
                .fetch_all(&self.pool)
                .await?;
        let tiers = crate::domain::slo::canonical_tiers();
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let labels: BTreeMap<String, String> = serde_json::from_value(r.get("labels"))?;
            let severity = crate::domain::slo::tier_severity(&tiers, &labels);
            out.push(FiringInstance {
                key: InstanceKey(r.get("key")),
                source: SourceId::Slo(SloId(r.get("slo"))),
                severity,
                labels,
            });
        }
        Ok(out)
    }

    /// SLO instances still pending/firing whose last evaluation is older than
    /// max(4 * `cadence_secs`, 60)s. Mirrors [`Self::list_stale_instances`]; SLOs have
    /// no per-row interval (unlike rules' `spec->>'interval_secs'`), so the fixed base
    /// cadence is passed in by the caller (see [`Self::claim_due_slos_sharded`]).
    /// `now` is passed in for testability.
    pub async fn list_stale_slo_instances(
        &self,
        now: OffsetDateTime,
        cadence_secs: i64,
        limit: i64,
    ) -> Result<Vec<StaleInstance>, StoreError> {
        let rows = sqlx::query(
            "SELECT i.key AS key, i.slo AS slo, i.tenant AS tenant, i.status AS status,
                    i.labels AS labels, i.value AS value,
                    s.spec->'annotations' AS annotations, s.spec->'suppressed' AS suppressed,
                    s.name AS name
             FROM slo_instances i JOIN slos s ON s.id = i.slo
             WHERE i.status IN ('pending','firing')
               AND NOT s.paused
               AND s.health_status <> 'degraded'
               -- A failing-but-not-yet-degraded SLO (consecutive_failures > 0, still
               -- 'healthy') froze deliberately (freeze-on-error): the reaper must not
               -- resolve its instances before the degrade threshold decides. Without
               -- this guard, a degrade_after > 4 configuration races the 4x-cadence
               -- staleness window and the reaper wins, resolving instances a source
               -- that is about to legitimately degrade.
               AND s.consecutive_failures = 0
               AND i.last_seen < ($1::timestamptz - make_interval(secs => GREATEST(4 * $2, 60)))
             ORDER BY i.last_seen
             LIMIT $3",
        )
        .bind(now)
        .bind(cadence_secs)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        // Projects only the spec fields it needs (annotations/suppressed), not the
        // full JSONB blob. Severity comes from the `slo_tier` label against the
        // canonical tiers.
        let tiers = crate::domain::slo::canonical_tiers();
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let labels: BTreeMap<String, String> = serde_json::from_value(r.get("labels"))?;
            let severity = crate::domain::slo::tier_severity(&tiers, &labels);
            let annotations: BTreeMap<String, String> =
                match r.get::<Option<serde_json::Value>, _>("annotations") {
                    Some(v) if !v.is_null() => serde_json::from_value(v)?,
                    _ => BTreeMap::new(),
                };
            let suppressed = match r.get::<Option<serde_json::Value>, _>("suppressed") {
                Some(serde_json::Value::Bool(b)) => b,
                _ => false,
            };
            out.push(StaleInstance {
                key: InstanceKey(r.get("key")),
                source: SourceId::Slo(SloId(r.get("slo"))),
                tenant: TenantId::from_trusted(r.get::<String, _>("tenant")),
                status: status_from(r.get::<&str, _>("status")),
                labels,
                value: r.get("value"),
                severity,
                annotations,
                suppressed,
                name: r.get("name"),
            });
        }
        Ok(out)
    }

    /// Delete evaluation-ledger rows (both the rule-side `evaluations` and SLO-side
    /// `slo_evaluations` idempotency tables) older than `cutoff` (housekeeping).
    /// Returns `(rules rows deleted, slos rows deleted)`.
    pub async fn prune_eval_ledgers(
        &self,
        cutoff: OffsetDateTime,
    ) -> Result<(u64, u64), StoreError> {
        let rules = sqlx::query("DELETE FROM evaluations WHERE eval_ts < $1")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        let slos = sqlx::query("DELETE FROM slo_evaluations WHERE eval_ts < $1")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        Ok((rules.rows_affected(), slos.rows_affected()))
    }
}
