use crate::common;
use cc::dispatcher::notify::{Notification, Notifier, NotifyError, WebhookNotifier};
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use std::sync::{Arc, Mutex};

fn ev() -> Event {
    common::base_event()
}

fn config(url: &str) -> ChannelConfig {
    ChannelConfig::Webhook { url: url.into() }
}

async fn start_server(status: u16, captured: Arc<Mutex<usize>>) -> String {
    use axum::http::StatusCode;
    use axum::routing::post;
    use axum::Router;
    let code = StatusCode::from_u16(status).unwrap();
    let app = Router::new().route(
        "/hook",
        post(move || {
            let captured = captured.clone();
            async move {
                *captured.lock().unwrap() += 1;
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

async fn start_redirect_server(target_hits: Arc<Mutex<usize>>) -> String {
    use axum::response::Redirect;
    use axum::routing::post;
    use axum::Router;
    let app = Router::new()
        .route("/hook", post(|| async { Redirect::temporary("/target") }))
        .route(
            "/target",
            post(move || {
                let target_hits = target_hits.clone();
                async move {
                    *target_hits.lock().unwrap() += 1;
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
async fn webhook_2xx_is_ok() {
    let hits = Arc::new(Mutex::new(0));
    let url = start_server(200, hits.clone()).await;
    let n = WebhookNotifier::new(true);
    n.send(&config(&url), &Notification::single(&ev()))
        .await
        .unwrap();
    assert_eq!(*hits.lock().unwrap(), 1);
}

#[tokio::test]
async fn webhook_4xx_is_permanent() {
    let hits = Arc::new(Mutex::new(0));
    let url = start_server(404, hits.clone()).await;
    let n = WebhookNotifier::new(true);
    let err = n
        .send(&config(&url), &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}

#[tokio::test]
async fn webhook_5xx_is_transient() {
    let hits = Arc::new(Mutex::new(0));
    let url = start_server(503, hits.clone()).await;
    let n = WebhookNotifier::new(true);
    let err = n
        .send(&config(&url), &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Transient(_)));
}

#[tokio::test]
async fn webhook_transport_error_does_not_leak_secret_url() {
    // Port 1 is unroutable, so .send() fails at the transport layer. The reqwest
    // error must not carry the secret URL into the error string, which is persisted
    // to notifications.last_error and the dead-letter stream.
    let url = "http://127.0.0.1:1/SECRET-TOKEN-XYZ";
    let n = WebhookNotifier::new(true);
    let err = n
        .send(&config(url), &Notification::single(&ev()))
        .await
        .unwrap_err();
    let NotifyError::Transient(msg) = err else {
        panic!("expected transient transport error, got {err:?}");
    };
    assert!(
        !msg.contains("SECRET-TOKEN-XYZ"),
        "secret URL leaked into error string: {msg}"
    );
}

#[tokio::test]
async fn webhook_revalidates_private_targets_at_dispatch() {
    let hits = Arc::new(Mutex::new(0));
    let url = start_server(200, hits.clone()).await;
    let err = WebhookNotifier::default()
        .send(&config(&url), &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
    assert_eq!(*hits.lock().unwrap(), 0);
}

#[tokio::test]
async fn webhook_does_not_follow_redirects() {
    let target_hits = Arc::new(Mutex::new(0));
    let url = start_redirect_server(target_hits.clone()).await;
    let err = WebhookNotifier::new(true)
        .send(&config(&url), &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Transient(_)));
    assert_eq!(*target_hits.lock().unwrap(), 0);
}
