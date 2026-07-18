use cc::dispatcher::notify::{Notification, Notifier, NotifyError};
use cc::dispatcher::telegram::TelegramNotifier;
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

async fn start_server(status: u16, sink: Arc<Mutex<Vec<serde_json::Value>>>) -> String {
    use axum::extract::Json;
    use axum::http::StatusCode;
    use axum::Router;
    let code = StatusCode::from_u16(status).unwrap();
    // The bot token in the URL path (`/bot<token>/sendMessage`) can contain a `:`,
    // which axum 0.7 path params won't match cleanly — accept any path via fallback.
    let app = Router::new().fallback(move |Json(body): Json<serde_json::Value>| {
        let sink = sink.clone();
        async move {
            sink.lock().unwrap().push(body);
            code
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}")
}

fn target(token: &str, chat_ids: &[&str]) -> String {
    serde_json::json!({ "bot_token": token, "chat_ids": chat_ids }).to_string()
}

#[tokio::test]
async fn sends_one_message_per_chat_id() {
    let sink = Arc::new(Mutex::new(Vec::new()));
    let base = start_server(200, sink.clone()).await;
    TelegramNotifier::with_api_base(&base)
        .send(
            &target("123:tok", &["@a", "@b"]),
            &Notification::single(&ev()),
        )
        .await
        .unwrap();
    let bodies = sink.lock().unwrap().clone();
    assert_eq!(bodies.len(), 2, "one sendMessage per chat id");
    assert_eq!(bodies[0]["parse_mode"], "HTML");
    assert!(bodies[0]["text"].as_str().unwrap().contains("FIRING"));
    let chats: Vec<&str> = bodies
        .iter()
        .map(|b| b["chat_id"].as_str().unwrap())
        .collect();
    assert!(chats.contains(&"@a") && chats.contains(&"@b"));
}

#[tokio::test]
async fn four_xx_is_permanent() {
    let sink = Arc::new(Mutex::new(Vec::new()));
    let base = start_server(400, sink).await;
    let err = TelegramNotifier::with_api_base(&base)
        .send(&target("t", &["@a"]), &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}

#[tokio::test]
async fn bad_target_is_permanent() {
    let err = TelegramNotifier::new()
        .send("not-json", &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}
