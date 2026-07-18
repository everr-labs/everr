use crate::common;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::slack::SlackNotifier;
use cc::dispatcher::{DispatchCtx, Notifiers};
use cc::domain::channel::ChannelConfig;
use cc::domain::ids::{InstanceKey, TenantId};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::Severity;
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

#[tokio::test]
async fn fan_out_to_webhook_and_slack_receivers() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (wh_url, wh_hits, _wh_task) = common::start_counting_webhook().await;
    let (slack_url, slack_hits, _slack_task) = common::start_counting_webhook().await;

    // Register both notifier kinds the two receivers fan out to.
    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    reg.register(Arc::new(SlackNotifier::new()));
    let ctx = DispatchCtx {
        notifiers: Arc::new(reg),
        ..common::dispatch_ctx(&infra)
    };

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "ops-hook",
            &ChannelConfig::Webhook {
                url: wh_url.clone(),
            },
        )
        .await
        .unwrap();
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "chat-slack",
            &ChannelConfig::Slack {
                url: slack_url.clone(),
            },
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
        .create_receiver(
            tenant.clone(),
            "chat",
            &["chat-slack".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap();
    // Two routes both matching severity=critical; first has continue=true so both fire.
    store
        .create_route(
            tenant.clone(),
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            "ops",
            true,
            0,
            None,
            Some(0),
            None,
            None, // repeat_interval_secs
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
            "chat",
            false,
            1,
            None,
            Some(0),
            None,
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let dispatcher = common::spawn_dispatcher(&ctx, true);

    let mut ev = common::base_event();
    ev.tenant = tenant;
    ev.instance_key = InstanceKey("svc=api".into());
    ev.labels = BTreeMap::from([("svc".to_string(), "api".to_string())]);
    ev.value = Some(1.0);
    ev.severity = Severity::Critical;
    infra.bus.publish(&ev).await.unwrap();

    for _ in 0..50 {
        if wh_hits.load(Ordering::Relaxed) >= 1 && slack_hits.load(Ordering::Relaxed) >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(
        wh_hits.load(Ordering::Relaxed),
        1,
        "webhook receiver delivered once"
    );
    assert_eq!(
        slack_hits.load(Ordering::Relaxed),
        1,
        "slack receiver delivered once"
    );

    dispatcher.shutdown().await;
}
