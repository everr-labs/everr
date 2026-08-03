//! Still-firing reminder (`repeat_interval_secs`) behavior of the group flush path.
//!
//! Tests drive the same functions the flusher loop does (`process_event` to buffer,
//! `flush_group` to flush) with a short store-level repeat interval (the 60s API
//! minimum is an API-layer rule; the dispatcher honors whatever the route stores).

use crate::common;
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::{flush_group, grouping, process_event, DispatchCtx};
use cc::domain::channel::ChannelConfig;
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::routing::{MatchOp, Matcher};
use cc::queue::groups::GroupStore;
use cc::queue::EventBus;
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

fn ev_status(tenant: TenantId, status: EventStatus) -> Event {
    let mut e = common::base_event();
    e.tenant = tenant;
    e.instance_key = InstanceKey("svc=api".into());
    e.status = status;
    e.labels = BTreeMap::from([("svc".to_string(), "api".to_string())]);
    e.value = Some(1.0);
    e
}

struct Harness {
    _infra: common::DispatchInfra,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    ctx: DispatchCtx,
    groups: Arc<dyn GroupStore>,
    tenant: TenantId,
    hits: Arc<AtomicUsize>,
    gid: String,
}

impl Harness {
    /// Buffer one event through the real ingest path.
    async fn buffer(&self, ev: &Event) {
        self.bus.publish(ev).await.unwrap();
        let entries = self.bus.consume("t", 16, 500).await.unwrap();
        let entry = entries.last().unwrap();
        let acked = process_event(&self.ctx, entry).await;
        assert!(acked, "event should buffer and ack");
        self.bus.ack(&entry.id).await.unwrap();
    }

    async fn flush(&self) {
        // The real flusher loop CLAIMS due timers (removing them from the ZSET) before
        // flushing; mirror that so leftover due timers don't masquerade as reminders.
        let _ = self.groups.claim_due(Harness::now_ms(), 16).await.unwrap();
        flush_group(&self.ctx, &self.gid).await;
    }

    fn hits(&self) -> usize {
        self.hits.load(Ordering::Relaxed)
    }

