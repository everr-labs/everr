//! The engine-native SLO evaluator: computes per-group SLI, per-tier burn rate,
//! and error-budget-remaining from the SLI query, writing a status snapshot; then
//! drives each (group x tier) burn-rate verdict through the shared engine state
//! machine to open/resolve `slo_instances` rows and publish `Event`s.
//!
//! The status snapshot (via [`PgStore::upsert_slo_status`]) and the SLO's health
//! columns (via [`PgStore::record_slo_failure`] / [`PgStore::record_slo_success`])
//! are always written first, on the success path only; the firing pass below runs
//! after that snapshot write and never runs on the freeze-on-error path.

use crate::clickhouse::{json_to_f64, RowQuerier};
use crate::domain::ids::{InstanceKey, RuleId};
use crate::domain::instance::InstanceState;
use crate::domain::rule::Severity;
use crate::domain::sink::{SloSample, SloSampleSink};
use crate::domain::slo::{
    canonical_tiers, objective_fingerprint, parse_window_secs, tiers_for_spec, BurnRateTier, Slo,
    SloSpec,
};
use crate::domain::Event;
use crate::engine::slo_math::{
    budget_remaining_fraction, burn_rate, empty_payload, fmt_burn, fmt_duration_secs, fmt_pct,
    is_window_due, required_windows, time_to_exhaustion_secs, SloGroupStatus, SloStatusPayload,
    SloTierStatus, WindowReq,
};
use crate::engine::{evaluate, EvalInput};
use crate::evaluator::{publish_and_clear_outbox, publish_health};
use crate::queue::{EventBus, JobId, Queue, SloDelivery};
use crate::stores::PgStore;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;
use std::time::Duration as StdDuration;
use time::{Duration, OffsetDateTime};

/// A group's label set (the SLI query's `label_columns`, empty for a scalar SLO).
type GroupKey = BTreeMap<String, String>;
/// window name -> group labels -> (good, valid) observed this tick.
type GroupValues = BTreeMap<String, BTreeMap<GroupKey, (f64, f64)>>;

/// The group label sets to publish in this tick's snapshot.
///
/// Every group observed in a due window this tick is kept. Prior-snapshot groups
/// are carried forward too, but only while the budget window is throttled
/// (`budget_due == false`): the budget window is the SLO's defining span, so when
/// it IS re-evaluated its results are the authoritative membership for the
/// window, and a prior group absent from every due window has no data left in the
/// window. Such a group is pruned instead of lingering forever, e.g. a service
/// that has gone silent. (An SLI edit that changes the label set is handled
/// upstream, by discarding the whole snapshot on an objective-fingerprint
/// mismatch; this path only ages out a group under an *unchanged* objective.) The
/// budget window covers every burn window, so its groups are a superset of theirs;
/// carrying prior only when it is throttled cannot flicker out a group whose data
/// has merely aged past the shorter burn windows.
fn groups_to_emit(
    prior_groups: &[SloGroupStatus],
    window_values: &GroupValues,
    budget_due: bool,
) -> BTreeSet<GroupKey> {
    let mut labels: BTreeSet<GroupKey> = BTreeSet::new();
    for groups in window_values.values() {
        labels.extend(groups.keys().cloned());
    }
    if !budget_due {
        labels.extend(prior_groups.iter().map(|g| g.labels.clone()));
    }
    labels
}

