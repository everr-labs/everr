use crate::clickhouse::{ResultRow, RowQuerier};
use crate::domain::ids::{InstanceKey, RuleId};
use crate::domain::instance::InstanceState;
use crate::domain::rule::{Rule, RuleSpec};
use crate::domain::Event;
use crate::engine::{evaluate, EvalInput};
use crate::otel::metrics::{EngineMetrics, EvalErrorKind};
use crate::queue::{Delivery, EventBus, JobId, Queue};
use crate::stores::PgStore;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;

pub mod maintenance;
pub mod slo;

/// Evidence caps (pinned contract with the everr frontend): at most 16 columns, and the
/// compact-JSON serialization must fit in 4096 bytes or the evidence is dropped entirely.
const MAX_EVIDENCE_COLUMNS: usize = 16;
const MAX_EVIDENCE_BYTES: usize = 4096;

/// Build the bounded evidence for one present source row. `extra` is the row minus the
/// rule's `label_columns` (the value column IS included). Returns
/// `(evidence, evidence_truncated)`:
/// - no extra columns: `(None, false)`;
/// - over 16 columns: the first 16 in key order survive and `truncated` is true;
/// - surviving columns' compact JSON over 4096 bytes: `(None, true)`.
fn build_evidence(
    extra: &BTreeMap<String, serde_json::Value>,
) -> (Option<BTreeMap<String, serde_json::Value>>, bool) {
    if extra.is_empty() {
        return (None, false);
    }
    let truncated = extra.len() > MAX_EVIDENCE_COLUMNS;
    let map: BTreeMap<String, serde_json::Value> = extra
        .iter()
        .take(MAX_EVIDENCE_COLUMNS)
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let bytes = serde_json::to_vec(&map)
        .map(|b| b.len())
        .unwrap_or(usize::MAX);
    if bytes > MAX_EVIDENCE_BYTES {
        return (None, true);
    }
    (Some(map), truncated)
}

/// Identity of a ClickHouse query for coalescing. Two jobs share a single round-trip iff
/// these fields match — the resolved per-tenant auth identity plus the wire query and how
/// rows are parsed. Including `auth` keeps tenants with identical SQL from sharing a
/// round-trip under per-tenant credentials, while `shared` mode (constant identity)
/// still coalesces freely.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct QuerySig {
    auth: crate::clickhouse::AuthIdentity,
    sql: String,
    label_columns: Vec<String>,
    value_column: Option<String>,
}

impl QuerySig {
    fn of(auth: crate::clickhouse::AuthIdentity, spec: &RuleSpec) -> Self {
        Self {
            auth,
            sql: spec.sql.clone(),
            label_columns: spec.label_columns.clone(),
            value_column: spec.value_column.clone(),
        }
    }
}

