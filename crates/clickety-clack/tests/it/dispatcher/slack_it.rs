use cc::dispatcher::notify::{Notification, Notifier, NotifyError};
use cc::dispatcher::slack::SlackNotifier;
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use std::sync::{Arc, Mutex};

fn ev() -> Event {
    crate::common::base_event()
}

#[tokio::test]
async fn slack_posts_payload_and_2xx_ok() {
    let sink = Arc::new(Mutex::new(None));
    let url = crate::common::start_json_capture_server(200, sink.clone()).await;
    SlackNotifier::new(true)
        .send(&ChannelConfig::Slack { url }, &Notification::single(&ev()))
        .await
        .unwrap();
    sink.lock().unwrap().clone().expect("server saw a body");
}

#[tokio::test]
async fn slack_4xx_is_permanent() {
    let sink = Arc::new(Mutex::new(None));
    let url = crate::common::start_json_capture_server(400, sink).await;
    let err = SlackNotifier::new(true)
        .send(&ChannelConfig::Slack { url }, &Notification::single(&ev()))
        .await
        .unwrap_err();
    assert!(matches!(err, NotifyError::Permanent(_)));
}