/// Format a UTC instant as a ClickHouse `DateTime` literal (`YYYY-MM-DD HH:MM:SS`),
/// suitable for binding as a `{window_start:DateTime}` / `{window_end:DateTime}`
/// named query parameter. `pub(crate)` so `api::slos::test`'s `/test` endpoint can
/// reuse it.
pub(crate) fn fmt_ch_datetime(t: OffsetDateTime) -> String {
    const FORMAT: &[time::format_description::FormatItem<'_>] =
        time::macros::format_description!("[year]-[month]-[day] [hour]:[minute]:[second]");
    t.to_offset(time::UtcOffset::UTC)
        .format(FORMAT)
        .expect("static ClickHouse datetime format is always valid")
}

/// The window→seconds string used as a [`SloStatusPayload::window_computed_at`] key,
/// or `None` if the duration shorthand fails to parse (defensive; specs are validated
/// on write, so this should not happen in practice).
fn window_name_for(dur: &str) -> Option<String> {
    parse_window_secs(dur).ok().map(|s| format!("{s}s"))
}

/// The freshness/merge core shared by [`burn_rate_for`] and [`long_window_valid_for`]:
/// `Some((good, valid))` observed this tick for `labels` when `window_dur`'s window was
/// due (zeros when the group is absent from the results); `None` when the window was
/// not recomputed this tick (or its duration fails to parse), meaning the caller
/// carries the prior snapshot's value unchanged.
fn fresh_window_values(
    window_dur: &str,
    labels: &GroupKey,
    due_names: &BTreeSet<&str>,
    window_values: &GroupValues,
) -> Option<(f64, f64)> {
    let name = window_name_for(window_dur)?;
    if !due_names.contains(name.as_str()) {
        return None;
    }
    Some(
        window_values
            .get(&name)
            .and_then(|g| g.get(labels))
            .copied()
            .unwrap_or((0.0, 0.0)),
    )
}

/// Compute one tier-window's burn rate for `labels`: recomputed from this tick's rows
/// if `window_dur`'s window was due, else carried over unchanged from the prior
/// snapshot's value for the same tier+window.
fn burn_rate_for(
    window_dur: &str,
    labels: &GroupKey,
    due_names: &BTreeSet<&str>,
    window_values: &GroupValues,
    prior_value: Option<f64>,
    target_percent: f64,
) -> Option<f64> {
    match fresh_window_values(window_dur, labels, due_names, window_values) {
        Some((good, valid)) => burn_rate(good, valid, target_percent),
        None => prior_value,
    }
}

/// Same freshness/merge idiom as [`burn_rate_for`], but yields the tier's long-window
/// `valid` count instead of a burn rate — the input to `min_valid_events`' floor.
fn long_window_valid_for(
    window_dur: &str,
    labels: &GroupKey,
    due_names: &BTreeSet<&str>,
    window_values: &GroupValues,
    prior_value: Option<f64>,
) -> Option<f64> {
    match fresh_window_values(window_dur, labels, due_names, window_values) {
        Some((_good, valid)) => Some(valid),
        None => prior_value,
    }
}

/// Evaluate one SLO as of `eval_ts`: plan the due windows (coordinated freshness,
/// see [`is_window_due`]), run the SLI query once per due window, compute per-group
/// SLI + per-tier burn rate + budget-remaining, merge with the prior snapshot for
/// windows not recomputed this tick, and upsert the status snapshot.
///
/// On any window's query error: records the failure (`record_slo_failure`, which
/// degrades the SLO after `degrade_after` consecutive failures) and returns
/// `Ok(())` WITHOUT writing a snapshot — the stale snapshot (with its old
/// `window_computed_at` timestamps) is left exactly as-is. This mirrors the rule
/// evaluator's freeze-on-error semantics: a flaky/broken SLI query must never
/// produce a partial or garbage snapshot.
/// Turn this tick's freshly-queried per-window `(good, valid)` counts into
/// [`SloSample`]s and buffer them on the sink. Only windows present in
/// `window_values` (the windows due this tick) carry fresh data, so those are
/// the only ones emitted.
fn buffer_slo_samples(
    samples: &dyn SloSampleSink,
    slo: &Slo,
    window_values: &GroupValues,
    eval_ts: OffsetDateTime,
) {
    let time_unix_nanos = eval_ts.unix_timestamp_nanos().max(0) as u64;
    let slo_id = slo.id.0.to_string();
    let mut batch = Vec::new();
    for (window, groups) in window_values {
        for (labels, (good, valid)) in groups {
            batch.push(SloSample {
                tenant: slo.tenant.as_str().to_string(),
                slo_id: slo_id.clone(),
                slo_name: slo.name.clone(),
                window: window.clone(),
                labels: labels.clone(),
                good: *good,
                valid: *valid,
                time_unix_nanos,
            });
        }
    }
    if !batch.is_empty() {
        samples.record(batch);
    }
}

#[allow(clippy::too_many_arguments)]
#[tracing::instrument(
    name = "slo.evaluate",
    skip_all,
    fields(
        slo = %slo.id.0,
        tenant = %slo.tenant,
        groups = tracing::field::Empty,
        otel.status_code = tracing::field::Empty,
        otel.status_message = tracing::field::Empty
    )
)]
pub async fn evaluate_slo(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    samples: &dyn SloSampleSink,
    slo: &Slo,
    eval_ts: OffsetDateTime,
    base_cadence_secs: u64,
    degrade_after: u32,
) -> anyhow::Result<()> {
    let status_row = match store.get_slo_status(&slo.tenant, slo.id).await {
        Ok(row) => row,
        Err(e) => {
            crate::otel::span_error(&e);
            return Err(e.into());
        }
    };
    let prior: SloStatusPayload = match status_row {
        Some(row) => match serde_json::from_value(row.payload) {
            Ok(payload) => payload,
            Err(e) => {
                // A stored payload that fails to parse (corruption, or a future shape
                // change) must never permanently freeze the SLO: with `?` here, every
                // subsequent tick would error before writing a new snapshot, and health
                // stays "healthy" throughout (the error never reaches
                // `record_slo_failure`) — a silent, invisible dead SLO. Instead,
                // self-heal by treating it like there was no prior snapshot at all;
                // worst case is one full recompute of every window this tick.
                tracing::warn!(
                    slo = ?slo.id,
                    error = %e,
                    "prior slo_status payload failed to deserialize; falling back to an empty payload"
                );
                empty_payload(&slo.spec)
            }
        },
        None => empty_payload(&slo.spec),
    };

    // Discard a snapshot computed for a different objective (see
    // `objective_fingerprint`): starting from empty makes every window due, so
    // this tick rebuilds from the current query alone and any vanished group
    // resolves its instances via the not-planned path below — instead of carrying
    // stale groups forward until the budget window next comes due.
    let objective = objective_fingerprint(&slo.spec);
    let prior = if prior.objective_fingerprint.as_deref() == Some(objective.as_str()) {
        prior
    } else {
        empty_payload(&slo.spec)
    };

    let eval_unix = eval_ts.unix_timestamp();
    let required = required_windows(&slo.spec);
    let due_windows: Vec<WindowReq> = required
        .iter()
        .filter(|w| {
            is_window_due(
                w.secs,
                prior.window_computed_at.get(&w.name).copied(),
                eval_unix,
                base_cadence_secs,
            )
        })
        .cloned()
        .collect();

    // Run every due window's SLI query once, keyed by group labels. The queries are
    // independent reads, so they run concurrently; the results are then folded IN
    // WINDOW ORDER so the freeze-on-first-error path reports the same window's error
    // a sequential pass would. On any window's error, record the failure and freeze
    // (no snapshot write) — matching the rule evaluator's degrade-on-error contract.
    // (Unlike a sequential pass, queries for windows after a failing one may still
    // have run; their results are simply discarded.)
    let window_queries = due_windows.iter().map(|w| async move {
        // Defensive: `validate_slo_spec` caps every window to `MAX_WINDOW_SECS`, but
        // existing DB rows predate that cap (or a future bug could smuggle one past
        // it), so guard the subtraction here too. `time::OffsetDateTime - Duration`
        // PANICS on overflow (year outside +-9999); `checked_sub` turns that into a
        // recoverable failure instead of a tenant-triggerable crash-loop. Treated
        // exactly like a ClickHouse query failure: record + freeze, no snapshot write.
        let window_start = i64::try_from(w.secs)
            .ok()
            .and_then(|secs| eval_ts.checked_sub(Duration::seconds(secs)))
            .ok_or_else(|| "window duration out of range".to_string())?;
        let params = vec![
            ("window_start".to_string(), fmt_ch_datetime(window_start)),
            ("window_end".to_string(), fmt_ch_datetime(eval_ts)),
        ];
        let rows = ch
            .query_rows_params(
                &slo.tenant,
                &slo.spec.sli.sql,
                &params,
                &slo.spec.sli.label_columns,
                Some("valid"),
            )
            .await
            .map_err(|e| e.to_string())?;
        let mut groups: BTreeMap<GroupKey, (f64, f64)> = BTreeMap::new();
        for row in rows {
            let valid = row.value.unwrap_or(0.0);
            let good = row.extra.get("good").and_then(json_to_f64).unwrap_or(0.0);
            groups.insert(row.labels, (good, valid));
        }
        Ok::<_, String>(groups)
    });
    let results = futures::future::join_all(window_queries).await;

    let mut window_values: GroupValues = BTreeMap::new();
    for (w, result) in due_windows.iter().zip(results) {
        match result {
            Ok(groups) => {
                window_values.insert(w.name.clone(), groups);
            }
            Err(msg) => {
                let recorded = match store
                    .record_slo_failure(slo.id, &slo.tenant, &msg, degrade_after, eval_ts)
                    .await
                {
                    Ok(recorded) => recorded,
                    Err(e) => {
                        crate::otel::span_error(&e);
                        return Err(e.into());
                    }
                };
                if let Some((ev, id)) = recorded {
                    publish_health(store, events, ev, id).await;
                }
                return Ok(());
            }
        }
    }

    // Every due window's query succeeded: record success (recovers a degraded SLO)
    // before building and persisting the new snapshot.
    let recorded = match store.record_slo_success(slo.id, &slo.tenant, eval_ts).await {
        Ok(recorded) => recorded,
        Err(e) => {
            crate::otel::span_error(&e);
            return Err(e.into());
        }
    };
    if let Some((ev, id)) = recorded {
        publish_health(store, events, ev, id).await;
    }

    // Record the raw (good, valid) counts for every window queried THIS tick (only
    // the due windows carry fresh data; carried-over windows are not re-emitted, so
    // each window's series samples at its own refresh cadence). Buffered here and
    // exported once per consume batch; best-effort, so it never blocks the snapshot.
    buffer_slo_samples(samples, slo, &window_values, eval_ts);

    let due_names: BTreeSet<&str> = due_windows.iter().map(|w| w.name.as_str()).collect();
    // Burn tiers scaled to this SLO's own budget window: the windows the burns
    // below are measured over, and the windows `required_windows` queried this tick.
    let tiers = tiers_for_spec(&slo.spec);
    let budget_window_name = window_name_for(&slo.spec.time_window.duration);

    let prior_by_labels: BTreeMap<GroupKey, &SloGroupStatus> =
        prior.groups.iter().map(|g| (g.labels.clone(), g)).collect();

    // The groups to publish this tick. See `groups_to_emit`: due-window groups
    // are always kept; prior groups are carried only while the budget window is
    // throttled, so a group with no data left in the window is pruned once the
    // budget window (its defining span) is re-evaluated instead of lingering.
    let budget_due = budget_window_name
        .as_deref()
        .is_some_and(|name| due_names.contains(name));
    let all_labels = groups_to_emit(&prior.groups, &window_values, budget_due);

    let mut out_groups = Vec::with_capacity(all_labels.len());
    for labels in all_labels {
        let prior_group = prior_by_labels.get(&labels).copied();

        // The budget window (spec.time_window): recompute sli/budget_remaining iff
        // due this tick, else carry the prior group's values unchanged.
        let (sli, budget_remaining) = match &budget_window_name {
            Some(name) if due_names.contains(name.as_str()) => {
                let (good, valid) = window_values
                    .get(name)
                    .and_then(|g| g.get(&labels))
                    .copied()
                    .unwrap_or((0.0, 0.0));
                let sli = (valid > 0.0).then_some(good / valid);
                let budget_remaining =
                    budget_remaining_fraction(good, valid, slo.spec.target_percent);
                (sli, budget_remaining)
            }
            _ => (
                prior_group.and_then(|g| g.sli),
                prior_group.and_then(|g| g.budget_remaining),
            ),
        };

        let tiers_status = tiers
            .iter()
            .map(|tier| {
                let prior_tier =
                    prior_group.and_then(|g| g.tiers.iter().find(|t| t.name == tier.name));
                SloTierStatus {
                    name: tier.name.clone(),
                    long_burn_rate: burn_rate_for(
                        &tier.long_window,
                        &labels,
                        &due_names,
                        &window_values,
                        prior_tier.and_then(|t| t.long_burn_rate),
                        slo.spec.target_percent,
                    ),
                    short_burn_rate: burn_rate_for(
                        &tier.short_window,
                        &labels,
                        &due_names,
                        &window_values,
                        prior_tier.and_then(|t| t.short_burn_rate),
                        slo.spec.target_percent,
                    ),
                    long_window_valid: long_window_valid_for(
                        &tier.long_window,
                        &labels,
                        &due_names,
                        &window_values,
                        prior_tier.and_then(|t| t.long_window_valid),
                    ),
                }
            })
            .collect();

        out_groups.push(SloGroupStatus {
            labels,
            sli,
            budget_remaining,
            tiers: tiers_status,
        });
    }

    // Rebuild the freshness ledger from the CURRENT required windows only, so a
    // window not in the SLO's tier set (a tier window that changed) drops out
    // instead of lingering as an orphan key. Each window keeps its prior timestamp;
    // the ones recomputed this tick are stamped now. A required window with no
    // prior entry is always due (is_window_due treats a missing timestamp as due),
    // so it is in due_names — the else is defensive.
    let mut window_computed_at = BTreeMap::new();
    for w in &required {
        if due_names.contains(w.name.as_str()) {
            window_computed_at.insert(w.name.clone(), eval_unix);
        } else if let Some(&ts) = prior.window_computed_at.get(&w.name) {
            window_computed_at.insert(w.name.clone(), ts);
        }
    }

    tracing::Span::current().record("groups", out_groups.len());
    let payload = SloStatusPayload {
        window: slo.spec.time_window.duration.clone(),
        target_percent: slo.spec.target_percent,
        groups: out_groups,
        window_computed_at,
        objective_fingerprint: Some(objective),
    };

    let payload_json = match serde_json::to_value(&payload) {
        Ok(v) => v,
        Err(e) => {
            crate::otel::span_error(&e);
            return Err(e.into());
        }
    };
    if let Err(e) = store
        .upsert_slo_status(slo.id, &slo.tenant, &payload_json, eval_ts)
        .await
    {
        crate::otel::span_error(&e);
        return Err(e.into());
    }

    // ---- Firing pipeline: drive each (group x tier) burn-rate verdict through the
    // shared engine state machine, open/resolve `slo_instances` rows, and publish
    // the resulting events. Reached only on this success path — every freeze-on-error
    // branch above already returned before here, so a flaky SLI query can neither
    // fire nor resolve an instance off of partial data.
    // Instance-key hashing input only (`InstanceKey::new` keys on the bare uuid);
    // the instances themselves carry typed `SourceId::Slo` identity.
    let rule_id = RuleId(slo.id.0);
    let planned = plan_tier_firing(&slo.spec, &payload);
    let known = match store.load_slo_instances(&slo.tenant, slo.id).await {
        Ok(known) => known,
        Err(e) => {
            crate::otel::span_error(&e);
            return Err(e.into());
        }
    };
    let mut known_by_key: HashMap<InstanceKey, InstanceState> =
        known.into_iter().map(|s| (s.key.clone(), s)).collect();

    // Evidence's time-to-exhaustion needs the budget window in seconds; spec
    // validation guarantees this parses, the fallback is defensive only (mirrors
    // this function's other out-of-range/unparsable-window handling).
    let budget_window_secs = parse_window_secs(&slo.spec.time_window.duration).unwrap_or(0);

    // Built once per tier (not per group), per the firing algorithm.
    let tier_annotations: BTreeMap<&str, BTreeMap<String, String>> = tiers
        .iter()
        .map(|t| (t.name.as_str(), slo_annotations(slo, t)))
        .collect();
    let empty_annotations: BTreeMap<String, String> = BTreeMap::new();

    let mut next_states: Vec<InstanceState> = Vec::new();
    let mut out_events: Vec<Event> = Vec::new();

    for tf in &planned {
        let key = InstanceKey::new(rule_id, &tf.labels);
        let prev = known_by_key.remove(&key).unwrap_or_else(|| {
            InstanceState::new_inactive(
                key,
                crate::domain::ids::SourceId::Slo(slo.id),
                slo.tenant.clone(),
                tf.labels.clone(),
            )
        });
        let annotations = tier_annotations
            .get(tf.tier_name.as_str())
            .unwrap_or(&empty_annotations);
        let input = EvalInput {
            present: tf.present,
            value: tf.value,
            labels: tf.labels.clone(),
            // Burn windows already smooth the signal: the multi-window (long AND
            // short both over threshold) breach condition IS the for-clause, so no
            // additional debounce belongs here.
            for_duration: Duration::ZERO,
            // The short window is the anti-flap mechanism: once it drops back under
            // threshold the group is genuinely recovering (spec §3), so resolve on
            // the very next non-breaching tick instead of requiring repeated absences.
            resolve_after: 1,
            severity: tf.severity,
            annotations,
            eval_ts,
        };
        let outcome = evaluate(prev, input);
        // The engine already stamped `ev.slo` from the instance's `SourceId::Slo`.
        if let Some(mut ev) = outcome.event {
            ev.suppressed = slo.spec.suppressed;
            ev.name = slo.name.clone();
            ev.evidence = Some(slo_evidence(slo, tf, budget_window_secs));
            ev.evidence_truncated = false;
            out_events.push(ev);
        }
        next_states.push(outcome.next);
    }

    // Known-but-not-planned instances (e.g. a tier dropped from the spec, or a group
    // that no longer appears anywhere in the payload): feed present:false so they
    // resolve, mirroring the rule evaluator's absent path
    // (`evaluate_rule_against_rows`).
    for (_key, mut prev) in known_by_key {
        let labels = std::mem::take(&mut prev.labels);
        let tier = labels
            .get(crate::domain::slo::SLO_TIER_LABEL)
            .and_then(|name| tiers.iter().find(|t| t.name == *name));
        // Severity goes through the shared helper (unified with `stores::pg`'s
        // `list_firing_slos`/`list_stale_slo_instances`): unknown/vanished tier
        // defaults to Critical, not Warning -- the conservative choice when we can't
        // identify a resolving instance's tier. Annotations fall back to empty in the
        // same case, reusing the tier lookup above rather than re-deriving it.
        let severity = crate::domain::slo::tier_severity(&tiers, &labels);
        let annotations = tier
            .and_then(|t| tier_annotations.get(t.name.as_str()))
            .unwrap_or(&empty_annotations);
        let input = EvalInput {
            present: false,
            value: None,
            labels,
            for_duration: Duration::ZERO,
            resolve_after: 1,
            severity,
            annotations,
            eval_ts,
        };
        let outcome = evaluate(prev, input);
        // `ev.slo` is stamped by the engine; resolved-by-absence has no source
        // row, so evidence stays None/untruncated (already the engine's default).
        if let Some(mut ev) = outcome.event {
            ev.suppressed = slo.spec.suppressed;
            ev.name = slo.name.clone();
            out_events.push(ev);
        }
        next_states.push(outcome.next);
    }

    if !(next_states.is_empty() && out_events.is_empty()) {
        if let Err(e) = commit_and_publish_slo(store, events, next_states, out_events).await {
            crate::otel::span_error(&e);
            return Err(e);
        }
    }

    Ok(())
}

