use cc::dispatcher::email::EmailNotifier;
use cc::dispatcher::notify::{Notification, Notifier};
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use cc::domain::ids::InstanceKey;
use std::time::Duration;
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::GenericImage;

fn ev() -> Event {
    let mut e = crate::common::base_event();
    e.instance_key = InstanceKey("svc=api".into());
    e
}

#[tokio::test]
async fn email_is_delivered_to_mailpit() {
    let container = GenericImage::new("axllent/mailpit", "v1.20.4")
        .with_exposed_port(1025u16.tcp())
        .with_exposed_port(8025u16.tcp())
        .with_wait_for(WaitFor::message_on_stdout("accessible via"))
        .start()
        .await
        .unwrap();
    let smtp_port = container.get_host_port_ipv4(1025).await.unwrap();
    let http_port = container.get_host_port_ipv4(8025).await.unwrap();

    let notifier =
        EmailNotifier::new("127.0.0.1", smtp_port, "alerts@x.test", None, None, "none").unwrap();
    notifier
        .send(
            &ChannelConfig::Email {
                to: vec!["oncall@x.test".into()],
            },
            &Notification::single(&ev()),
        )
        .await
        .unwrap();

    let api = format!("http://127.0.0.1:{http_port}/api/v1/messages");
    let client = reqwest::Client::new();
    let mut total = 0u64;
    for _ in 0..50 {
        if let Ok(resp) = client.get(&api).send().await {
            if let Ok(v) = resp.json::<serde_json::Value>().await {
                total = v["total"].as_u64().unwrap_or(0);
                if total >= 1 {
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(total, 1, "Mailpit should have received exactly one message");
}
