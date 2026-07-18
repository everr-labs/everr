use cc::dispatcher::notify::{Notification, Notifier, NotifyError};
use cc::dispatcher::slack::SlackNotifier;
use cc::domain::event::Event;
use std::sync::{Arc, Mutex};

fn ev() -> Event {
    crate::common::base_event()
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
