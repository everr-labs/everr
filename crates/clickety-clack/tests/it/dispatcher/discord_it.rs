use cc::dispatcher::discord::DiscordNotifier;
use cc::dispatcher::notify::{Notification, Notifier, NotifyError};
use cc::domain::channel::ChannelConfig;
use std::sync::{Arc, Mutex};

async fn send_with_status(status: u16) -> Result<(), NotifyError> {
    let url = crate::common::start_json_capture_server(status, Arc::new(Mutex::new(None))).await;
    DiscordNotifier::new(true)
        .send(
            &ChannelConfig::Discord { url },
            &Notification::single(&crate::common::base_event()),
        )
        .await
}

#[tokio::test]
async fn discord_posts_payload_and_2xx_ok() {
    let sink = Arc::new(Mutex::new(None));
    // Discord answers 204 on successful webhook delivery.
    let url = crate::common::start_json_capture_server(204, sink.clone()).await;
    DiscordNotifier::new(true)
        .send(
            &ChannelConfig::Discord { url },
            &Notification::single(&crate::common::base_event()),
        )
        .await
        .unwrap();
    let body = sink.lock().unwrap().clone().expect("server saw a body");
    assert!(body["content"].is_string());
    assert!(body["embeds"].is_array());
}

#[tokio::test]
async fn discord_4xx_is_permanent() {
    let err = send_with_status(400).await.unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}

#[tokio::test]
async fn discord_429_is_transient() {
    let err = send_with_status(429).await.unwrap_err();
    assert!(matches!(err, NotifyError::Transient(_)));
}
