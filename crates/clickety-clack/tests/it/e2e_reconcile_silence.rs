use crate::common;
use crate::support::create_test_rule;
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::{RuleSpec, Severity};
use cc::evaluator::maintenance::run_maintenance;
use cc::stores::RedisLease;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use time::{Duration as TimeDuration, OffsetDateTime};
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

fn rule_spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        // interval 30 => staleness threshold max(4*30, 60) = 120s.
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec!["service".into()],
        value_column: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    }
}

/// A firing instance whose last_seen is well past the 120s staleness window, so the
/// reconcile sweep will auto-resolve it and emit a synthetic Resolved event.
fn stale_firing(rule: RuleId, tenant: TenantId, svc: &str, now: OffsetDateTime) -> InstanceState {
    let mut labels = BTreeMap::new();
    labels.insert("service".to_string(), svc.to_string());
    let key = InstanceKey::new(rule, &labels);
    let mut s =
        InstanceState::new_inactive(key, cc::domain::ids::SourceId::Rule(rule), tenant, labels);
    s.status = Status::Firing;
    s.last_seen = Some(now - TimeDuration::seconds(300));
    s.active_since = Some(now - TimeDuration::seconds(300));
    s
}

/// Proves a Resolved event emitted by the reconciliation sweep flows through the
/// dispatcher AND is suppressed by an active silence — exactly like a normally-emitted
/// event. Two stale firing instances are seeded under one rule:
///   - svc=silenced: covered by an active silence → its reconcile Resolved is dropped.
///   - svc=control: not silenced → its reconcile Resolved is delivered.
/// Exactly one webhook delivery is expected: svc=control, status resolved.
#[tokio::test]
async fn reconcile_resolved_respects_silence() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let hook = stub_webhook(captured.clone()).await;

    let ctx = common::dispatch_ctx(&infra);
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    common::create_webhook_delivery(&store, ctx.cipher.as_ref(), tenant.clone(), &hook).await;
    let rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/reconcile_resolved_respects_silence",
        &rule_spec(),
    )
    .await;

    let now = OffsetDateTime::now_utc();

    // Seed BOTH stale firing instances and the silence BEFORE spawning anything, so the
    // FilterCache (2s TTL, per-tenant) loads with the silence already present — avoids
    // the snapshot-misses-silence flake (same lesson as e2e_silences_inhibition).
    store
        .upsert_instance(&stale_firing(rule.id, tenant.clone(), "silenced", now))
        .await
        .unwrap();
    store
        .upsert_instance(&stale_firing(rule.id, tenant.clone(), "control", now))
        .await
        .unwrap();

    store
        .create_silence(
            tenant,
            &[Matcher {
                label: "service".into(),
                op: MatchOp::Eq,
                value: "silenced".into(),
            }],
            now - TimeDuration::hours(1),
            now + TimeDuration::hours(1),
            "test",
            "t",
        )
        .await
        .unwrap();

    let dispatcher = common::spawn_dispatcher(&ctx, true);

    let maint_handle = {
        let lease = RedisLease::connect(&infra.redis.url, "cc:maintenance:lease", "m1", 10_000)
            .await
            .unwrap();
        let (store, bus, rx) = (store.clone(), infra.bus.clone(), dispatcher.shutdown_rx());
        tokio::spawn(async move {
            run_maintenance(
                store,
                bus,
                lease,
                Duration::from_millis(200),
                30,
                cc::otel::EngineMetrics::disabled(),
                rx,
            )
            .await;
        })
    };

    // Wait up to ~20s for the (single) expected delivery to land.
    for _ in 0..200 {
        if !captured.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // Give a wrongly-delivered second (silenced) event time to also arrive.
    tokio::time::sleep(Duration::from_secs(1)).await;

    {
        let got = captured.lock().unwrap();
        assert_eq!(
            got.len(),
            1,
            "exactly one reconcile Resolved delivered (silenced one suppressed); got {got:?}"
        );
        assert_eq!(got[0]["events"][0]["status"], "resolved");
        assert_eq!(got[0]["events"][0]["labels"]["service"], "control");
    }

    dispatcher.shutdown().await;
    let _ = maint_handle.await;
}
