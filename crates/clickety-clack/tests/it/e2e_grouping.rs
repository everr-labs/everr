use cc::crypto::{EnvKeyring, SecretCipher};
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::notify::WebhookNotifier;
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

type Captured = Arc<Mutex<Vec<serde_json::Value>>>;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [7u8; 32])]),
            "v1".to_string(),
        )
        .unwrap(),
    )
}

async fn stub_webhook(captured: Captured) -> String {
    use axum::routing::post;
    use axum::{Json, Router};
    let app = Router::new().route(
        "/hook",
        post(move |Json(body): Json<serde_json::Value>| {
            let captured = captured.clone();
            async move {
                captured.lock().unwrap().push(body);
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

fn ev(tenant: TenantId, rule: RuleId, inst: &str, svc: &str) -> Event {
    Event {
        tenant,
        rule,
        slo: None,
        instance_key: InstanceKey(inst.into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::from([("svc".to_string(), svc.to_string())]),
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
async fn two_events_batch_into_one_grouped_delivery() {
    let pg_url = crate::support::fresh_db().await;
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );

    let store = PgStore::connect(&pg_url).await.unwrap();
    let bus: Arc<dyn EventBus> = Arc::new(RedisEventBus::connect(&redis_url).await.unwrap());
    let groups: Arc<dyn GroupStore> = Arc::new(RedisGroups::connect(&redis_url).await.unwrap());

    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = RuleId(Uuid::new_v4());
    store
        .create_channel(
            cipher.as_ref(),
            tenant.clone(),
            "ops-hook",
            &ChannelConfig::Webhook { url: hook.clone() },
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
    // Group all critical alerts together; hold 1s to batch the burst.
    let group_by = vec!["severity".to_string()];
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
            Some(group_by.as_slice()),
            Some(1),
            None,
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let mut reg = Notifiers::new();
    reg.register(Arc::new(WebhookNotifier::new()));
    let notifiers = Arc::new(reg);
    let cache = Arc::new(FilterCache::new(store.clone()));

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let disp = {
        let (store, bus, groups, notifiers, cache, cipher, rx) = (
            store.clone(),
            bus.clone(),
            groups.clone(),
            notifiers.clone(),
            cache.clone(),
            cipher.clone(),
            sd_rx.clone(),
        );
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
        let (store, bus, groups, notifiers, cache, cipher, rx) = (
            store.clone(),
            bus.clone(),
            groups.clone(),
            notifiers.clone(),
            cache.clone(),
            cipher.clone(),
            sd_rx.clone(),
        );
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

    // Two distinct instances, same group_by value (severity=critical) -> one group.
    bus.publish(&ev(tenant.clone(), rule, "svc=api", "api"))
        .await
        .unwrap();
    bus.publish(&ev(tenant, rule, "svc=web", "web"))
        .await
        .unwrap();

    // Wait past group_wait (1s) for the flush.
    for _ in 0..60 {
        if !captured.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // Allow a moment to ensure no second delivery sneaks in.
    tokio::time::sleep(Duration::from_millis(500)).await;

    {
        let got = captured.lock().unwrap();
        assert_eq!(
            got.len(),
            1,
            "the burst is delivered as exactly one grouped notification"
        );
        let events = got[0]["events"].as_array().unwrap();
        assert_eq!(events.len(), 2, "both instances in one batch");
        let mut svcs: Vec<String> = events
            .iter()
            .map(|e| e["labels"]["svc"].as_str().unwrap().to_string())
            .collect();
        svcs.sort();
        assert_eq!(svcs, vec!["api".to_string(), "web".to_string()]);
    }

    let _ = sd_tx.send(true);
    let _ = disp.await;
    let _ = flush.await;
}