/// Run the evaluator consume loop until `shutdown` flips true.
#[allow(clippy::too_many_arguments)]
pub async fn run_evaluator(
    consumer: String,
    store: PgStore,
    queue: Arc<dyn Queue>,
    ch: Arc<dyn RowQuerier>,
    events: Arc<dyn EventBus>,
    degrade_after: u32,
    metrics: EngineMetrics,
    shutdown: tokio::sync::watch::Receiver<bool>,
) {
    // Last-known degraded state per rule (true = degraded). Suppresses the per-rule
    // `record_rule_success` round-trip on the steady-state healthy path; the store's
    // conditional UPDATE remains the source of truth, so this need not be durable.
    let mut health: HashMap<RuleId, bool> = HashMap::new();
    loop {
        if *shutdown.borrow() {
            break;
        }
        let deliveries = match queue.consume(&consumer, 16, 2000).await {
            Ok(d) => d,
            Err(e) => {
                tracing::error!(error = %e, "consume failed");
                metrics.record_eval_error(EvalErrorKind::Consume, None);
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
        };
        // Time only real batches; the consume timeout on an idle queue is not work.
        let batch_started = (!deliveries.is_empty()).then(std::time::Instant::now);
        // Per-batch panic isolation: a panic while processing one batch must poison
        // neither this loop nor the whole evaluator role. The ack ids are computed
        // up front so a panicked batch is still acked; redelivering it would only
        // re-panic on every redelivery (a poison pill that stalls the consumer),
        // and any (rule, eval_ts) pairs claimed before the panic would be skipped
        // on redelivery anyway. The `health` map is a best-effort cache, so a
        // half-updated map after a panic is harmless (worst case: one extra
        // `record_rule_success` round-trip).
        let ack_ids: Vec<JobId> = deliveries.iter().map(|d| d.id.clone()).collect();
        let batch = std::panic::AssertUnwindSafe(process_batch_inner(
            &store,
            ch.as_ref(),
            events.as_ref(),
            degrade_after,
            deliveries,
            &mut health,
            &metrics,
        ));
        let to_ack = match futures::FutureExt::catch_unwind(batch).await {
            Ok(ids) => ids,
            Err(payload) => {
                let msg = crate::supervisor::panic_message(payload);
                tracing::error!(
                    panic = %msg,
                    deliveries = ack_ids.len(),
                    "evaluation batch panicked; acking the batch and continuing"
                );
                metrics.record_eval_error(EvalErrorKind::BatchPanic, None);
                ack_ids
            }
        };
        if let Some(started) = batch_started {
            metrics.record_eval_batch(started.elapsed().as_secs_f64());
        }
        // One variadic ack per batch. On failure the unacked ids stay pending and
        // are redelivered via the reclaim pre-pass, so logging is all that's owed.
        if let Err(e) = queue.ack_batch(&to_ack).await {
            tracing::error!(error = %e, "ack failed");
        }
    }
    tracing::info!("evaluator stopped");
}

/// Publish a rule-health event written to the outbox in `record_rule_*`, deleting the row
/// on success. A failed publish leaves the row for the maintenance relay (exactly-once).
pub(crate) async fn publish_health(
    store: &PgStore,
    events: &dyn EventBus,
    ev: Event,
    id: uuid::Uuid,
) {
    match events.publish(&ev).await {
        Ok(()) => {
            if let Err(e) = store.delete_outbox(id).await {
                tracing::warn!(error = %e, "health outbox delete failed; relay will re-publish");
            }
        }
        Err(e) => tracing::warn!(error = %e, "health publish failed; relay will recover"),
    }
}

/// Select the outbox ids to delete: those at the indices that published successfully.
pub(crate) fn published_outbox_ids(
    outbox_ids: &[uuid::Uuid],
    published: &[usize],
) -> Vec<uuid::Uuid> {
    published.iter().map(|&i| outbox_ids[i]).collect()
}

/// The shared publish tail of every commit path: publish the events in one pipelined
/// batch, then delete exactly the outbox rows whose events published. A failed delete
/// only warns — the events already published, so the relay re-publishing those rows
/// is a duplicate the dispatcher dedups. Unpublished rows are left for the maintenance
/// relay (exactly-once relative to the committed state is preserved).
pub(crate) async fn publish_and_clear_outbox(
    store: &PgStore,
    events: &dyn EventBus,
    out_events: &[Event],
    outbox_ids: &[uuid::Uuid],
) -> anyhow::Result<()> {
    let published = events.publish_batch(out_events).await?;
    let to_delete = published_outbox_ids(outbox_ids, &published);
    if let Err(e) = store.delete_outbox_batch(&to_delete).await {
        tracing::warn!(error = %e, "outbox batch delete failed; relay will re-publish");
    }
    Ok(())
}

/// The single state+outbox write+publish path: persist all instance states + outbox rows in
/// one transaction, then run the [`publish_and_clear_outbox`] tail. Used by the maintenance
/// sweep (cross-rule batch, no rollup, no cadence); the per-rule evaluator path goes
/// through [`commit_and_publish_with_rollup`].
pub(crate) async fn commit_and_publish(
    store: &PgStore,
    events: &dyn EventBus,
    next_states: Vec<InstanceState>,
    out_events: Vec<Event>,
) -> anyhow::Result<()> {
    let outbox_ids = store
        .persist_eval_batch(&next_states, &out_events, None, None, None)
        .await?;
    publish_and_clear_outbox(store, events, &out_events, &outbox_ids).await
}

/// Like `commit_and_publish`, but also writes the rule rollup and the adaptive-cadence
/// transition in the same transaction. Used by the per-rule evaluator path (which has
/// the rule's full instance set); the maintenance sweep keeps `commit_and_publish`
/// (cross-rule batch, no rollup, no cadence).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn commit_and_publish_with_rollup(
    store: &PgStore,
    events: &dyn EventBus,
    tenant: &crate::domain::ids::TenantId,
    next_states: Vec<InstanceState>,
    out_events: Vec<Event>,
    rollup: (
        crate::domain::ids::RuleId,
        crate::domain::rollup::RuleRollup,
    ),
    cadence: crate::stores::EvalCadence,
) -> anyhow::Result<()> {
    let rule_id = rollup.0;
    let outbox_ids = store
        .persist_eval_batch(
            &next_states,
            &out_events,
            Some(rollup),
            Some((rule_id, cadence)),
            Some(tenant),
        )
        .await?;
    publish_and_clear_outbox(store, events, &out_events, &outbox_ids).await
}