/// Like [`crate::evaluator::commit_and_publish`], but against `slo_instances`/
/// [`PgStore::persist_slo_eval_batch`] (no rollup, no adaptive cadence — SLOs have
/// neither): persist all instance states + outbox rows in one transaction, publish
/// the events in one pipelined batch, then delete exactly the outbox rows whose
/// events published. Unpublished rows are left for the maintenance relay.
pub(crate) async fn commit_and_publish_slo(
    store: &PgStore,
    events: &dyn EventBus,
    next_states: Vec<InstanceState>,
    out_events: Vec<Event>,
) -> anyhow::Result<()> {
    let outbox_ids = store
        .persist_slo_eval_batch(&next_states, &out_events)
        .await?;
    publish_and_clear_outbox(store, events, &out_events, &outbox_ids).await
}

/// Claim + resolve + evaluate every delivery in one SLO batch, swallowing per-job
/// errors (logged) so one bad job never blocks the rest of the batch. The caller
/// acks every delivery in the batch regardless — a claim/lookup/eval failure for
/// one job still acks that job, since redelivering it would either re-fail
/// identically or (if the (slo, eval_ts) pair was already claimed) be a no-op
/// anyway.
#[allow(clippy::too_many_arguments)]
async fn process_slo_batch_inner(
    store: &PgStore,
    ch: &dyn RowQuerier,
    events: &dyn EventBus,
    samples: &dyn SloSampleSink,
    base_cadence_secs: u64,
    degrade_after: u32,
    deliveries: Vec<SloDelivery>,
) {
    // Claim + resolve in two batched round trips (previously ~2 per delivery).
    // `try_claim_slo_evals` preserves the per-pair conflict semantics of the old
    // per-delivery claim: a job that loses the (slo, eval_ts) race is skipped
    // (and still acked by the caller), exactly as before. A store error skips
    // the whole batch the same way a per-job claim/lookup error skipped that job.
    let jobs: Vec<crate::queue::SloEvalJob> = deliveries.into_iter().map(|d| d.job).collect();
    let claim_pairs: Vec<(crate::domain::ids::SloId, time::OffsetDateTime)> =
        jobs.iter().map(|j| (j.slo, j.eval_ts)).collect();
    let claimed = match store.try_claim_slo_evals(&claim_pairs).await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "try_claim_slo_eval failed");
            return;
        }
    };
    let claimed_jobs: Vec<crate::queue::SloEvalJob> = jobs
        .into_iter()
        .zip(claimed)
        .filter_map(|(job, won)| won.then_some(job))
        .collect();
    let mut slo_ids: Vec<crate::domain::ids::SloId> = claimed_jobs.iter().map(|j| j.slo).collect();
    slo_ids.sort_unstable_by_key(|s| s.0);
    slo_ids.dedup();
    let slos_by_id: HashMap<crate::domain::ids::SloId, crate::domain::slo::Slo> =
        match store.get_slos_by_ids(&slo_ids).await {
            Ok(slos) => slos.into_iter().map(|s| (s.id, s)).collect(),
            Err(e) => {
                tracing::error!(error = %e, "get_slo failed");
                return;
            }
        };
    for job in claimed_jobs {
        match slos_by_id.get(&job.slo) {
            // The tenant guard keeps the per-id read's scoping: a job whose tenant
            // doesn't match the stored SLO is treated as a miss, never evaluated.
            Some(slo) if slo.tenant == job.tenant && !slo.paused => {
                if let Err(e) = evaluate_slo(
                    store,
                    ch,
                    events,
                    samples,
                    slo,
                    job.eval_ts,
                    base_cadence_secs,
                    degrade_after,
                )
                .await
                {
                    tracing::error!(slo = ?job.slo, error = %e, "slo evaluation errored");
                }
            }
            _ => {} // paused, deleted, or tenant mismatch: drop the job (still acked)
        }
    }
    // Export every sample buffered across this batch in one request (best-effort).
    samples.flush().await;
}

