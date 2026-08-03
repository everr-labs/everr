use crate::common::*;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::{flush_group, process_event_batch, DispatchCtx, Notifiers, WebhookNotifier};
use cc::domain::ids::RuleId;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::groups::{GroupStore, RedisGroups};
use cc::queue::EventBus;
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --features container-tests --test it -- --ignored --nocapture load_dispatcher_ingest_throughput"]
async fn load_dispatcher_ingest_throughput() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    let cipher = test_cipher();
    let (hook_url, _count, _hook) = start_counting_webhook().await;
    let tenant = seed_dispatch_tenant(&pg.store, cipher.as_ref(), &hook_url).await;

    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis.url).await.unwrap());
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis.url).await.unwrap());
    let cache = Arc::new(FilterCache::new(pg.store.clone()));
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new(true)));
    let notifiers = Arc::new(reg);
    let rule = RuleId(Uuid::new_v4());

    // Publish E events (untimed).
    for i in 0..cfg.events {
        bus.publish(&make_event(&tenant, rule, i)).await.unwrap();
    }

    // Drain with bounded workers calling the real process_event; time the drain.
    let processed = Arc::new(AtomicUsize::new(0));
    let t0 = Instant::now();
    let mut handles = Vec::new();
    for w in 0..cfg.dispatch_workers {
        let ctx = DispatchCtx {
            store: pg.store.clone(),
            bus: bus.clone(),
            notifiers: notifiers.clone(),
            groups: groups.clone(),
            cache: cache.clone(),
            cipher: cipher.clone(),
            sink: Arc::new(cc::domain::sink::NullSink),
        };
        let (bus, processed) = (bus.clone(), processed.clone());
        let total = cfg.events;
        handles.push(tokio::spawn(async move {
            let consumer = format!("disp-w{w}");
            loop {
                if processed.load(Ordering::Relaxed) >= total {
                    break;
                }
                let entries = bus.consume(&consumer, 16, 100).await.unwrap();
                if entries.is_empty() {
                    if processed.load(Ordering::Relaxed) >= total {
                        break;
                    }
                    continue;
                }
                let n = entries.len();
                let acks = process_event_batch(&ctx, &entries).await;
                for (id, ack) in &acks {
                    if *ack {
                        bus.ack(id).await.unwrap();
                    }
                }
                processed.fetch_add(n, Ordering::Relaxed);
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
    let elapsed = t0.elapsed();

    assert_eq!(
        processed.load(Ordering::Relaxed),
        cfg.events,
        "all events processed"
    );

    report(
        "dispatcher-ingest",
        &[
            ("events", cfg.events.to_string()),
            ("workers", cfg.dispatch_workers.to_string()),
            ("wall", format!("{:.3}s", elapsed.as_secs_f64())),
            ("events/sec", format!("{:.0}", per_sec(cfg.events, elapsed))),
        ],
    );
}

/// Buffer E events into Redis groups via the real process_event (untimed setup for flush).
#[allow(clippy::too_many_arguments)]
async fn buffer_events(
    store: &cc::stores::PgStore,
    bus: &Arc<dyn EventBus>,
    groups: &Arc<dyn GroupStore>,
    cache: &Arc<FilterCache>,
    notifiers: &Arc<Notifiers>,
    cipher: &Arc<dyn cc::crypto::SecretCipher>,
    tenant: &cc::domain::ids::TenantId,
    rule: RuleId,
    events: usize,
    workers: usize,
) {
    for i in 0..events {
        bus.publish(&make_event(tenant, rule, i)).await.unwrap();
    }
    let processed = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();
    for w in 0..workers {
        let ctx = DispatchCtx {
            store: store.clone(),
            bus: bus.clone(),
            notifiers: notifiers.clone(),
            groups: groups.clone(),
            cache: cache.clone(),
            cipher: cipher.clone(),
            sink: Arc::new(cc::domain::sink::NullSink),
        };
        let (bus, processed) = (bus.clone(), processed.clone());
        handles.push(tokio::spawn(async move {
            let consumer = format!("buf-w{w}");
            loop {
                if processed.load(Ordering::Relaxed) >= events {
                    break;
                }
                let entries = bus.consume(&consumer, 16, 100).await.unwrap();
                if entries.is_empty() {
                    if processed.load(Ordering::Relaxed) >= events {
                        break;
                    }
                    continue;
                }
                let n = entries.len();
                let acks = process_event_batch(&ctx, &entries).await;
                for (id, ack) in &acks {
                    if *ack {
                        bus.ack(id).await.unwrap();
                    }
                }
                processed.fetch_add(n, Ordering::Relaxed);
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "load harness; needs Docker. Run: cargo test --release --features container-tests --test it -- --ignored --nocapture load_dispatcher_flush_throughput"]
async fn load_dispatcher_flush_throughput() {
    let cfg = LoadConfig::from_env();
    let pg = start_pg().await;
    let redis = start_redis().await;
    let cipher = test_cipher();
    let (hook_url, count, _hook) = start_counting_webhook().await;
    let tenant = seed_dispatch_tenant(&pg.store, cipher.as_ref(), &hook_url).await;

    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis.url).await.unwrap());
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis.url).await.unwrap());
    let cache = Arc::new(FilterCache::new(pg.store.clone()));
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new(true)));
    let notifiers = Arc::new(reg);
    let rule = RuleId(Uuid::new_v4());

    // Setup (untimed): buffer events into groups.
    buffer_events(
        &pg.store,
        &bus,
        &groups,
        &cache,
        &notifiers,
        &cipher,
        &tenant,
        rule,
        cfg.events,
        cfg.dispatch_workers,
    )
    .await;

    // Measured: flush all due groups with bounded workers calling the real flush_group.
    let flushed = Arc::new(AtomicUsize::new(0));
    let t0 = Instant::now();
    let mut handles = Vec::new();
    for _ in 0..cfg.dispatch_workers {
        let ctx = DispatchCtx {
            store: pg.store.clone(),
            bus: bus.clone(),
            notifiers: notifiers.clone(),
            groups: groups.clone(),
            cache: cache.clone(),
            cipher: cipher.clone(),
            sink: Arc::new(cc::domain::sink::NullSink),
        };
        let (groups, flushed) = (groups.clone(), flushed.clone());
        handles.push(tokio::spawn(async move {
            loop {
                let ids = groups.claim_due(now_ms(), 32).await.unwrap();
                if ids.is_empty() {
                    break;
                }
                for gid in ids {
                    flush_group(&ctx, &gid).await;
                    flushed.fetch_add(1, Ordering::Relaxed);
                }
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }
    let elapsed = t0.elapsed();

    let groups_flushed = flushed.load(Ordering::Relaxed);
    let deliveries = count.load(Ordering::Relaxed);
    assert!(groups_flushed > 0, "at least one group flushed");
    assert!(deliveries > 0, "at least one delivery made");

    report(
        "dispatcher-flush",
        &[
            ("events buffered", cfg.events.to_string()),
            ("groups flushed", groups_flushed.to_string()),
            ("deliveries", deliveries.to_string()),
            ("workers", cfg.dispatch_workers.to_string()),
            ("wall", format!("{:.3}s", elapsed.as_secs_f64())),
            (
                "deliveries/sec",
                format!("{:.0}", per_sec(deliveries, elapsed)),
            ),
            (
                "groups/sec",
                format!("{:.0}", per_sec(groups_flushed, elapsed)),
            ),
        ],
    );
}