/// Process one consume batch with identical-query coalescing. Jobs are claimed via one
/// batched (rule, eval_ts) claim and their rules resolved via one batched fetch
/// (idempotency semantics unchanged from the per-delivery claim), grouped by
/// [`QuerySig`], and each distinct query is run once and fanned out to every rule
/// sharing it. Every input delivery is acked (success or recorded eval-error),
/// matching the prior per-delivery behavior. Returns the ids to ack.
pub async fn process_batch(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    degrade_after: u32,
    deliveries: Vec<Delivery>,
) -> Vec<JobId> {
    // Public entry point retained for tests and the prior call shape. Uses a fresh,
    // throwaway health map (every rule reconciles once), which is exactly the cold-start
    // behavior — correctness does not depend on the map persisting.
    let mut health = HashMap::new();
    process_batch_inner(
        store,
        ch,
        events,
        degrade_after,
        deliveries,
        &mut health,
        &EngineMetrics::disabled(),
    )
    .await
}

/// Like [`process_batch`], but threads a persistent per-rule degraded-state map so the
/// long-running evaluator can skip the `record_rule_success` round-trip for rules that are
/// already known healthy, plus the engine-metrics handle. See spec §2a.
pub async fn process_batch_inner(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    degrade_after: u32,
    deliveries: Vec<Delivery>,
    health: &mut HashMap<RuleId, bool>,
    metrics: &EngineMetrics,
) -> Vec<JobId> {
    let ack_ids: Vec<JobId> = deliveries.iter().map(|d| d.id.clone()).collect();

    // 1) Claim + resolve rules in two batched round trips (previously ~2 per
    // delivery). `try_claim_evals` preserves the per-pair conflict semantics of
    // the old per-delivery claim: a job that loses the (rule, eval_ts) race is
    // skipped (and still acked), exactly as before. A store error skips the
    // whole batch the same way a per-job claim/lookup error skipped that job.
    let jobs: Vec<crate::queue::EvalJob> = deliveries.into_iter().map(|d| d.job).collect();
    let claim_pairs: Vec<(RuleId, time::OffsetDateTime)> =
        jobs.iter().map(|j| (j.rule, j.eval_ts)).collect();
    let claimed = match store.try_claim_evals(&claim_pairs).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "claim_eval failed");
            return ack_ids;
        }
    };
    let claimed_jobs: Vec<crate::queue::EvalJob> = jobs
        .into_iter()
        .zip(claimed)
        .filter_map(|(job, won)| won.then_some(job))
        .collect();
    let mut rule_ids: Vec<RuleId> = claimed_jobs.iter().map(|j| j.rule).collect();
    rule_ids.sort_unstable_by_key(|r| r.0);
    rule_ids.dedup();
    let rules_by_id: HashMap<RuleId, Rule> = match store.get_rules_by_ids(&rule_ids).await {
        Ok(rules) => rules.into_iter().map(|r| (r.id, r)).collect(),
        Err(e) => {
            tracing::error!(error = %e, "get_rule failed");
            return ack_ids;
        }
    };
    let mut resolved: Vec<(crate::queue::EvalJob, Rule)> = Vec::new();
    for job in claimed_jobs {
        match rules_by_id.get(&job.rule) {
            // The tenant guard keeps the per-id read's scoping: a job whose tenant
            // doesn't match the stored rule is treated as a miss, never evaluated.
            Some(r) if r.tenant != job.tenant => {}
            // Rule paused after this job was enqueued: drop the in-flight job (it is
            // still acked above) so a paused rule can never evaluate or emit an event.
            // Scheduler claim-exclusion gates new jobs; this closes the queued-job window.
            Some(r) if r.paused => {}
            Some(r) => resolved.push((job, r.clone())),
            None => {} // rule deleted; nothing to do
        }
    }

    // 2) Group by query signature.
    let mut groups: HashMap<QuerySig, Vec<(crate::queue::EvalJob, Rule)>> = HashMap::new();
    for (job, rule) in resolved {
        let auth = ch.auth_identity(&job.tenant);
        groups
            .entry(QuerySig::of(auth, &rule.spec))
            .or_default()
            .push((job, rule));
    }

    // 3) Run each distinct query once; 4) fan out to each rule in the group.
    for members in groups.into_values() {
        let sample = &members[0].1;
        let rows = match ch
            .query_rows(
                &sample.tenant,
                &sample.spec.sql,
                &sample.spec.label_columns,
                sample.spec.value_column.as_deref(),
            )
            .await
        {
            Ok(r) => r,
            Err(e) => {
                // A query failure fails only this group's jobs; other groups are unaffected.
                // Each rule records its own health failure (degrading after K), publishing a
                // RuleHealth/Firing event on the transition. The error is capped before storage.
                let now = time::OffsetDateTime::now_utc();
                let msg: String = e.to_string().chars().take(500).collect();
                for (job, _) in &members {
                    tracing::error!(rule = ?job.rule, error = %msg, "evaluation query errored");
                    match store
                        .record_rule_failure(job.rule, &job.tenant, &msg, degrade_after as i32, now)
                        .await
                    {
                        Ok(Some((ev, id))) => {
                            health.insert(job.rule, true); // crossed into degraded
                            publish_health(store, events, ev, id).await;
                        }
                        Ok(None) => {
                            // Sub-threshold failure: the store is still healthy but
                            // consecutive_failures/last_error are now dirty. Forget the
                            // cached "known healthy" so the next successful evaluation
                            // reconciles (clearing the counters) instead of skipping the
                            // round-trip; otherwise isolated failures accumulate across
                            // healthy evals and eventually degrade a healthy rule.
                            health.remove(&job.rule);
                        }
                        Err(err) => {
                            tracing::error!(rule = ?job.rule, error = %err, "record_rule_failure failed")
                        }
                    }
                }
                continue;
            }
        };
        // Query succeeded for this group: record per-rule health success (recovery if degraded)
        // before evaluating, independent of the per-rule evaluate outcome below.
        let now = time::OffsetDateTime::now_utc();
        for (job, _) in &members {
            // Only reconcile health when the rule might be degraded. `None` (unknown) means
            // "not yet observed this process" → reconcile once. `Some(false)` (known healthy)
            // → skip the round-trip; the store's conditional UPDATE would be a no-op anyway.
            // Best-effort and process-local: if another replica degraded this rule while our
            // map still reads `false`, the recovery *event* can be missed once (the stored
            // health stays correct, and any failure we observe re-marks it). See spec §2a.
            if health.get(&job.rule) == Some(&false) {
                continue;
            }
            match store.record_rule_success(job.rule, &job.tenant, now).await {
                Ok(Some((ev, id))) => {
                    health.insert(job.rule, false); // recovered
                    publish_health(store, events, ev, id).await;
                }
                Ok(None) => {
                    health.insert(job.rule, false); // confirmed healthy; suppress future round-trips
                }
                Err(err) => {
                    tracing::error!(rule = ?job.rule, error = %err, "record_rule_success failed")
                }
            }
        }
        for (job, rule) in members {
            if let Err(e) = evaluate_rule_against_rows(store, events, &rule, &job, &rows).await {
                tracing::error!(rule = ?job.rule, error = %e, "evaluation errored");
                metrics.record_eval_error(EvalErrorKind::RuleEval, Some(job.tenant.as_str()));
                let _ = store
                    .record_eval_error(job.rule, &job.tenant, &e.to_string())
                    .await;
            }
        }
    }

    ack_ids
}

