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

/// Bus that records every dead-letter reason, and optionally fails the write, so a test
/// can tell "durably recorded" apart from "silently dropped". `process_event` reaches
/// only `dead_letter` on the context bus; the test publishes and consumes on the real
/// one, so every other method is unreachable here.
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
            // Explicit variant so a QueueError refactor breaks at compile time.
            return Err(QueueError::Json(
                serde_json::from_str::<serde_json::Value>("§ not json").unwrap_err(),
            ));
        }
        Ok(())
    }
}

/// A route pointing at a receiver the snapshot does not have must never be acked with no
/// delivery and no record: the event is dead-lettered instead, and if that write fails
/// the event stays unacked for redelivery. The foreign key rules the state out of the
/// database, but not out of a snapshot assembled from concurrent reads.
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

    // What is under test is the in-memory snapshot, not the database: the foreign key
    // keeps the stored rows consistent, so the constraint has to come off to build the
    // dangling shape at all. `FilterCache::load` fills a snapshot with seven independent
    // concurrent reads, and a route delete plus a receiver delete interleaving between
    // the routes read and the receivers read produces exactly this -- a live route whose
    // receiver is already gone -- without the database ever holding it. `fresh_db` hands
    // every test its own database, so dropping the constraint here is isolated.
    let pool = sqlx::PgPool::connect(&infra.pg_url).await.unwrap();
    sqlx::query("ALTER TABLE routes DROP CONSTRAINT routes_tenant_receiver_fkey")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM receivers WHERE tenant=$1")
        .bind(tenant.as_str())
        .execute(&pool)
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
        reasons[0].contains("unknown receivers") && reasons[0].contains("ops"),
        "the reason names the missing receiver: {}",
        reasons[0]
    );

    // A failing dead-letter write must not ack: the event stays in the PEL for reclaim.
    spy.fail.store(true, Ordering::SeqCst);
    let ack = cc::dispatcher::process_event(&ctx, &entries[0]).await;
    assert!(
        !ack,
        "an event neither delivered nor recorded must stay unacked"
    );
}
