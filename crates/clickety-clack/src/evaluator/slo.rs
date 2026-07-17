//! The engine-native SLO evaluator: computes per-group SLI, per-tier burn rate,
//! and error-budget-remaining from the SLI query, writing a status snapshot.
//!
//! No alerting lives here (that's Plan 3): this module only ever writes the
//! `slo_status` snapshot (via [`PgStore::upsert_slo_status`]) and the SLO's
//! health columns (via [`PgStore::record_slo_failure`] /
//! [`PgStore::record_slo_success`]). It never creates `instances` rows, emits
//! `Event`s, or touches the dispatcher.

use crate::clickhouse::{json_to_f64, RowQuerier};
use crate::domain::slo::{canonical_tiers, parse_window_secs, Slo};
use crate::engine::slo_math::{
    budget_remaining_fraction, burn_rate, empty_payload, is_window_due, required_windows,
    SloGroupStatus, SloStatusPayload, SloTierStatus, WindowReq,
};
use crate::queue::{JobId, Queue, SloDelivery};
use crate::stores::PgStore;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration as StdDuration;
use time::{Duration, OffsetDateTime};

/// A group's label set (the SLI query's `label_columns`, empty for a scalar SLO).
type GroupKey = BTreeMap<String, String>;
/// window name -> group labels -> (good, valid) observed this tick.
type GroupValues = BTreeMap<String, BTreeMap<GroupKey, (f64, f64)>>;

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
    let Some(name) = window_name_for(window_dur) else {
        return prior_value;
    };
    if !due_names.contains(name.as_str()) {
        return prior_value;
    }
    let (good, valid) = window_values
        .get(&name)
        .and_then(|g| g.get(labels))
        .copied()
        .unwrap_or((0.0, 0.0));
    burn_rate(good, valid, target_percent)
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
pub async fn evaluate_slo(
    store: &PgStore,
    ch: &dyn RowQuerier,
    slo: &Slo,
    eval_ts: OffsetDateTime,
    base_cadence_secs: u64,
    degrade_after: u32,
) -> anyhow::Result<()> {
    let prior: SloStatusPayload = match store.get_slo_status(&slo.tenant, slo.id).await? {
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

    let eval_unix = eval_ts.unix_timestamp();
    let due_windows: Vec<WindowReq> = required_windows(&slo.spec)
        .into_iter()
        .filter(|w| {
            is_window_due(
                w.secs,
                prior.window_computed_at.get(&w.name).copied(),
                eval_unix,
                base_cadence_secs,
            )
        })
        .collect();

    // Run each due window's SLI query once, keyed by group labels. On the first
    // query error, record the failure and freeze (no snapshot write) — matching
    // the rule evaluator's degrade-on-error contract.
    let mut window_values: GroupValues = BTreeMap::new();
    for w in &due_windows {
        // Defensive: `validate_slo_spec` caps every window to `MAX_WINDOW_SECS`, but
        // existing DB rows predate that cap (or a future bug could smuggle one past
        // it), so guard the subtraction here too. `time::OffsetDateTime - Duration`
        // PANICS on overflow (year outside +-9999); `checked_sub` turns that into a
        // recoverable failure instead of a tenant-triggerable crash-loop. Treated
        // exactly like a ClickHouse query failure: record + freeze, no snapshot write.
        let window_start = match i64::try_from(w.secs)
            .ok()
            .and_then(|secs| eval_ts.checked_sub(Duration::seconds(secs)))
        {
            Some(t) => t,
            None => {
                store
                    .record_slo_failure(
                        slo.id,
                        &slo.tenant,
                        "window duration out of range",
                        degrade_after,
                        eval_ts,
                    )
                    .await?;
                return Ok(());
            }
        };
        let params = vec![
            ("window_start".to_string(), fmt_ch_datetime(window_start)),
            ("window_end".to_string(), fmt_ch_datetime(eval_ts)),
        ];
        let rows = match ch
            .query_rows_params(
                &slo.tenant,
                &slo.spec.sli.sql,
                &params,
                &slo.spec.sli.label_columns,
                Some("valid"),
            )
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                store
                    .record_slo_failure(slo.id, &slo.tenant, &e.to_string(), degrade_after, eval_ts)
                    .await?;
                return Ok(());
            }
        };
        let mut groups: BTreeMap<GroupKey, (f64, f64)> = BTreeMap::new();
        for row in rows {
            let valid = row.value.unwrap_or(0.0);
            let good = row.extra.get("good").and_then(json_to_f64).unwrap_or(0.0);
            groups.insert(row.labels, (good, valid));
        }
        window_values.insert(w.name.clone(), groups);
    }

    // Every due window's query succeeded: record success (recovers a degraded SLO)
    // before building and persisting the new snapshot.
    store
        .record_slo_success(slo.id, &slo.tenant, eval_ts)
        .await?;

    let due_names: BTreeSet<&str> = due_windows.iter().map(|w| w.name.as_str()).collect();
    let tiers = slo.spec.tiers.clone().unwrap_or_else(canonical_tiers);
    let budget_window_name = window_name_for(&slo.spec.time_window.duration);

    let prior_by_labels: BTreeMap<GroupKey, &SloGroupStatus> =
        prior.groups.iter().map(|g| (g.labels.clone(), g)).collect();

    // Union of every group ever seen: the prior snapshot's groups, plus any new
    // group labels observed in this tick's due-window results.
    let mut all_labels: BTreeSet<GroupKey> =
        prior.groups.iter().map(|g| g.labels.clone()).collect();
    for groups in window_values.values() {
        all_labels.extend(groups.keys().cloned());
    }

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

    let mut window_computed_at = prior.window_computed_at;
    for w in &due_windows {
        window_computed_at.insert(w.name.clone(), eval_unix);
    }

    let payload = SloStatusPayload {
        window: slo.spec.time_window.duration.clone(),
        target_percent: slo.spec.target_percent,
        degraded: false,
        groups: out_groups,
        window_computed_at,
    };

    store
        .upsert_slo_status(
            slo.id,
            &slo.tenant,
            &serde_json::to_value(&payload)?,
            eval_ts,
        )
        .await?;

    Ok(())
}

