use crate::common;
use cc::domain::event::Event;
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::routing::{MatchOp, Matcher};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

type Captured = Arc<Mutex<Vec<serde_json::Value>>>;

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
    let mut e = common::base_event();
    e.tenant = tenant;
    e.rule = rule;
    e.instance_key = InstanceKey(inst.into());
    e.labels = BTreeMap::from([("svc".to_string(), svc.to_string())]);
    e.value = Some(1.0);
    e.severity = cc::domain::rule::Severity::Critical;
    e
}

#[tokio::test]
async fn two_events_batch_into_one_grouped_delivery() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let ctx = common::dispatch_ctx(&infra);
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let rule = RuleId(Uuid::new_v4());
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "ops-hook",
            &cc::domain::channel::ChannelConfig::Webhook { url: hook.clone() },
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

    let dispatcher = common::spawn_dispatcher(&ctx, true);

    // Two distinct instances, same group_by value (severity=critical) -> one group.
    infra
        .bus
        .publish(&ev(tenant.clone(), rule, "svc=api", "api"))
        .await
        .unwrap();
    infra
        .bus
        .publish(&ev(tenant, rule, "svc=web", "web"))
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

    dispatcher.shutdown().await;
}
