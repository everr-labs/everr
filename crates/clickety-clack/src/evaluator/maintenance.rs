use crate::domain::event::{Event, EventStatus};
use crate::domain::ids::RuleId;
use crate::domain::instance::{InstanceState, StaleInstance, Status};
use crate::queue::EventBus;
use crate::stores::{PgStore, RedisLease};
use std::time::Duration as StdDuration;
use time::{Duration, OffsetDateTime};

/// Grace window before the relay re-publishes an unpublished outbox row.
pub const OUTBOX_GRACE: Duration = Duration::seconds(5);
/// Retention for expired silences before GC removes them.
pub const SILENCE_RETENTION: Duration = Duration::hours(24);
/// Wall-clock cadence for silence GC, independent of tick rate and lease hand-offs.
const GC_INTERVAL: Duration = Duration::hours(1);
/// Max outbox rows relayed per tick.
const RELAY_BATCH: i64 = 256;
/// Max stale instances reconciled per transaction. A full sweep loops in chunks of this
/// size so a backlog after an outage never becomes one unbounded transaction.
const RECONCILE_BATCH: i64 = 256;
/// Retention for the rule/SLO evaluation idempotency ledgers (`evaluations` /
/// `slo_evaluations`) before GC prunes them. Piggybacks on the same hourly
/// [`GC_INTERVAL`] cadence as silence GC rather than a second wall-clock timer.
const LEDGER_RETENTION: Duration = Duration::days(7);

/// Whether the hourly silence GC is due as of `now`, given the last run time.
/// `None` (never run) is always due. Wall-clock based so it survives lease hand-offs.
fn gc_due(last_gc: Option<OffsetDateTime>, now: OffsetDateTime) -> bool {
    last_gc.is_none_or(|t| now - t >= GC_INTERVAL)
}

/// Re-publish outbox rows older than `cutoff`, deleting each on success. Returns how
/// many were republished.
pub async fn relay_once(
    store: &PgStore,
    bus: &dyn EventBus,
    cutoff: OffsetDateTime,
    batch: i64,
) -> anyhow::Result<usize> {
    let claimed = store.claim_outbox(cutoff, batch).await?;
    if claimed.is_empty() {
        return Ok(0);
    }
    let (ids, events): (Vec<uuid::Uuid>, Vec<Event>) = claimed.into_iter().unzip();
    // One pipelined publish for the whole batch; only the rows whose events actually
    // published are deleted, so an unpublished row is retried next tick. A publish
    // failure is a transient broker hiccup we warn-and-continue on.
    let published = bus.publish_batch(&events).await?;
    if published.len() < events.len() {
        tracing::warn!(
            failed = events.len() - published.len(),
            "relay publish failed for some events; will retry next tick"
        );
    }
    let to_delete = crate::evaluator::published_outbox_ids(&ids, &published);
    let republished = to_delete.len();
    // Publish succeeded but delete failed: propagate via `?`. A delete_outbox_batch
    // error signals an unhealthy DB, and since the events are already published the
    // rows will simply be re-published next tick (duplicates the dispatcher dedups).
    store.delete_outbox_batch(&to_delete).await?;
    Ok(republished)
}

/// Which stale set a reconciliation pass drains: rule instances, or SLO burn-rate
/// instances (which carry the scheduler cadence their stale predicate needs).
#[derive(Clone, Copy)]
enum ReconcileKind {
    Rule,
    Slo { cadence_secs: i64 },
}

/// Auto-resolve stale instances as of `now`. Stale firing -> synthetic Resolved event
/// (written through the outbox, published, deleted) + reset to Inactive. Stale pending
/// -> reset to Inactive silently. Returns how many instances were reconciled.
///
/// The sweep is drained in chunks of [`RECONCILE_BATCH`] (see [`reconcile_sweep`]) so a
/// backlog after an outage never becomes one unbounded transaction.
pub async fn reconcile_once(
    store: &PgStore,
    bus: &dyn EventBus,
    now: OffsetDateTime,
) -> anyhow::Result<usize> {
    reconcile_sweep(store, bus, now, RECONCILE_BATCH).await
}

