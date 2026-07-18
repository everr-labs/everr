use crate::common;
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::Severity;
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
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