/// Run the SLO-evaluator consume loop over `cc:slo:jobs` until `shutdown` flips true.
/// Mirrors [`super::run_evaluator`]'s per-batch panic-isolation idiom: a panic while
/// evaluating one batch of SLO jobs (e.g. inside `evaluate_slo`) must poison neither
/// this loop nor the whole evaluator role, so the batch is computed up front, run
/// inside `catch_unwind`, and acked regardless of a panic — a poisoned job would only
/// re-panic identically on redelivery anyway.
#[allow(clippy::too_many_arguments)]
pub async fn run_slo_evaluator(
    consumer: String,
    store: PgStore,
    queue: Arc<dyn Queue>,
    ch: Arc<dyn RowQuerier>,
    events: Arc<dyn EventBus>,
    samples: Arc<dyn SloSampleSink>,
    base_cadence_secs: u64,
    degrade_after: u32,
    shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let deliveries = match queue.consume_slo(&consumer, 16, 2000).await {
            Ok(d) => d,
            Err(e) => {
                tracing::error!(error = %e, "slo consume failed");
                tokio::time::sleep(StdDuration::from_millis(500)).await;
                continue;
            }
        };
        let ack_ids: Vec<JobId> = deliveries.iter().map(|d| d.id.clone()).collect();
        let batch = std::panic::AssertUnwindSafe(process_slo_batch_inner(
            &store,
            ch.as_ref(),
            events.as_ref(),
            samples.as_ref(),
            base_cadence_secs,
            degrade_after,
            deliveries,
        ));
        if let Err(payload) = futures::FutureExt::catch_unwind(batch).await {
            let msg = crate::supervisor::panic_message(payload);
            tracing::error!(
                panic = %msg,
                deliveries = ack_ids.len(),
                "slo evaluation batch panicked; acking the batch and continuing"
            );
        }
        // One variadic ack per batch. On failure the unacked ids stay pending and
        // are redelivered via the reclaim pre-pass, so logging is all that's owed.
        if let Err(e) = queue.ack_slo_batch(&ack_ids).await {
            tracing::error!(error = %e, "ack_slo failed");
        }
    }
    tracing::info!("slo evaluator stopped");
}