/// Claim + resolve + evaluate every delivery in one SLO batch, swallowing per-job
/// errors (logged) so one bad job never blocks the rest of the batch. Returns the
/// ack ids for every delivery in the batch (computed up front, before any
/// processing) — a claim/lookup/eval failure for one job still acks that job, since
/// redelivering it would either re-fail identically or (if the (slo, eval_ts) pair
/// was already claimed) be a no-op anyway.
async fn process_slo_batch_inner(
    store: &PgStore,
    ch: &dyn RowQuerier,
    base_cadence_secs: u64,
    degrade_after: u32,
    deliveries: Vec<SloDelivery>,
) -> Vec<JobId> {
    let ack_ids: Vec<JobId> = deliveries.iter().map(|d| d.id.clone()).collect();
    for d in deliveries {
        let job = d.job;
        match store.try_claim_slo_eval(job.slo, job.eval_ts).await {
            Ok(true) => {}
            Ok(false) => continue, // another worker already claimed this (slo, eval_ts)
            Err(e) => {
                tracing::error!(slo = ?job.slo, error = %e, "try_claim_slo_eval failed");
                continue;
            }
        }
        match store.get_slo(job.tenant.clone(), job.slo).await {
            Ok(Some(slo)) if !slo.paused => {
                if let Err(e) = evaluate_slo(
                    store,
                    ch,
                    &slo,
                    job.eval_ts,
                    base_cadence_secs,
                    degrade_after,
                )
                .await
                {
                    tracing::error!(slo = ?job.slo, error = %e, "slo evaluation errored");
                }
            }
            Ok(_) => {} // paused or deleted: drop the in-flight job (still acked)
            Err(e) => tracing::error!(slo = ?job.slo, error = %e, "get_slo failed"),
        }
    }
    ack_ids
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
            base_cadence_secs,
            degrade_after,
            deliveries,
        ));
        let to_ack = match futures::FutureExt::catch_unwind(batch).await {
            Ok(ids) => ids,
            Err(payload) => {
                let msg = crate::supervisor::panic_message(payload);
                tracing::error!(
                    panic = %msg,
                    deliveries = ack_ids.len(),
                    "slo evaluation batch panicked; acking the batch and continuing"
                );
                ack_ids
            }
        };
        for id in to_ack {
            if let Err(e) = queue.ack_slo(&id).await {
                tracing::error!(error = %e, "ack_slo failed");
            }
        }
    }
    tracing::info!("slo evaluator stopped");
}
