use cc::dispatcher::notify::{Notification, Notifier};
use cc::dispatcher::pagerduty::PagerDutyNotifier;
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
    };
    n.send("routing-key-123", &Notification::single(&ev))
        .await
        .unwrap();
    let body = sink.lock().unwrap().clone().expect("server saw a body");
    assert_eq!(body["routing_key"], "routing-key-123");
    assert_eq!(body["event_action"], "trigger");
    assert_eq!(body["dedup_key"], "svc=api");
}