/// One (group × tier) firing verdict: the pure output of comparing an
/// already-computed [`SloStatusPayload`] snapshot against the [`SloSpec`]'s
/// burn-rate tiers. No I/O; [`evaluate_slo`] feeds each verdict through the
/// engine state machine to actually open/resolve instances.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TierFiring {
    /// Group labels + "slo_tier" — the instance's label set (identity input).
    pub labels: BTreeMap<String, String>,
    pub tier_name: String,
    pub present: bool,
    /// Long-window burn rate when present (the event value).
    pub value: Option<f64>,
    pub severity: Severity,
    /// Extra numbers for evidence/annotations (short burn, budget, tte).
    pub short_burn: Option<f64>,
    pub budget_remaining: Option<f64>,
}

/// For every (group × tier) pair, decide whether the tier is presently
/// breaching: both the long- and short-window burn rates must strictly
/// exceed the tier's threshold, and (if `spec.min_valid_events` is set) the
/// long window's observed `valid` count must meet the floor. A `None` burn on
/// either window, or a `None` valid count when a floor is configured, fails
/// open (`present: false`) rather than paging on missing/low-traffic data.
///
/// Every (group × tier) pair yields exactly one entry, including absent ones
/// — the resolve path downstream relies on seeing every pair each tick.
pub(crate) fn plan_tier_firing(spec: &SloSpec, payload: &SloStatusPayload) -> Vec<TierFiring> {
    // Firing compares each tier's stored burn against its threshold and matches by
    // name — both window-independent — so the canonical list resolves the same
    // set as the SLO's scaled tiers, without re-parsing the window.
    let tiers = canonical_tiers();
    let mut out = Vec::with_capacity(payload.groups.len() * tiers.len());
    for group in &payload.groups {
        for tier in &tiers {
            let tier_status = group.tiers.iter().find(|t| t.name == tier.name);
            let long_burn = tier_status.and_then(|t| t.long_burn_rate);
            let short_burn = tier_status.and_then(|t| t.short_burn_rate);
            let long_window_valid = tier_status.and_then(|t| t.long_window_valid);

            let floor_ok = match spec.min_valid_events {
                Some(n) => long_window_valid.is_some_and(|v| v >= n as f64),
                None => true,
            };
            let present = floor_ok
                && long_burn.is_some_and(|l| l > tier.burn_rate)
                && short_burn.is_some_and(|s| s > tier.burn_rate);

            let mut labels = group.labels.clone();
            labels.insert(
                crate::domain::slo::SLO_TIER_LABEL.to_string(),
                tier.name.clone(),
            );

            out.push(TierFiring {
                labels,
                tier_name: tier.name.clone(),
                present,
                value: long_burn,
                severity: tier.severity,
                short_burn,
                budget_remaining: group.budget_remaining,
            });
        }
    }
    out
}

