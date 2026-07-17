use cc::dispatcher::notify::{Notification, Notifier, NotifyError};
use cc::dispatcher::slack::SlackNotifier;
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

fn ev() -> Event {
    Event {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        slo: None,
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

async fn start_server(status: u16, body_sink: Arc<Mutex<Option<serde_json::Value>>>) -> String {
    use axum::extract::Json;
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let code = StatusCode::from_u16(status).unwrap();
    let app = Router::new().route(
        "/hook",
        post(move |Json(body): Json<serde_json::Value>| {
            let sink = body_sink.clone();
            async move {
                *sink.lock().unwrap() = Some(body);
                code
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
async fn slack_posts_payload_and_2xx_ok() {
    let sink = Arc::new(Mutex::new(None));
    let url = start_server(200, sink.clone()).await;
    SlackNotifier::new()
        .send(&url, &Notification::single(&ev()))
        .await
        .unwrap();
    let body = sink.lock().unwrap().clone().expect("server saw a body");
    assert!(body["text"].as_str().unwrap().contains("FIRING"));
}

#[tokio::test]
async fn slack_4xx_is_permanent() {
    let sink = Arc::new(Mutex::new(None));
    let url = start_server(400, sink).await;
    let err = SlackNotifier::new()
        .send(&url, &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}
