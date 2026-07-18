//! Spec §5 tier inhibition, container-tested end to end through `FilterCache::load`:
//! materializing an SLO auto-provisions in-memory inhibitions (never stored — see
//! `cc::dispatcher::slo_inhibit`), and firing SLO instances join the firing
//! source-set labeled with their SLO identity so the synthesized `equal: ["slo", ...]`
//! comparison sees the label on both sides.

use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::inhibition::is_inhibited;
use cc::dispatcher::routing::match_labels;
use cc::domain::event::{Event, EventKind, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, SloId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::Severity;
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::stores::{PgStore, SloCreate};
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

fn tenant() -> TenantId {
    TenantId::from_trusted(Uuid::new_v4().to_string())
}

fn spec() -> SloSpec {
    SloSpec {
        sli: SliSpec {
            sql: "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(),
            label_columns: vec!["service".to_string()],
        },
        target_percent: 99.9,
        time_window: TimeWindow {
            duration: "30d".into(),
            is_rolling: true,
            calendar: None,
        },
        min_valid_events: None,
        tiers: None, // canonical: fast-burn, slow-burn, ticket
        annotations: BTreeMap::new(),
        suppressed: false,
    }
}

/// A hypothetical burn-rate-tier event for `slo`, never actually dispatched — just used
/// to build the same synthetic label set `process_event` would build for a real one, so
/// `is_inhibited` sees exactly what the dispatcher would.
fn tier_event(tenant: TenantId, slo: SloId, service: &str, tier: &str) -> Event {
    tier_event_with_status(tenant, slo, service, tier, EventStatus::Firing)
}

/// Like [`tier_event`] but with an explicit status, so callers can build a Resolved
/// event for the "does a resolve ever get swallowed" case.
fn tier_event_with_status(
    tenant: TenantId,
    slo: SloId,
    service: &str,
    tier: &str,
    status: EventStatus,
) -> Event {
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), service.to_string());
    labels.insert("slo_tier".to_string(), tier.to_string());
    Event {
        tenant,
        rule: RuleId(slo.0),
        slo: Some(slo),
        instance_key: InstanceKey(format!("{service}-{tier}")),
        status,
        kind: EventKind::Alert,
        labels,
        value: Some(1.0),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

#[tokio::test]
async fn snapshot_synthesizes_tier_inhibitions_and_feeds_slo_firing_set() {
    let store = PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap();
    let tenant = tenant();

    let slo_id = match store
        .create_slo(tenant.clone(), "checkout-availability", &spec())
        .await
        .unwrap()
    {
        SloCreate::Created(slo) => slo.id,
        other => panic!("expected Created, got {other:?}"),
    };

    // Seed a FIRING fast-burn slo_instances row: service=api.
    let rule = RuleId(slo_id.0);
    let fast_labels = BTreeMap::from([
        ("service".to_string(), "api".to_string()),
        ("slo_tier".to_string(), "fast-burn".to_string()),
    ]);
    let fast_key = InstanceKey::new(rule, &fast_labels);
    let now = OffsetDateTime::now_utc();
    let mut fast_instance =
        InstanceState::new_inactive(fast_key.clone(), rule, tenant.clone(), fast_labels);
    fast_instance.status = Status::Firing;
    fast_instance.value = Some(20.0);
    fast_instance.active_since = Some(now);
    fast_instance.last_seen = Some(now);
    store
        .persist_slo_eval_batch(std::slice::from_ref(&fast_instance), &[])
        .await
        .unwrap();

    let cache = FilterCache::with_ttl(store.clone(), std::time::Duration::ZERO);
    let snap = cache.snapshot(tenant.clone()).await.unwrap();

    // 3 tier pairs synthesized for the canonical 3 tiers, and nothing else for a fresh
    // tenant (no persisted inhibitions).
    assert_eq!(
        snap.inhibitions.len(),
        3,
        "3 tier-pair inhibitions synthesized for canonical tiers"
    );
    // The fast-burn firing instance joined the source-set, labeled with its SLO identity.
    assert_eq!(snap.firing.len(), 1);
    assert_eq!(snap.firing[0].0, fast_key);
    assert_eq!(
        snap.firing[0].1.get("slo").map(String::as_str),
        Some(slo_id.0.to_string().as_str()),
        "SLO-originated firing instance is labeled with its SLO identity"
    );

    // A slow-burn event for the SAME slo+service is inhibited by the firing fast-burn tier.
    let slow_same_service = tier_event(tenant.clone(), slo_id, "api", "slow-burn");
    assert!(
        is_inhibited(
            &match_labels(&slow_same_service),
            &slow_same_service.instance_key,
            &snap.inhibitions,
            &snap.firing,
        ),
        "slow-burn tier must be inhibited by the firing fast-burn tier for the same group"
    );

    // A slow-burn event for a DIFFERENT service is not inhibited: `equal: ["service","slo"]`
    // fails on `service`.
    let slow_other_service = tier_event(tenant.clone(), slo_id, "web", "slow-burn");
    assert!(
        !is_inhibited(
            &match_labels(&slow_other_service),
            &slow_other_service.instance_key,
            &snap.inhibitions,
            &snap.firing,
        ),
        "different service must not be inhibited"
    );

    // The fast-burn event itself is never self-inhibited (self-inhibition guard: it is
    // itself a source, and using its own key excludes it from the firing set too).
    let fast_self = tier_event(tenant.clone(), slo_id, "api", "fast-burn");
    let mut fast_self = fast_self;
    fast_self.instance_key = fast_key.clone();
    assert!(
        !is_inhibited(
            &match_labels(&fast_self),
            &fast_self.instance_key,
            &snap.inhibitions,
            &snap.firing,
        ),
        "the fast-burn tier itself must never be self-inhibited"
    );

    // A slow-burn RESOLVED event for the same slo+service must never be swallowed, even
    // while the fast-burn tier is still firing: a delivered page's resolve must always be
    // able to close the incident (resolves don't page, so suppressing one buys nothing).
    let slow_resolved_same_service = tier_event_with_status(
        tenant.clone(),
        slo_id,
        "api",
        "slow-burn",
        EventStatus::Resolved,
    );
    assert!(
        !is_inhibited(
            &match_labels(&slow_resolved_same_service),
            &slow_resolved_same_service.instance_key,
            &snap.inhibitions,
            &snap.firing,
        ),
        "a Resolved slow-burn event must never be inhibited by a still-firing fast-burn tier"
    );
}