/// Default notification annotations for one tier, overridden by
/// `SloSpec.annotations`. Inserts the defaults first, then extends/overwrites
/// with the spec's own annotations, so a spec key wins on collision and any
/// unrelated spec keys pass through untouched.
pub(crate) fn slo_annotations(slo: &Slo, tier: &BurnRateTier) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    out.insert(
        "summary".to_string(),
        format!(
            "SLO {name}: {tier} burn — ${{burn_rate}}× over {long_window}",
            name = slo.name,
            tier = tier.name,
            // The scaled window rendered compactly ("16h48m", not "1008m").
            long_window = parse_window_secs(&tier.long_window)
                .map(fmt_duration_secs)
                .unwrap_or_else(|_| tier.long_window.clone()),
        ),
    );
    out.insert(
        "description".to_string(),
        "Error budget remaining: ${budget_remaining}. Projected time to exhaustion: ${time_to_exhaustion}.".to_string(),
    );
    out.extend(slo.spec.annotations.clone());
    out
}

/// Computed-key evidence for one planned firing, resolved by render's
/// `${...}` lookup. A key is omitted whenever its source number is `None`
/// (rather than emitting a placeholder), so the renderer's own missing-key
/// handling decides what shows up in the notification.
pub(crate) fn slo_evidence(
    slo: &Slo,
    tf: &TierFiring,
    window_secs: u64,
) -> BTreeMap<String, serde_json::Value> {
    let mut out = BTreeMap::new();
    if let Some(v) = tf.value {
        out.insert(
            "burn_rate".to_string(),
            serde_json::Value::String(fmt_burn(v)),
        );
    }
    if let Some(v) = tf.short_burn {
        out.insert(
            "short_burn_rate".to_string(),
            serde_json::Value::String(fmt_burn(v)),
        );
    }
    if let Some(v) = tf.budget_remaining {
        out.insert(
            "budget_remaining".to_string(),
            serde_json::Value::String(fmt_pct(v)),
        );
    }
    if let (Some(budget), Some(value)) = (tf.budget_remaining, tf.value) {
        if let Some(secs) = time_to_exhaustion_secs(budget, value, window_secs) {
            let s = if secs == 0 {
                "exhausted".to_string()
            } else {
                fmt_duration_secs(secs)
            };
            out.insert(
                "time_to_exhaustion".to_string(),
                serde_json::Value::String(s),
            );
        }
    }
    out.insert(
        "tier".to_string(),
        serde_json::Value::String(tf.tier_name.clone()),
    );
    out.insert(
        "objective".to_string(),
        serde_json::Value::String(format!("{}%", slo.spec.target_percent)),
    );
    out.insert(
        "slo_name".to_string(),
        serde_json::Value::String(slo.name.clone()),
    );
    out
}

#[cfg(test)]
mod tier_firing_tests {
    use super::*;
    use crate::domain::slo::{SliSpec, TimeWindow};

    fn spec_with(min_valid_events: Option<u64>) -> SloSpec {
        SloSpec {
            sli: SliSpec {
                sql: "x".into(),
                label_columns: vec![],
            },
            target_percent: 99.9,
            time_window: TimeWindow {
                duration: "30d".into(),
                is_rolling: true,
                calendar: None,
            },
            min_valid_events,
            annotations: BTreeMap::new(),
            suppressed: false,
        }
    }

