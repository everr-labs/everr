use cc::crypto::{EnvKeyring, SecretCipher};
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::notify::WebhookNotifier;
use cc::dispatcher::slack::SlackNotifier;
use cc::dispatcher::{run_dispatcher, run_group_flusher, Notifiers};
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::receiver::ChannelConfig;
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::Severity;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::groups::{GroupStore, RedisGroups};
use cc::queue::EventBus;
use cc::stores::PgStore;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [7u8; 32])]),
            "v1".to_string(),
        )
        .unwrap(),
    )
}

async fn start_stub(hits: Arc<Mutex<usize>>) -> String {
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/hook",
        post(move || {
            let hits = hits.clone();
            async move {
                *hits.lock().unwrap() += 1;
                "ok"
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}/hook")
}

#[tokio::test]
async fn fan_out_to_webhook_and_slack_receivers() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());

    let wh_hits = Arc::new(Mutex::new(0usize));
    let slack_hits = Arc::new(Mutex::new(0usize));
    let wh_url = start_stub(wh_hits.clone()).await;
    let slack_url = start_stub(slack_hits.clone()).await;

    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_channel(
            cipher.as_ref(),
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
            cipher.as_ref(),
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

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    reg.register(Arc::new(SlackNotifier::new()));
    let notifiers = Arc::new(reg);
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());
    let cache = Arc::new(FilterCache::new(store.clone()));

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let disp = {
        let store = store.clone();
        let bus = bus.clone();
        let notifiers = notifiers.clone();
        let groups = groups.clone();
        let cache = cache.clone();
        let cipher = cipher.clone();
        let rx = sd_rx.clone();
        tokio::spawn(async move {
            run_dispatcher(
                "d1".into(),
                store,
                bus,
                notifiers,
                groups,
                cache,
                cipher,
                std::sync::Arc::new(cc::domain::sink::NullSink),
                rx,
            )
            .await;
        })
    };
    let flush = {
        let store = store.clone();
        let bus = bus.clone();
        let notifiers = notifiers.clone();
        let groups = groups.clone();
        let cache = cache.clone();
        let cipher = cipher.clone();
        let rx = sd_rx.clone();
        tokio::spawn(async move {
            run_group_flusher(
                store,
                bus,
                notifiers,
                groups,
                cache,
                cipher,
                std::sync::Arc::new(cc::domain::sink::NullSink),
                rx,
            )
            .await;
        })
    };

    let ev = Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        slo: None,
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::from([("svc".to_string(), "api".to_string())]),
        value: Some(1.0),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    };
    bus.publish(&ev).await.unwrap();

    for _ in 0..50 {
        if *wh_hits.lock().unwrap() >= 1 && *slack_hits.lock().unwrap() >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert_eq!(
        *wh_hits.lock().unwrap(),
        1,
        "webhook receiver delivered once"
    );
    assert_eq!(
        *slack_hits.lock().unwrap(),
        1,
        "slack receiver delivered once"
    );

    let _ = sd_tx.send(true);
    let _ = disp.await;
    let _ = flush.await;
}
