//! Suppressed (preview-rule) events must never notify: the dispatcher drops them at
//! ingest, before silence/inhibition processing, before group buffering (routed tenants)
//! and before the subscription firehose (no-routes tenants).

use crate::common;
use cc::dispatcher::{process_event, DispatchCtx};
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::Severity;
use cc::queue::groups::GroupStore;
use cc::queue::{EventBus, EventEntry};
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use uuid::Uuid;

fn suppressed_event(tenant: TenantId) -> Event {
    let mut e = common::base_event();
    e.tenant = tenant;
    e.instance_key = InstanceKey("svc=api".into());
    e.labels = BTreeMap::from([("svc".to_string(), "api".to_string())]);
    e.value = Some(1.0);
    e.severity = Severity::Critical;
    e.suppressed = true;
    e
}

struct Harness {
    _infra: common::DispatchInfra,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    groups: Arc<dyn GroupStore>,
    ctx: DispatchCtx,
}

impl Harness {
    fn ctx(&self) -> DispatchCtx {
        self.ctx.clone()
    }
}

async fn harness() -> Harness {
    let infra = common::dispatch_infra().await;
    let ctx = common::dispatch_ctx(&infra);
    Harness {
        store: infra.store.clone(),
        bus: infra.bus.clone(),
        groups: infra.groups.clone(),
        _infra: infra,
        ctx,
    }
}

/// Round-trip an event through the real bus so we get a consumable `EventEntry`
/// (its id is crate-private). Consumer names must be unique per call.
async fn entry_for(bus: &Arc<dyn EventBus>, ev: &Event, consumer: &str) -> EventEntry {
    bus.publish(ev).await.unwrap();
    let mut entries = bus.consume(consumer, 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);
    entries.remove(0)
}

/// Routed tenant: a suppressed event is acked (returns true) and buffers NOTHING into
/// its group, so no flush can ever deliver it.
#[tokio::test]
async fn suppressed_event_is_dropped_before_grouping() {
    let h = harness().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let (url, hits, _hook) = common::start_counting_webhook().await;

    h.store
        .create_channel(
            h.ctx.cipher.as_ref(),
            tenant.clone(),
            "ops-hook",
            &ChannelConfig::Webhook { url: url.clone() },
        )
        .await
        .unwrap();
    h.store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["ops-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap();
    h.store
        .create_route(
            tenant.clone(),
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            "ops",
            false,
            0,
            None,
            Some(0),
            None,
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let entry = entry_for(&h.bus, &suppressed_event(tenant), "grp-c1").await;
    let acked = process_event(&h.ctx(), &entry).await;

    assert!(acked, "a suppressed event is dropped, not left in the PEL");
    // Nothing was buffered: no group ever becomes due, even far in the future.
    let far_future = i64::MAX / 2;
    let due = h.groups.claim_due(far_future, 32).await.unwrap();
    assert!(
        due.is_empty(),
        "suppressed event must not create a notification group: {due:?}"
    );
    assert_eq!(hits.load(Ordering::Relaxed), 0, "no delivery of any kind");
}

/// No-routes tenant: a suppressed event skips the subscription firehose entirely: the
/// webhook is never called and no notification row is even begun.
#[tokio::test]
async fn suppressed_event_is_dropped_before_subscription_firehose() {
    let h = harness().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let (url, hits, _hook) = common::start_counting_webhook().await;

    h.store
        .create_subscription(h.ctx.cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    let ev = suppressed_event(tenant.clone());
    let entry = entry_for(&h.bus, &ev, "fh-c1").await;
    let acked = process_event(&h.ctx(), &entry).await;

    assert!(acked, "a suppressed event is dropped, not left in the PEL");
    assert_eq!(hits.load(Ordering::Relaxed), 0, "firehose must not deliver");
    let key = cc::dispatcher::dedup_key("webhook", &url, &ev);
    assert_eq!(
        h.store.notification_status(&tenant, &key).await.unwrap(),
        None,
        "no notification row is begun for a suppressed event"
    );

    // Sanity check: the same pipeline delivers a NON-suppressed event, so the zero
    // above is the suppression at work rather than a broken harness.
    let mut live = suppressed_event(TenantId::from_trusted("ignored".to_string()));
    live.tenant = ev.tenant.clone();
    live.suppressed = false;
    let entry = entry_for(&h.bus, &live, "fh-c2").await;
    let acked = process_event(&h.ctx(), &entry).await;
    assert!(acked);
    assert_eq!(
        hits.load(Ordering::Relaxed),
        1,
        "non-suppressed event on the same path delivers"
    );
}