    /// A single-group payload, with the group's tier statuses supplied directly.
    fn payload_one_group(
        labels: BTreeMap<String, String>,
        budget_remaining: Option<f64>,
        tiers: Vec<SloTierStatus>,
    ) -> SloStatusPayload {
        SloStatusPayload {
            window: "30d".into(),
            target_percent: 99.9,
            groups: vec![SloGroupStatus {
                labels,
                sli: None,
                budget_remaining,
                tiers,
            }],
            window_computed_at: BTreeMap::new(),
            objective_fingerprint: None,
        }
    }

    fn tier_status(name: &str, long: Option<f64>, short: Option<f64>) -> SloTierStatus {
        SloTierStatus {
            name: name.to_string(),
            long_burn_rate: long,
            short_burn_rate: short,
            long_window_valid: None,
        }
    }

    fn group_labels() -> BTreeMap<String, String> {
        BTreeMap::from([("service".to_string(), "checkout".to_string())])
    }

    #[test]
    fn prunes_stale_groups_only_when_the_budget_window_is_due() {
        let svc = |v: &str| BTreeMap::from([("service".to_string(), v.to_string())]);
        let bare = |labels: BTreeMap<String, String>| SloGroupStatus {
            labels,
            sli: None,
            budget_remaining: None,
            tiers: vec![],
        };
        // Prior snapshot carried two groups; this tick, only "checkout" reports.
        let prior = vec![bare(svc("checkout")), bare(svc("cart"))];
        let mut window_values: GroupValues = BTreeMap::new();
        window_values.insert(
            "1h".to_string(),
            BTreeMap::from([(svc("checkout"), (10.0, 10.0))]),
        );

        // Budget window throttled: keep the stale "cart" group — its budget-window
        // data may still be live, we just didn't recompute it this tick.
        let carried = groups_to_emit(&prior, &window_values, false);
        assert!(carried.contains(&svc("checkout")));
        assert!(carried.contains(&svc("cart")));

        // Budget window due: "cart" is absent from every due window, so its data
        // has aged fully out of the defining window -> pruned.
        let pruned = groups_to_emit(&prior, &window_values, true);
        assert!(pruned.contains(&svc("checkout")));
        assert!(!pruned.contains(&svc("cart")));
    }

    #[test]
    fn fires_only_when_both_windows_breach() {
        let spec = spec_with(None); // canonical tiers, fast-burn threshold 14.4

        // both windows breach -> present
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![tier_status("fast-burn", Some(15.0), Some(15.0))],
        );
        let firings = plan_tier_firing(&spec, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(fast.present);

        // long breaches, short doesn't -> absent
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![tier_status("fast-burn", Some(15.0), Some(2.0))],
        );
        let firings = plan_tier_firing(&spec, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(!fast.present);

        // short breaches, long doesn't -> absent
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![tier_status("fast-burn", Some(2.0), Some(15.0))],
        );
        let firings = plan_tier_firing(&spec, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(!fast.present);
    }

    #[test]
    fn zero_traffic_fails_open() {
        let spec = spec_with(None);
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![tier_status("fast-burn", None, None)],
        );
        let firings = plan_tier_firing(&spec, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(!fast.present);
        assert_eq!(fast.value, None);
    }

    #[test]
    fn min_valid_events_floor() {
        let spec_floored = spec_with(Some(1000));

        // burn 20x on both windows, but valid count under the floor -> absent
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![SloTierStatus {
                name: "fast-burn".into(),
                long_burn_rate: Some(20.0),
                short_burn_rate: Some(20.0),
                long_window_valid: Some(500.0),
            }],
        );
        let firings = plan_tier_firing(&spec_floored, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(!fast.present);

        // same burns, valid count clears the floor -> present
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![SloTierStatus {
                name: "fast-burn".into(),
                long_burn_rate: Some(20.0),
                short_burn_rate: Some(20.0),
                long_window_valid: Some(2000.0),
            }],
        );
        let firings = plan_tier_firing(&spec_floored, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(fast.present);

        // floor set, valid count missing -> absent (no data, no page)
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![SloTierStatus {
                name: "fast-burn".into(),
                long_burn_rate: Some(20.0),
                short_burn_rate: Some(20.0),
                long_window_valid: None,
            }],
        );
        let firings = plan_tier_firing(&spec_floored, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(!fast.present);

        // no floor configured, valid count missing -> present purely on burns
        let spec_no_floor = spec_with(None);
        let firings = plan_tier_firing(&spec_no_floor, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(fast.present);
    }

    #[test]
    fn labels_carry_tier_and_group() {
        let spec = spec_with(None); // canonical: 3 tiers
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![tier_status("fast-burn", Some(15.0), Some(15.0))],
        );
        let firings = plan_tier_firing(&spec, &payload);
        assert_eq!(firings.len(), 3); // 1 group * 3 canonical tiers
        for f in &firings {
            assert_eq!(
                f.labels.get("service").map(String::as_str),
                Some("checkout")
            );
            assert_eq!(f.labels.get("slo_tier"), Some(&f.tier_name));
        }
    }