/// Drain the stale set as of `now` in transactions of at most `batch` instances each.
///
/// Each chunk is its own all-or-nothing `commit_and_publish`: every reconciled instance
/// resets to Inactive with `last_seen = now`, so it leaves the stale predicate and the
/// next page advances without an OFFSET. A mid-sweep failure propagates and retries on the
/// next maintenance tick; chunks already committed stay committed (re-resolving an Inactive
/// instance is idempotent). `batch` is a parameter so chunking is testable without seeding
/// thousands of rows; production always uses [`RECONCILE_BATCH`] via [`reconcile_once`].
pub async fn reconcile_sweep(
    store: &PgStore,
    bus: &dyn EventBus,
    now: OffsetDateTime,
    batch: i64,
) -> anyhow::Result<usize> {
    sweep(store, bus, now, ReconcileKind::Rule, batch).await
}

/// Auto-resolve stale SLO burn-rate instances as of `now`. Mirrors [`reconcile_once`]/
/// [`reconcile_sweep`] exactly, against `slo_instances` via
/// [`PgStore::list_stale_slo_instances`] and [`crate::evaluator::slo::commit_and_publish_slo`]
/// instead of the rule-side tables. Returns how many SLO instances were reconciled.
pub async fn reconcile_slo_once(
    store: &PgStore,
    bus: &dyn EventBus,
    now: OffsetDateTime,
    cadence_secs: i64,
) -> anyhow::Result<usize> {
    sweep(
        store,
        bus,
        now,
        ReconcileKind::Slo { cadence_secs },
        RECONCILE_BATCH,
    )
    .await
}

/// The one sweep implementation behind [`reconcile_sweep`] and [`reconcile_slo_once`]:
/// identical chunked drain, with `kind` selecting the stale lister, the commit path,
/// and the transition's SLO stamping.
async fn sweep(
    store: &PgStore,
    bus: &dyn EventBus,
    now: OffsetDateTime,
    kind: ReconcileKind,
    batch: i64,
) -> anyhow::Result<usize> {
    let mut total = 0;
    loop {
        let stale = match kind {
            ReconcileKind::Rule => store.list_stale_instances(now, batch).await?,
            ReconcileKind::Slo { cadence_secs } => {
                store
                    .list_stale_slo_instances(now, cadence_secs, batch)
                    .await?
            }
        };
        let n = stale.len();
        if n == 0 {
            break;
        }
        let mut next_states: Vec<InstanceState> = Vec::with_capacity(n);
        let mut out_events: Vec<Event> = Vec::new();
        for s in stale {
            let (next, maybe_ev) = reconcile_transition(s, now);
            if let Some(ev) = maybe_ev {
                out_events.push(ev);
            }
            next_states.push(next);
        }
        match kind {
            ReconcileKind::Rule => {
                crate::evaluator::commit_and_publish(store, bus, next_states, out_events).await?
            }
            ReconcileKind::Slo { .. } => {
                crate::evaluator::slo::commit_and_publish_slo(store, bus, next_states, out_events)
                    .await?
            }
        }
        total += n;
        // A short page means the backlog is drained; a full page means more may remain.
        if (n as i64) < batch {
            break;
        }
    }
    Ok(total)
}

/// Pure reconciliation transition: a stale instance resets to Inactive; a stale FIRING
/// instance additionally emits a synthetic Resolved event (others emit nothing).
/// The event's `slo` stamp follows the instance's [`crate::domain::ids::SourceId`]
/// (its `rule` field carries the same uuid, the `Event` wire convention).
fn reconcile_transition(s: StaleInstance, now: OffsetDateTime) -> (InstanceState, Option<Event>) {
    let next = InstanceState {
        key: s.key.clone(),
        source: s.source,
        tenant: s.tenant.clone(),
        status: Status::Inactive,
        labels: s.labels.clone(),
        value: s.value,
        active_since: None,
        last_seen: Some(now),
        absent_count: 0,
    };
    let ev = match s.status {
        Status::Firing => {
            let mut ev = Event::new(
                s.tenant,
                RuleId(s.source.uuid()),
                s.key,
                EventStatus::Resolved,
                s.labels,
                s.value,
                s.severity,
                s.annotations,
                now,
            );
            ev.slo = s.source.slo_id();
            // A preview (suppressed) rule's or SLO's synthetic Resolved must not notify
            // either. No source row here, so evidence stays None/untruncated.
            ev.suppressed = s.suppressed;
            Some(ev)
        }
        _ => None,
    };
    (next, ev)
}

