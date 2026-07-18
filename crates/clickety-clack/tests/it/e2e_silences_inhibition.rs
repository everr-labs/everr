use crate::common;
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::{flush_group, process_event, DispatchCtx};
use cc::domain::channel::ChannelConfig;
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::Event;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use time::OffsetDateTime;
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

fn ev(tenant: TenantId, rule: RuleId, inst: &str, sev: Severity, labels: &[(&str, &str)]) -> Event {
    let mut e = common::base_event();
    e.tenant = tenant;
    e.rule = rule;
    e.instance_key = InstanceKey(inst.into());
    e.labels = labels
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    e.value = Some(1.0);
    e.severity = sev;
    e
}

async fn wait_for<F: Fn() -> bool>(pred: F) {
    for _ in 0..100 {
        if pred() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
async fn silence_and_inhibition_suppress_delivery() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let ctx = common::dispatch_ctx(&infra);
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    // No routes → firehose path → one webhook per delivered event.
    store
        .create_subscription(ctx.cipher.as_ref(), tenant.clone(), &hook)
        .await
        .unwrap();

    // silence: drop events with svc=api
    let now = OffsetDateTime::now_utc();
    store
        .create_silence(
            tenant.clone(),
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

    // inhibition source: a firing critical alert with svc=db
    let spec = RuleSpec {
        sql: "SELECT 1 AS n".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec![],
        value_column: Some("n".into()),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    };
    let src_rule = store.create_rule(tenant.clone(), &spec).await.unwrap();
    let mut src_labels = BTreeMap::new();
    src_labels.insert("svc".to_string(), "db".to_string());
    let src_key = InstanceKey::new(src_rule.id, &src_labels);
    let mut firing =
        InstanceState::new_inactive(src_key.clone(), src_rule.id, tenant.clone(), src_labels);
    firing.status = Status::Firing;
    firing.active_since = Some(now);
    store.upsert_instance(&firing).await.unwrap();

    // Inhibition rule (created BEFORE the dispatcher starts so the first per-tenant
    // snapshot already contains it; otherwise a 2s TTL snapshot taken on the first event
    // could miss a later-created rule and the test would flake).
    store
        .create_inhibition(
            tenant.clone(),
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "warning".into(),
            }],
            &["svc".to_string()],
        )
        .await
        .unwrap();

    let dispatcher = common::spawn_dispatcher(&ctx, false);

    // 1. Silenced (svc=api) → dropped.
    infra
        .bus
        .publish(&ev(
            tenant.clone(),
            RuleId(Uuid::new_v4()),
            "i-silenced",
            Severity::Warning,
            &[("svc", "api")],
        ))
        .await
        .unwrap();
    // 2. Inhibited (warning, svc=db; a critical svc=db is firing) → dropped.
    infra
        .bus
        .publish(&ev(
            tenant.clone(),
            RuleId(Uuid::new_v4()),
            "i-inhibited",
            Severity::Warning,
            &[("svc", "db")],
        ))
        .await
        .unwrap();
    // 3. Control (svc=web) → delivered.
    infra
        .bus
        .publish(&ev(
            tenant,
            RuleId(Uuid::new_v4()),
            "i-control",
            Severity::Warning,
            &[("svc", "web")],
        ))
        .await
        .unwrap();

    {
        let captured = captured.clone();
        wait_for(move || {
            captured
                .lock()
                .unwrap()
                .iter()
                .any(|d| d["events"][0]["labels"]["svc"] == "web")
        })
        .await;
    }
    // Give any (erroneously) un-suppressed event time to also arrive.
    tokio::time::sleep(Duration::from_millis(300)).await;

    {
        let got = captured.lock().unwrap();
        assert_eq!(got.len(), 1, "only the control event is delivered");
        assert_eq!(got[0]["events"][0]["labels"]["svc"], "web");
    }

    dispatcher.shutdown().await;
}

/// Prove that a silence created AFTER an event is buffered into a group is still
/// honored when `flush_group` runs, because the cache is reloaded at flush time.
#[tokio::test]
async fn flush_time_silence_suppresses_buffered_event() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    // Step 1 — Buffer the event while NO silence is active.
    // Use a zero-TTL cache so the ingest snapshot has no silences.
    let ingest_ctx = DispatchCtx {
        cache: Arc::new(FilterCache::with_ttl(store.clone(), Duration::ZERO)),
        ..common::dispatch_ctx(&infra)
    };

    // Create a channel + receiver and a grouping route so events are buffered (not
    // immediately delivered via the firehose path). group_wait_secs=0 so the group is
    // due immediately.
    store
        .create_channel(
            ingest_ctx.cipher.as_ref(),
            tenant.clone(),
            "test-hook",
            &ChannelConfig::Webhook { url: hook.clone() },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            tenant.clone(),
            "test-recv",
            &["test-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap();
    store
        .create_route(
            tenant.clone(),
            &[], // match-all
            "test-recv",
            false,
            0,
            Some(&["svc".to_string()]),
            Some(0), // group_wait_secs = 0 → due immediately
            Some(300),
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let event = ev(
        tenant.clone(),
        RuleId(Uuid::new_v4()),
        "i-buffered",
        Severity::Warning,
        &[("svc", "api")],
    );

    // Publish and consume so we can call process_event directly.
    infra.bus.publish(&event).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1, "should consume the published event");
    let entry = &entries[0];

    let acked = process_event(&ingest_ctx, entry).await;
    assert!(acked, "process_event should ack (route matched)");
    infra.bus.ack(&entry.id).await.unwrap();

    // Verify nothing was delivered yet (event is buffered, not flushed).
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        captured.lock().unwrap().is_empty(),
        "no delivery expected before flush"
    );

    // Step 2 — Create a silence covering svc=api, starting in the past.
    let now = OffsetDateTime::now_utc();
    store
        .create_silence(
            tenant.clone(),
            &[Matcher {
                label: "svc".into(),
                op: MatchOp::Eq,
                value: "api".into(),
            }],
            now - time::Duration::seconds(5),
            now + time::Duration::hours(1),
            "flush-time-test",
            "ops",
        )
        .await
        .unwrap();

    // Step 3 — Use a zero-TTL cache so flush_group reloads and sees the silence.
    let flush_cache = Arc::new(FilterCache::with_ttl(store.clone(), Duration::ZERO));

    // Step 4 — Claim the due group and flush it.
    let now_ms = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64;
    let gids = infra.groups.claim_due(now_ms, 32).await.unwrap();
    assert!(!gids.is_empty(), "at least one group should be due");

    let flush_ctx = DispatchCtx {
        cache: flush_cache.clone(),
        ..ingest_ctx.clone()
    };
    for gid in &gids {
        flush_group(&flush_ctx, gid).await;
    }

    // Step 5 — Assert NO notification was delivered.
    // Give a short window in case a delivery was incorrectly attempted.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let got = captured.lock().unwrap();
    assert!(
        got.is_empty(),
        "flush_group must suppress the buffered event because a silence was created after buffering; got {got:?}"
    );
}