    #[test]
    fn severity_and_value_from_tier() {
        let spec = spec_with(None); // canonical: ticket tier is Severity::Warning
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![tier_status("ticket", Some(2.0), Some(2.0))], // breaches ticket's 1.0 threshold
        );
        let firings = plan_tier_firing(&spec, &payload);
        let ticket = firings.iter().find(|f| f.tier_name == "ticket").unwrap();
        assert!(ticket.present);
        assert_eq!(ticket.severity, Severity::Warning);
        assert_eq!(ticket.value, Some(2.0));
    }

    #[test]
    fn passthrough_fields_copied() {
        let spec = spec_with(None); // canonical tiers
        let mut tier_status_with_burns = tier_status("fast-burn", Some(15.0), Some(16.0));
        tier_status_with_burns.short_burn_rate = Some(16.0);

        let payload = SloStatusPayload {
            window: "30d".into(),
            target_percent: 99.9,
            groups: vec![SloGroupStatus {
                labels: group_labels(),
                sli: None,
                budget_remaining: Some(0.5),
                tiers: vec![tier_status_with_burns],
            }],
            window_computed_at: BTreeMap::new(),
            objective_fingerprint: None,
        };

        let firings = plan_tier_firing(&spec, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(fast.present); // both burns exceed 14.4 threshold
        assert_eq!(fast.short_burn, Some(16.0));
        assert_eq!(fast.budget_remaining, Some(0.5));
    }

    #[test]
    fn burn_exactly_at_threshold_does_not_fire() {
        let spec = spec_with(None); // canonical: fast-burn threshold is 14.4
        let payload = payload_one_group(
            group_labels(),
            None,
            vec![tier_status("fast-burn", Some(14.4), Some(14.4))], // exactly at threshold
        );
        let firings = plan_tier_firing(&spec, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(!fast.present); // strict >, not >=
    }
}

#[cfg(test)]
mod annotations_evidence_tests {
    use super::*;
    use crate::domain::ids::{SloId, TenantId};
    use crate::domain::slo::{canonical_tiers, SliSpec, TimeWindow};

    fn slo_named(name: &str, annotations: BTreeMap<String, String>) -> Slo {
        Slo {
            id: SloId(uuid::Uuid::nil()),
            tenant: TenantId::from_trusted("test-tenant"),
            namespace: String::new(),
            name: name.to_string(),
            spec: SloSpec {
                sli: SliSpec {
                    sql: "x".into(),
                    label_columns: vec![],
                },
                target_percent: 99.9,
                time_window: TimeWindow {
                    duration: "30d".into(),
                    is_rolling: true,
                    calendar: None,
                },
                min_valid_events: None,
                annotations,
                suppressed: false,
            },
            version: 1,
            paused: false,
        }
    }

    fn fast_burn_tier() -> BurnRateTier {
        canonical_tiers().into_iter().next().unwrap() // fast-burn: long "1h"
    }

    fn firing_with(
        value: Option<f64>,
        short_burn: Option<f64>,
        budget_remaining: Option<f64>,
    ) -> TierFiring {
        TierFiring {
            labels: BTreeMap::new(),
            tier_name: "fast-burn".into(),
            present: true,
            value,
            severity: Severity::Critical,
            short_burn,
            budget_remaining,
        }
    }

    #[test]
    fn defaults_render_exact_summary_and_description() {
        let slo = slo_named("checkout", BTreeMap::new());
        let tier = fast_burn_tier();
        let ann = slo_annotations(&slo, &tier);
        assert_eq!(
            ann.get("summary").map(String::as_str),
            Some("SLO checkout: fast-burn burn — ${burn_rate}× over 1h")
        );
        assert_eq!(
            ann.get("description").map(String::as_str),
            Some(
                "Error budget remaining: ${budget_remaining}. Projected time to exhaustion: ${time_to_exhaustion}."
            )
        );
    }

    #[test]
    fn spec_annotation_overrides_default_and_passes_through_extra_keys() {
        let mut spec_annotations = BTreeMap::new();
        spec_annotations.insert("summary".to_string(), "custom".to_string());
        spec_annotations.insert("team".to_string(), "checkout-oncall".to_string());
        let slo = slo_named("checkout", spec_annotations);
        let tier = fast_burn_tier();
        let ann = slo_annotations(&slo, &tier);
        assert_eq!(ann.get("summary").map(String::as_str), Some("custom"));
        // description default is untouched since the spec didn't set it
        assert!(ann.contains_key("description"));
        assert_eq!(ann.get("team").map(String::as_str), Some("checkout-oncall"));
    }

    #[test]
    fn evidence_keys_are_internally_consistent_with_the_pure_formatters() {
        let slo = slo_named("checkout", BTreeMap::new());
        let window_secs = 2_592_000u64; // 30d
        let tf = firing_with(Some(14.4), Some(16.0), Some(0.5));
        let evidence = slo_evidence(&slo, &tf, window_secs);

        assert_eq!(
            evidence.get("burn_rate"),
            Some(&serde_json::Value::String("14.4".to_string()))
        );
        assert_eq!(
            evidence.get("short_burn_rate"),
            Some(&serde_json::Value::String("16.0".to_string()))
        );
        assert_eq!(
            evidence.get("budget_remaining"),
            Some(&serde_json::Value::String("50.0%".to_string()))
        );

        // Compute expected via the pure fns rather than hand-deriving the literal.
        let expected_tte = time_to_exhaustion_secs(0.5, 14.4, window_secs)
            .map(fmt_duration_secs)
            .unwrap();
        assert_eq!(
            evidence.get("time_to_exhaustion"),
            Some(&serde_json::Value::String(expected_tte))
        );

        assert_eq!(
            evidence.get("tier"),
            Some(&serde_json::Value::String("fast-burn".to_string()))
        );
        assert_eq!(
            evidence.get("objective"),
            Some(&serde_json::Value::String("99.9%".to_string()))
        );
        assert_eq!(
            evidence.get("slo_name"),
            Some(&serde_json::Value::String("checkout".to_string()))
        );
    }

    #[test]
    fn over_budget_time_to_exhaustion_is_exhausted() {
        let slo = slo_named("checkout", BTreeMap::new());
        let tf = firing_with(Some(2.0), Some(2.0), Some(-0.1));
        let evidence = slo_evidence(&slo, &tf, 2_592_000);
        assert_eq!(
            evidence.get("time_to_exhaustion"),
            Some(&serde_json::Value::String("exhausted".to_string()))
        );
    }

    #[test]
    fn missing_value_omits_burn_rate_and_time_to_exhaustion() {
        let slo = slo_named("checkout", BTreeMap::new());
        let tf = firing_with(None, Some(2.0), Some(0.5));
        let evidence = slo_evidence(&slo, &tf, 2_592_000);
        assert!(!evidence.contains_key("burn_rate"));
        assert!(!evidence.contains_key("time_to_exhaustion"));
        // unrelated keys are still present
        assert!(evidence.contains_key("short_burn_rate"));
        assert!(evidence.contains_key("budget_remaining"));
        assert!(evidence.contains_key("tier"));
        assert!(evidence.contains_key("objective"));
        assert!(evidence.contains_key("slo_name"));
    }
}