/// Evaluate one rule against pre-fetched rows (the per-rule body of the former `process`).
/// Builds the present-set, runs the absence path for known-but-absent instances, and
/// publishes each transition. Identical to the prior logic except rows are supplied.
///
/// `#[tracing::instrument]` produces the eval-latency span the engine OTLP exporter ships.
#[tracing::instrument(skip_all, fields(rule = %job.rule.0, tenant = %job.tenant, rows = rows.len()))]
async fn evaluate_rule_against_rows(
    store: &PgStore,
    events: &dyn EventBus,
    rule: &Rule,
    job: &crate::queue::EvalJob,
    rows: &[ResultRow],
) -> anyhow::Result<()> {
    type PresentRow = (
        BTreeMap<String, String>,
        Option<f64>,
        BTreeMap<String, serde_json::Value>,
    );
    let mut present: HashMap<InstanceKey, PresentRow> = HashMap::new();
    for row in rows {
        let key = InstanceKey::new(job.rule, &row.labels);
        present.insert(key, (row.labels.clone(), row.value, row.extra.clone()));
    }

    let known = store.load_instances(&job.tenant, job.rule).await?;
    let prev_status_by_key: HashMap<InstanceKey, crate::domain::instance::Status> =
        known.iter().map(|s| (s.key.clone(), s.status)).collect();
    let mut known_keys: HashMap<InstanceKey, InstanceState> =
        known.into_iter().map(|s| (s.key.clone(), s)).collect();

    // 1) Evaluate every present row, then every previously-known-but-absent instance.
    // Collect all next-states (for one batched upsert) and the subset that produced an
    // event (for one batched outbox insert) instead of writing per instance.
    let mut next_states: Vec<InstanceState> = Vec::new();
    let mut out_events: Vec<Event> = Vec::new();

    for (key, (labels, value, extra)) in present {
        let prev = known_keys.remove(&key).unwrap_or_else(|| {
            InstanceState::new_inactive(
                key.clone(),
                crate::domain::ids::SourceId::Rule(job.rule),
                job.tenant.clone(),
                labels.clone(),
            )
        });
        let input = EvalInput {
            present: true,
            value,
            labels,
            for_duration: rule.spec.for_duration(),
            resolve_after: rule.spec.resolve_after,
            severity: rule.spec.severity,
            annotations: &rule.spec.annotations,
            eval_ts: job.eval_ts,
        };
        let out = evaluate(prev, input);
        if let Some(mut ev) = out.event {
            // Stamp the rule's preview flag and the bounded source-row evidence. Evidence
            // is event-scoped only: it never touches the instances table.
            ev.suppressed = rule.spec.suppressed;
            ev.name = rule.name.clone();
            let (evidence, truncated) = build_evidence(&extra);
            ev.evidence = evidence;
            ev.evidence_truncated = truncated;
            out_events.push(ev);
        }
        next_states.push(out.next);
    }

    for (_key, mut prev) in known_keys {
        let labels = std::mem::take(&mut prev.labels);
        let input = EvalInput {
            present: false,
            value: None,
            labels,
            for_duration: rule.spec.for_duration(),
            resolve_after: rule.spec.resolve_after,
            severity: rule.spec.severity,
            annotations: &rule.spec.annotations,
            eval_ts: job.eval_ts,
        };
        let out = evaluate(prev, input);
        if let Some(mut ev) = out.event {
            // Resolved-by-absence has no source row: evidence stays None/untruncated.
            ev.suppressed = rule.spec.suppressed;
            ev.name = rule.name.clone();
            out_events.push(ev);
        }
        next_states.push(out.next);
    }

    // 2) Compute the per-rule rollup from the resulting instance set, then persist +
    // publish via the rollup-carrying helper (the maintenance sweep keeps the no-rollup path).
    let next_pairs: Vec<(InstanceKey, crate::domain::instance::Status)> = next_states
        .iter()
        .map(|s| (s.key.clone(), s.status))
        .collect();
    let rollup = crate::domain::rollup::RuleRollup::from_instances(
        &next_pairs,
        &prev_status_by_key,
        rows.len() as i32,
        job.eval_ts,
    );
    // Adaptive-cadence input: the evaluation is quiet only if it saw no present
    // row AND left every instance inactive. Pending instances (mid for-duration)
    // and firing instances still counting absences toward resolve_after therefore
    // keep the rule at base cadence; only a fully clear rule may stretch.
    let quiet = rows.is_empty()
        && next_states
            .iter()
            .all(|s| s.status == crate::domain::instance::Status::Inactive);
    let cadence = crate::stores::EvalCadence {
        quiet,
        interval_secs: rule.spec.interval_secs,
        max_interval_secs: rule.spec.max_interval_secs,
        eval_ts: job.eval_ts,
    };
    commit_and_publish_with_rollup(
        store,
        events,
        &job.tenant,
        next_states,
        out_events,
        (job.rule, rollup),
        cadence,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;

    /// Verify the index→id mapping inside `commit_and_publish`'s partial-publish path.
    ///
    /// `PgStore` is a concrete struct around a real pool, so we cannot stub it here.
    /// Instead we test the mapping logic directly as a pure unit: given a list of outbox
    /// ids and a subset of successfully-published indices (as `publish_batch` would return),
    /// the set of ids scheduled for deletion must equal exactly the ids at those indices.
    #[test]
    fn commit_and_publish_partial_publish_maps_correct_ids() {
        // Simulate outbox_ids returned by persist_eval_batch (one per event, in order).
        let id0 = uuid::Uuid::new_v4();
        let id1 = uuid::Uuid::new_v4();
        let id2 = uuid::Uuid::new_v4();
        let outbox_ids = vec![id0, id1, id2];

        // Simulate publish_batch returning only indices 0 and 2 (event at index 1 failed).
        // Call the production helper so the test covers the real function.
        let to_delete = published_outbox_ids(&outbox_ids, &[0, 2]);

        assert_eq!(to_delete, vec![id0, id2]);
        assert!(
            !to_delete.contains(&id1),
            "failed-publish id must not be deleted"
        );
    }

    fn spec(sql: &str, labels: &[&str], val: Option<&str>) -> crate::domain::rule::RuleSpec {
        crate::domain::rule::RuleSpec {
            sql: sql.into(),
            interval_secs: 30,
            for_secs: 0,
            label_columns: labels.iter().map(|s| s.to_string()).collect(),
            value_column: val.map(|s| s.to_string()),
            severity: Severity::Warning,
            annotations: BTreeMap::new(),
            resolve_after: 1,
            max_interval_secs: None,
            suppressed: false,
        }
    }

    fn ident(user: &str) -> crate::clickhouse::AuthIdentity {
        crate::clickhouse::AuthIdentity { user: user.into() }
    }

    #[test]
    fn identical_specs_share_signature() {
        assert_eq!(
            QuerySig::of(ident("u"), &spec("SELECT 1", &["a"], Some("v"))),
            QuerySig::of(ident("u"), &spec("SELECT 1", &["a"], Some("v"))),
        );
    }

    #[test]
    fn differing_fields_separate_signatures() {
        let base = QuerySig::of(ident("u"), &spec("SELECT 1", &["a"], Some("v")));
        assert_ne!(
            base,
            QuerySig::of(ident("u"), &spec("SELECT 2", &["a"], Some("v")))
        );
        assert_ne!(
            base,
            QuerySig::of(ident("u"), &spec("SELECT 1", &["b"], Some("v")))
        );
        assert_ne!(
            base,
            QuerySig::of(ident("u"), &spec("SELECT 1", &["a"], None))
        );
    }

    #[test]
    fn differing_identity_separates_signatures() {
        assert_ne!(
            QuerySig::of(ident("a"), &spec("SELECT 1", &["a"], Some("v"))),
            QuerySig::of(ident("b"), &spec("SELECT 1", &["a"], Some("v"))),
        );
    }
}

#[cfg(test)]
mod evidence_tests {
    use super::*;

    fn extra(n: usize, val_len: usize) -> BTreeMap<String, serde_json::Value> {
        (0..n)
            .map(|i| {
                (
                    format!("col_{i:02}"),
                    serde_json::Value::String("x".repeat(val_len)),
                )
            })
            .collect()
    }

    #[test]
    fn empty_extra_yields_no_evidence_untruncated() {
        assert_eq!(build_evidence(&BTreeMap::new()), (None, false));
    }

    #[test]
    fn small_extra_passes_through_untruncated() {
        let e = extra(3, 5);
        let (ev, truncated) = build_evidence(&e);
        assert_eq!(ev, Some(e));
        assert!(!truncated);
    }

    #[test]
    fn column_cap_keeps_first_16_and_marks_truncated() {
        let e = extra(20, 5);
        let (ev, truncated) = build_evidence(&e);
        let ev = ev.expect("column-capped evidence is still present");
        assert_eq!(ev.len(), MAX_EVIDENCE_COLUMNS);
        assert!(ev.contains_key("col_00"));
        assert!(ev.contains_key("col_15"));
        assert!(!ev.contains_key("col_16"), "columns past the cap dropped");
        assert!(truncated);
    }

    #[test]
    fn exactly_16_columns_is_not_truncated() {
        let e = extra(MAX_EVIDENCE_COLUMNS, 5);
        let (ev, truncated) = build_evidence(&e);
        assert_eq!(ev.map(|m| m.len()), Some(MAX_EVIDENCE_COLUMNS));
        assert!(!truncated);
    }

    #[test]
    fn byte_cap_drops_evidence_entirely() {
        // One column whose value alone exceeds 4096 bytes of compact JSON.
        let e = extra(1, MAX_EVIDENCE_BYTES + 1);
        assert_eq!(build_evidence(&e), (None, true));
    }

    #[test]
    fn byte_cap_applies_after_column_cap() {
        // 20 fat columns: even the surviving 16 exceed the byte cap -> None, truncated.
        let e = extra(20, 512);
        assert_eq!(build_evidence(&e), (None, true));
    }

    #[test]
    fn under_byte_cap_survives() {
        // 16 columns x ~200 bytes ≈ 3.4 KB compact JSON: under the cap.
        let e = extra(16, 200);
        let (ev, truncated) = build_evidence(&e);
        assert!(ev.is_some());
        assert!(!truncated);
    }
}