/// Lease-singleton maintenance loop: relay + reconciliation every tick, silence GC
/// and ledger prune hourly. Mirrors `run_scheduler`'s lease + watch-shutdown pattern.
pub async fn run_maintenance(
    store: PgStore,
    bus: std::sync::Arc<dyn EventBus>,
    lease: RedisLease,
    tick: StdDuration,
    slo_cadence_secs: i64,
    metrics: crate::otel::EngineMetrics,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    // Wall-clock GC cadence: a new leader does one GC then waits a real hour, so cadence
    // survives lease hand-offs without drifting or re-firing on every failover.
    let mut last_gc: Option<OffsetDateTime> = None;
    loop {
        if *shutdown.borrow() {
            break;
        }
        match lease.acquire_or_refresh().await {
            Ok(true) => {
                let now = OffsetDateTime::now_utc();
                match relay_once(&store, bus.as_ref(), now - OUTBOX_GRACE, RELAY_BATCH).await {
                    // Every republished row is an event whose first publish never
                    // completed: a cheap standing proxy for outbox backlog health.
                    Ok(n) => metrics.record_outbox_relayed(n as u64),
                    Err(e) => tracing::error!(error = %e, "outbox relay failed"),
                }
                if let Err(e) = reconcile_once(&store, bus.as_ref(), now).await {
                    tracing::error!(error = %e, "reconciliation failed");
                }
                if let Err(e) =
                    reconcile_slo_once(&store, bus.as_ref(), now, slo_cadence_secs).await
                {
                    tracing::error!(error = %e, "slo reconciliation failed");
                }
                if gc_due(last_gc, now) {
                    match store.gc_silences(now - SILENCE_RETENTION).await {
                        Ok(n) if n > 0 => tracing::info!(removed = n, "expired silences GC'd"),
                        Ok(_) => {}
                        Err(e) => tracing::error!(error = %e, "silence GC failed"),
                    }
                    match store.prune_eval_ledgers(now - LEDGER_RETENTION).await {
                        Ok((rules, slos)) => tracing::debug!(
                            rules_pruned = rules,
                            slos_pruned = slos,
                            "eval ledgers pruned"
                        ),
                        Err(e) => tracing::error!(error = %e, "eval ledger prune failed"),
                    }
                    // Set regardless of Ok/Err so a transient GC error doesn't busy-loop.
                    last_gc = Some(now);
                }
            }
            Ok(false) => tracing::debug!("maintenance standby (lease held elsewhere)"),
            Err(e) => tracing::error!(error = %e, "lease error"),
        }
        tokio::select! {
            _ = tokio::time::sleep(tick) => {}
            _ = shutdown.changed() => {}
        }
    }
    tracing::info!("maintenance stopped");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use uuid::Uuid;

    #[test]
    fn gc_due_first_run_and_after_interval() {
        let now = OffsetDateTime::UNIX_EPOCH + Duration::hours(100);
        // Never run -> due.
        assert!(gc_due(None, now));
        // Just ran -> not due.
        assert!(!gc_due(Some(now), now));
        // 59 minutes ago -> not due.
        assert!(!gc_due(Some(now - Duration::minutes(59)), now));
        // Exactly 1 hour ago -> due (>= boundary).
        assert!(gc_due(Some(now - Duration::hours(1)), now));
        // Over an hour ago -> due.
        assert!(gc_due(Some(now - Duration::minutes(61)), now));
    }

    fn stale(status: Status) -> crate::domain::instance::StaleInstance {
        let mut labels = std::collections::BTreeMap::new();
        labels.insert("host".to_string(), "web-01".to_string());
        crate::domain::instance::StaleInstance {
            key: InstanceKey("k1".into()),
            source: crate::domain::ids::SourceId::Rule(RuleId(Uuid::nil())),
            tenant: TenantId::from_trusted("t1".to_string()),
            status,
            labels,
            value: Some(42.0),
            severity: Severity::Critical,
            annotations: std::collections::BTreeMap::new(),
            suppressed: false,
        }
    }

    /// A stale FIRING instance of a suppressed (preview) rule synthesizes a Resolved
    /// event that carries the flag, so the dispatcher drops it like any other event of
    /// that rule. Evidence is absent (no source row for a reconciliation resolve).
    #[test]
    fn reconcile_stamps_suppressed_from_rule() {
        let now = OffsetDateTime::UNIX_EPOCH + Duration::hours(50);
        let mut s = stale(Status::Firing);
        s.suppressed = true;
        let (_, ev) = reconcile_transition(s, now);
        let ev = ev.expect("stale firing emits a Resolved event");
        assert!(ev.suppressed);
        assert_eq!(ev.evidence, None);
        assert!(!ev.evidence_truncated);
    }

    /// An SLO-sourced stale FIRING instance stamps its SLO identity on the synthetic
    /// Resolved event (`rule` carries the same uuid, the Event wire convention).
    #[test]
    fn reconcile_stamps_slo_from_source() {
        let now = OffsetDateTime::UNIX_EPOCH + Duration::hours(50);
        let slo = crate::domain::ids::SloId(Uuid::from_u128(7));
        let mut s = stale(Status::Firing);
        s.source = crate::domain::ids::SourceId::Slo(slo);
        let (next, ev) = reconcile_transition(s, now);
        let ev = ev.expect("stale firing emits a Resolved event");
        assert_eq!(ev.slo, Some(slo));
        assert_eq!(ev.rule, RuleId(slo.0));
        assert_eq!(next.source, crate::domain::ids::SourceId::Slo(slo));
    }

    /// `reconcile_transition` pure: no DB, no async.
    /// For [Firing, Firing, Pending, Inactive] we expect 4 Inactive next-states and
    /// exactly 2 Resolved events (one per Firing, none for the others).
    #[test]
    fn reconcile_transition_equivalence() {
        let now = OffsetDateTime::UNIX_EPOCH + Duration::hours(50);
        let inputs = vec![
            stale(Status::Firing),
            stale(Status::Firing),
            stale(Status::Pending),
            stale(Status::Inactive),
        ];

        let results: Vec<_> = inputs
            .into_iter()
            .map(|s| reconcile_transition(s, now))
            .collect();

        // All next-states must be Inactive.
        assert_eq!(results.len(), 4);
        for (next, _) in &results {
            assert_eq!(
                next.status,
                Status::Inactive,
                "every stale instance resets to Inactive"
            );
            assert_eq!(next.last_seen, Some(now));
            assert_eq!(next.active_since, None);
            assert_eq!(next.absent_count, 0);
        }

        // Collect events.
        let events: Vec<_> = results.iter().filter_map(|(_, ev)| ev.as_ref()).collect();
        assert_eq!(
            events.len(),
            2,
            "only Firing instances emit a Resolved event"
        );
        for ev in &events {
            assert_eq!(ev.status, EventStatus::Resolved);
        }

        // Pending and Inactive produce no event.
        let (_, pending_ev) = &results[2];
        let (_, inactive_ev) = &results[3];
        assert!(pending_ev.is_none(), "Pending must not emit an event");
        assert!(inactive_ev.is_none(), "Inactive must not emit an event");

        // The Firing transitions preserve key, labels, severity.
        let (next0, ev0) = &results[0];
        let ev0 = ev0.as_ref().unwrap();
        assert_eq!(ev0.instance_key, next0.key);
        assert_eq!(ev0.labels, next0.labels);
        assert_eq!(ev0.severity, Severity::Critical);
        assert_eq!(ev0.value, Some(42.0));
    }
}
