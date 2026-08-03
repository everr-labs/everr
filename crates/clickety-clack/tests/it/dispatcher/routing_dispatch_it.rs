use crate::common;
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::Severity;
use cc::queue::{EventBus, EventEntry, EventId, QueueError};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

fn ev(tenant: TenantId) -> Event {
    let mut e = common::base_event();
    e.tenant = tenant;
    e.instance_key = InstanceKey("svc=api".into());
    e.labels = BTreeMap::from([("svc".to_string(), "api".to_string())]);
    e.value = Some(1.0);
    e.severity = Severity::Critical;
    e
}

#[tokio::test]
async fn routed_event_delivers_to_matched_receiver() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();
    let ctx = common::dispatch_ctx(&infra);

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "ops-hook",
            &ChannelConfig::Webhook { url: url.clone() },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["ops-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap();
    store
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

    let dispatcher = common::spawn_dispatcher(&ctx, true);

    infra.bus.publish(&ev(tenant)).await.unwrap();

    for _ in 0..50 {
        if hits.load(Ordering::Relaxed) >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(
        hits.load(Ordering::Relaxed),
        1,
        "matched receiver delivered once via group flush"
    );

    dispatcher.shutdown().await;
}

/// Records dead letters and can fail the write to exercise redelivery.
#[derive(Default)]
struct DeadLetterSpy {
    reasons: Mutex<Vec<String>>,
    fail: AtomicBool,
}

impl DeadLetterSpy {
    fn reasons(&self) -> Vec<String> {
        self.reasons.lock().unwrap().clone()
    }
}

#[async_trait::async_trait]
impl EventBus for DeadLetterSpy {
    async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
        unreachable!()
    }
    async fn consume(&self, _c: &str, _n: usize, _b: usize) -> Result<Vec<EventEntry>, QueueError> {
        unreachable!()
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        unreachable!()
    }
    async fn dead_letter(&self, _ev: &Event, reason: &str) -> Result<(), QueueError> {
        self.reasons.lock().unwrap().push(reason.to_string());
        if self.fail.load(Ordering::SeqCst) {
            return Err(crate::common::queue_error());
        }
        Ok(())
    }
}

/// A missing snapshot receiver must dead-letter or remain unacked for redelivery.
#[tokio::test]
async fn route_with_a_dangling_receiver_dead_letters_instead_of_dropping() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();
    let base = common::dispatch_ctx(&infra);

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_channel(
            base.cipher.as_ref(),
            tenant.clone(),
            "ops-hook",
            &ChannelConfig::Webhook {
                url: "http://127.0.0.1:1/hook".to_string(),
            },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            tenant.clone(),
            "ops",
            &["ops-hook".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();
    store
        .create_route(
            tenant.clone(),
            &[], // matches every event
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

    // Simulate concurrent snapshot reads observing a route after its receiver vanished.
    // The test has an isolated database, so dropping the constraint is safe here. With
    // the receiver row gone, the route reads back with its raw receiver id where the
    // name would be (see `PgStore::routes_for`), so that id is what the dead-letter
    // reason must carry.
    let pool = infra.store.pool_for_test();
    sqlx::query("ALTER TABLE routes DROP CONSTRAINT routes_tenant_receiver_id_fkey")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM receivers WHERE tenant=$1")
        .bind(tenant.as_str())
        .execute(pool)
        .await
        .unwrap();
    let orphaned_receiver_id: String =
        sqlx::query_scalar("SELECT receiver_id::text FROM routes WHERE tenant=$1")
            .bind(tenant.as_str())
            .fetch_one(pool)
            .await
            .unwrap();

    let spy = Arc::new(DeadLetterSpy::default());
    let ctx = cc::dispatcher::DispatchCtx {
        bus: spy.clone(),
        ..base
    };

    infra.bus.publish(&ev(tenant.clone())).await.unwrap();
    let entries = infra.bus.consume("d1", 10, 2000).await.unwrap();
    assert_eq!(entries.len(), 1, "the published event is on the stream");

    let ack = cc::dispatcher::process_event(&ctx, &entries[0]).await;
    assert!(ack, "the event is acked once its dead-letter record lands");
    let reasons = spy.reasons();
    assert_eq!(reasons.len(), 1, "exactly one dead-letter record");
    assert!(
        reasons[0].contains("unknown receivers") && reasons[0].contains(&orphaned_receiver_id),
        "the reason names the missing receiver by id: {}",
        reasons[0]
    );

    spy.fail.store(true, Ordering::SeqCst);
    let ack = cc::dispatcher::process_event(&ctx, &entries[0]).await;
    assert!(
        !ack,
        "an event neither delivered nor recorded must stay unacked"
    );
}
