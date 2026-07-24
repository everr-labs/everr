use cc::dispatcher::notify::{Notification, Notifier};
use cc::dispatcher::pagerduty::PagerDutyNotifier;
use cc::domain::channel::ChannelConfig;
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

async fn start_server(body_sink: Arc<Mutex<Option<serde_json::Value>>>) -> String {
    use axum::extract::Json;
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/enqueue",
        post(move |Json(body): Json<serde_json::Value>| {
            let sink = body_sink.clone();
            async move {
                *sink.lock().unwrap() = Some(body);
                StatusCode::ACCEPTED // PD returns 202
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}/enqueue")
}

#[tokio::test]
async fn pagerduty_posts_trigger_and_accepts_202() {
    let sink = Arc::new(Mutex::new(None));
    let url = start_server(sink.clone()).await;
    let n = PagerDutyNotifier::with_base_url(&url);
    let ev = Event {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        slo: None,
        name: String::new(),
        instance_key: InstanceKey("svc=api".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
        traceparent: None,
    };
    n.send(
        &ChannelConfig::Pagerduty {
            routing_key: "routing-key-123".into(),
        },
        &Notification::single(&ev),
    )
    .await
    .unwrap();
    let body = sink.lock().unwrap().clone().expect("server saw a body");
    assert_eq!(body["routing_key"], "routing-key-123");
    assert_eq!(body["event_action"], "trigger");
    assert_eq!(body["dedup_key"], "svc=api");
}

/// One rejected event must not strand the rest of the batch: the group-level ledger
/// row means an aborted batch is dedup-skipped on reflush, so every event has to get
/// its Events-API attempt within this send, with errors aggregated afterwards.
#[tokio::test]
async fn batch_attempts_every_event_despite_permanent_failure() {
    use axum::extract::Json;
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let seen_srv = seen.clone();
    let app = Router::new().route(
        "/enqueue",
        post(move |Json(body): Json<serde_json::Value>| {
            let seen = seen_srv.clone();
            async move {
                let key = body["dedup_key"].as_str().unwrap_or_default().to_string();
                let bad = key == "svc=bad";
                seen.lock().unwrap().push(key);
                if bad {
                    StatusCode::BAD_REQUEST // permanent: no retry will follow
                } else {
                    StatusCode::ACCEPTED
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    let n = PagerDutyNotifier::with_base_url(&format!("http://{addr}/enqueue"));

    let ev = |inst: &str| Event {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        slo: None,
        name: String::new(),
        instance_key: InstanceKey(inst.into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
        traceparent: None,
    };
    let err = n
        .send(
            &ChannelConfig::Pagerduty {
                routing_key: "rk".into(),
            },
            &Notification {
                group_key: "g".into(),
                events: vec![ev("svc=a"), ev("svc=bad"), ev("svc=c")],
            },
        )
        .await
        .expect_err("the rejected event surfaces as a batch error");
    assert!(
        err.to_string().contains("1/3 events failed"),
        "aggregated error names the failure count: {err}"
    );

    let mut keys = seen.lock().unwrap().clone();
    keys.sort();
    assert_eq!(
        keys,
        vec!["svc=a", "svc=bad", "svc=c"],
        "every event of the batch got its send attempt"
    );
}