    fn now_ms() -> i64 {
        (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
    }
}

/// Bring up Postgres + Redis, one webhook receiver, and one catch-all route with the
/// given repeat interval (group_wait/group_interval = 0 so flushes are immediately due).
async fn setup(repeat_interval_secs: Option<u32>) -> Harness {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();
    let ctx = DispatchCtx {
        cache: Arc::new(FilterCache::with_ttl(store.clone(), Duration::ZERO)),
        ..common::dispatch_ctx(&infra)
    };

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let receiver_name = "oncall";
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook { url },
        )
        .await
        .unwrap();
    let cc::stores::ReceiverWrite::Stored(receiver) = store
        .create_receiver(
            tenant.clone(),
            receiver_name,
            &["oncall-hook".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap()
    else {
        panic!("expected the receiver to be stored");
    };
    store
        .create_route(
            tenant.clone(),
            &[],
            receiver_name,
            false,
            0,
            None,
            Some(0),
            Some(0),
            repeat_interval_secs,
        )
        .await
        .unwrap();

    // The deterministic group id for our single instance (default group_by).
    let group_by = grouping::default_group_by();
    let labels =
        cc::dispatcher::routing::match_labels(&ev_status(tenant.clone(), EventStatus::Firing));
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, &receiver.id.to_string(), &group_by, &values);

    Harness {
        store,
        bus: infra.bus.clone(),
        groups: infra.groups.clone(),
        _infra: infra,
        ctx,
        tenant,
        hits,
        gid,
    }
}

/// A group with a still-firing alert re-notifies once the repeat interval elapses,
/// and the reminder is NOT collapsed by the dedup ledger even though the active set
/// is byte-identical to the original send.
#[tokio::test]
async fn still_firing_group_renotifies_after_repeat_interval() {
    let h = setup(Some(1)).await; // 1s repeat: dispatcher-level, below the API min on purpose
    h.buffer(&ev_status(h.tenant.clone(), EventStatus::Firing))
        .await;

    h.flush().await;
    assert_eq!(h.hits(), 1, "original notification delivered");

    // The reminder timer is armed (claim it far in the future without consuming state).
    // Note: claim_due removes the timer, so we re-check via the actual flush below.
    let due = h
        .groups
        .claim_due(Harness::now_ms() + 2_000, 16)
        .await
        .unwrap();
    assert_eq!(due, vec![h.gid.clone()], "reminder armed after the send");

    // Not due yet: an early flush attempt sends nothing.
    h.flush().await;
    assert_eq!(h.hits(), 1, "repeat interval not elapsed; no reminder yet");

    tokio::time::sleep(Duration::from_millis(1_200)).await;
    h.flush().await;
    assert_eq!(
        h.hits(),
        2,
        "still-firing set re-notified after the interval (dedup must not collapse it)"
    );

    // And the loop continues: a further reminder is armed.
    tokio::time::sleep(Duration::from_millis(1_200)).await;
    h.flush().await;
    assert_eq!(h.hits(), 3, "reminders keep coming while the alert fires");
}

/// Without `repeat_interval_secs` (null), behavior is unchanged: exactly one
/// notification, no reminder timer, and later flushes send nothing.
#[tokio::test]
async fn null_repeat_interval_never_renotifies() {
    let h = setup(None).await;
    h.buffer(&ev_status(h.tenant.clone(), EventStatus::Firing))
        .await;

    h.flush().await;
    assert_eq!(h.hits(), 1);

    let due = h
        .groups
        .claim_due(Harness::now_ms() + 3_600_000, 16)
        .await
        .unwrap();
    assert!(
        due.is_empty(),
        "no reminder timer without a repeat interval"
    );

    tokio::time::sleep(Duration::from_millis(1_200)).await;
    h.flush().await;
    assert_eq!(
        h.hits(),
        1,
        "null repeat = today's behavior: never re-notify"
    );
}

/// Once every alert in the group has resolved, reminders stop: the resolve itself is
/// delivered (status change), but no repeat follows.
#[tokio::test]
async fn resolved_groups_do_not_repeat() {
    let h = setup(Some(1)).await;
    h.buffer(&ev_status(h.tenant.clone(), EventStatus::Firing))
        .await;
    h.flush().await;
    assert_eq!(h.hits(), 1, "firing notification");

    h.buffer(&ev_status(h.tenant.clone(), EventStatus::Resolved))
        .await;
    h.flush().await;
    assert_eq!(h.hits(), 2, "resolved notification (status change)");

    tokio::time::sleep(Duration::from_millis(1_200)).await;
    h.flush().await;
    assert_eq!(h.hits(), 2, "resolved-only groups never repeat");
    let due = h
        .groups
        .claim_due(Harness::now_ms() + 3_600_000, 16)
        .await
        .unwrap();
    assert!(due.is_empty(), "no reminder timer remains after resolve");
}

/// A silence created between the original send and the reminder suppresses the
/// reminder, but keeps the reminder loop alive (armed) for when the silence lifts.
#[tokio::test]
async fn repeat_respects_a_silence_created_in_the_meantime() {
    let h = setup(Some(1)).await;
    h.buffer(&ev_status(h.tenant.clone(), EventStatus::Firing))
        .await;
    h.flush().await;
    assert_eq!(h.hits(), 1);

    let now = OffsetDateTime::now_utc();
    h.store
        .create_silence(
            h.tenant.clone(),
            &[Matcher {
                label: "svc".into(),
                op: MatchOp::Eq,
                value: "api".into(),
            }],
            now - time::Duration::seconds(5),
            now + time::Duration::hours(1),
            "maint",
            "ops",
        )
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(1_200)).await;
    h.flush().await;
    assert_eq!(h.hits(), 1, "the reminder is silenced, not delivered");

    // The loop is still armed so reminders resume after the silence expires.
    let due = h
        .groups
        .claim_due(Harness::now_ms() + 2_500, 16)
        .await
        .unwrap();
    assert_eq!(
        due,
        vec![h.gid.clone()],
        "reminder re-armed despite the silence"
    );
}
