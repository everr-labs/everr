use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use cc::queue::event_bus::RedisEventBus;
use cc::queue::EventBus;
use std::collections::BTreeMap;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
use uuid::Uuid;

fn ev() -> Event {
    Event {
        tenant: TenantId::from_trusted(Uuid::nil().to_string()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: Some(1.0),
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

#[tokio::test]
async fn publish_consume_ack() {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let url = format!("redis://127.0.0.1:{port}");

    let bus = RedisEventBus::connect(&url).await.unwrap();

    bus.publish(&ev()).await.unwrap();
    let got = bus.consume("d1", 10, 1000).await.unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].event, ev());
    bus.ack(&got[0].id).await.unwrap();

    bus.dead_letter(&ev(), "boom").await.unwrap();
}

#[tokio::test]
async fn dispatcher_and_logexport_groups_are_independent() {
    let node = Redis::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(6379).await.unwrap();
    let url = format!("redis://127.0.0.1:{port}");

    let bus = RedisEventBus::connect(&url).await.unwrap();
    bus.publish(&ev()).await.unwrap();

    // Competing consumer groups each get the SAME event independently.
    let disp = bus.consume("d1", 10, 500).await.unwrap();
    let logx = bus.consume_logexport("l1", 10, 500).await.unwrap();
    assert_eq!(disp.len(), 1, "dispatcher group sees the event");
    assert_eq!(
        logx.len(),
        1,
        "logexport group independently sees the SAME event"
    );
    assert_eq!(disp[0].event, ev());
    assert_eq!(logx[0].event, ev());

    bus.ack(&disp[0].id).await.unwrap();
    bus.ack_logexport(&logx[0].id).await.unwrap();

    // After ack each group's pending set is empty: no redelivery via the next group read.
    assert!(bus.consume("d1", 10, 200).await.unwrap().is_empty());
    assert!(bus
        .consume_logexport("l1", 10, 200)
        .await
        .unwrap()
        .is_empty());
}
