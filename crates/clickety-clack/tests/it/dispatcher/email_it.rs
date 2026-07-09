use cc::dispatcher::email::EmailNotifier;
use cc::dispatcher::notify::{Notification, Notifier};
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use std::collections::BTreeMap;
use std::time::Duration;
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::GenericImage;
use time::OffsetDateTime;
use uuid::Uuid;

fn ev() -> Event {
    Event {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("svc=api".into()),
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

    let notifier = EmailNotifier::new("127.0.0.1", smtp_port, "alerts@x.test", None, None);
    notifier
        .send("oncall@x.test", &Notification::single(&ev()))
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
