//! The engine-native SLO evaluator: computes per-group SLI, per-tier burn rate,
//! and error-budget-remaining from the SLI query, writing a status snapshot.
//!
//! No alerting lives here (that's Plan 3): this module only ever writes the
//! `slo_status` snapshot (via [`PgStore::upsert_slo_status`]) and the SLO's
//! health columns (via [`PgStore::record_slo_failure`] /
//! [`PgStore::record_slo_success`]). It never creates `instances` rows, emits
//! `Event`s, or touches the dispatcher.

use crate::clickhouse::{json_to_f64, RowQuerier};
use crate::domain::rule::Severity;
use crate::domain::slo::{canonical_tiers, parse_window_secs, BurnRateTier, Slo, SloSpec};
use crate::engine::slo_math::{
    budget_remaining_fraction, burn_rate, empty_payload, fmt_burn, fmt_duration_secs, fmt_pct,
    is_window_due, required_windows, time_to_exhaustion_secs, SloGroupStatus, SloStatusPayload,
    SloTierStatus, WindowReq,
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
                    // populated by the firing pipeline
                    long_window_valid: None,
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

/// One (group × tier) firing verdict: the pure output of comparing an
/// already-computed [`SloStatusPayload`] snapshot against the [`SloSpec`]'s
/// burn-rate tiers. No I/O; a later stage (Task 7) feeds each verdict through
/// the engine state machine to actually open/resolve instances.
// wired by the firing pipeline (Task 7); remove this allow once it lands.
#[allow(dead_code)]
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
// wired by the firing pipeline (Task 7); remove this allow once it lands.
#[allow(dead_code)]
pub(crate) fn plan_tier_firing(spec: &SloSpec, payload: &SloStatusPayload) -> Vec<TierFiring> {
    let tiers = spec.tiers.clone().unwrap_or_else(canonical_tiers);
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
            labels.insert("slo_tier".to_string(), tier.name.clone());

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
// wired by the firing pipeline (Task 7); remove this allow once it lands.
#[allow(dead_code)]
pub(crate) fn slo_annotations(slo: &Slo, tier: &BurnRateTier) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    out.insert(
        "summary".to_string(),
        format!(
            "SLO {name}: {tier} burn — ${{burn_rate}}× over {long_window}",
            name = slo.name,
            tier = tier.name,
            long_window = tier.long_window,
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
// wired by the firing pipeline (Task 7); remove this allow once it lands.
#[allow(dead_code)]
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
    use crate::domain::slo::{BurnRateTier, SliSpec, TimeWindow};

    fn spec_with(min_valid_events: Option<u64>, tiers: Option<Vec<BurnRateTier>>) -> SloSpec {
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
            tiers,
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
            degraded: false,
            groups: vec![SloGroupStatus {
                labels,
                sli: None,
                budget_remaining,
                tiers,
            }],
            window_computed_at: BTreeMap::new(),
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
    fn fires_only_when_both_windows_breach() {
        let spec = spec_with(None, None); // canonical tiers, fast-burn threshold 14.4

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
        let spec = spec_with(None, None);
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
        let spec_floored = spec_with(Some(1000), None);

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
        let spec_no_floor = spec_with(None, None);
        let firings = plan_tier_firing(&spec_no_floor, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(fast.present);
    }

    #[test]
    fn labels_carry_tier_and_group() {
        let spec = spec_with(None, None); // canonical: 3 tiers
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
        let spec = spec_with(None, None); // canonical: ticket tier is Severity::Warning
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
        let spec = spec_with(None, None); // canonical tiers
        let mut tier_status_with_burns = tier_status("fast-burn", Some(15.0), Some(16.0));
        tier_status_with_burns.short_burn_rate = Some(16.0);

        let payload = SloStatusPayload {
            window: "30d".into(),
            target_percent: 99.9,
            degraded: false,
            groups: vec![SloGroupStatus {
                labels: group_labels(),
                sli: None,
                budget_remaining: Some(0.5),
                tiers: vec![tier_status_with_burns],
            }],
            window_computed_at: BTreeMap::new(),
        };

        let firings = plan_tier_firing(&spec, &payload);
        let fast = firings.iter().find(|f| f.tier_name == "fast-burn").unwrap();
        assert!(fast.present); // both burns exceed 14.4 threshold
        assert_eq!(fast.short_burn, Some(16.0));
        assert_eq!(fast.budget_remaining, Some(0.5));
    }

    #[test]
    fn burn_exactly_at_threshold_does_not_fire() {
        let spec = spec_with(None, None); // canonical: fast-burn threshold is 14.4
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
                tiers: None,
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
        assert!(ann.get("description").is_some());
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
