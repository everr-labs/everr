//! Drives `run_events_consumer` with a fake EventBus and the REAL `AlertLogExporter`
//! pointed at a mock OTLP receiver. Proves: transitions are buffered per tenant into one
//! `ResourceLogs` each, exported as protobuf to the trusted path, and the entries are
//! acked only after a successful export (at-least-once).

use async_trait::async_trait;
use cc::domain::event::{Event, EventKind, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use cc::events::run_events_consumer;
use cc::otel::exporter::AlertLogExporter;
use cc::queue::{EventBus, EventEntry, EventId, QueueError};
use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use opentelemetry_proto::tonic::common::v1::any_value::Value as AnyVal;
use prost::Message;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

fn ev(tenant: &str) -> Event {
    Event {
        tenant: TenantId::from_trusted(tenant.to_string()),
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        kind: EventKind::Alert,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: time::OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

/// A fake bus that yields a fixed batch once, then empties, and records acks.
struct FakeBus {
    batch: Mutex<Vec<EventEntry>>,
    acked: Mutex<Vec<String>>,
}

#[async_trait]
impl EventBus for FakeBus {
    async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
        Ok(())
    }
    async fn consume(
        &self,
        _consumer: &str,
        _count: usize,
        _block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        Ok(Vec::new())
    }
    async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
        Ok(())
    }
    async fn consume_logexport(
        &self,
        _consumer: &str,
        _count: usize,
        _block_ms: usize,
    ) -> Result<Vec<EventEntry>, QueueError> {
        // Hand out the batch exactly once; subsequent reads are empty.
        Ok(std::mem::take(&mut *self.batch.lock().unwrap()))
    }
    async fn ack_logexport(&self, id: &EventId) -> Result<(), QueueError> {
        self.acked.lock().unwrap().push(id.to_string());
        Ok(())
    }
    async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
        Ok(())
    }
}

async fn start_otlp_sink(sink: Arc<Mutex<Vec<ExportLogsServiceRequest>>>) -> String {
    use axum::body::Bytes;
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/v1/logs",
        post(move |headers: HeaderMap, body: Bytes| {
            let sink = sink.clone();
            async move {
                // Trusted path: Bearer auth + protobuf content type.
                assert_eq!(
                    headers.get("content-type").unwrap(),
                    "application/x-protobuf"
                );
                assert_eq!(
                    headers.get("authorization").unwrap().to_str().unwrap(),
                    "Bearer s3cr3t"
                );
                let decoded = ExportLogsServiceRequest::decode(body).unwrap();
                sink.lock().unwrap().push(decoded);
                StatusCode::OK
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}/v1/logs")
}

#[tokio::test]
async fn consumer_buffers_per_tenant_exports_then_acks() {
    let sink = Arc::new(Mutex::new(Vec::new()));
    let endpoint = start_otlp_sink(sink.clone()).await;
    let exporter = Arc::new(AlertLogExporter::new(&endpoint, "s3cr3t"));

    // Two events for tenant t-a, one for t-b => 2 ResourceLogs, 3 records total.
    let batch = vec![
        EventEntry {
            id: EventId::from_raw("0-1"),
            event: ev("t-a"),
        },
        EventEntry {
            id: EventId::from_raw("0-2"),
            event: ev("t-b"),
        },
        EventEntry {
            id: EventId::from_raw("0-3"),
            event: ev("t-a"),
        },
    ];
    let bus = Arc::new(FakeBus {
        batch: Mutex::new(batch),
        acked: Mutex::new(Vec::new()),
    });

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let bus: Arc<dyn EventBus> = bus.clone();
        tokio::spawn(async move {
            run_events_consumer("c1".to_string(), bus, exporter, sd_rx).await;
        })
    };

    // Wait until the export landed, then signal shutdown.
    for _ in 0..50 {
        if !sink.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let _ = sd_tx.send(true);
    let _ = handle.await;

    let reqs = sink.lock().unwrap();
    assert_eq!(reqs.len(), 1, "exactly one export request");
    let req = &reqs[0];
    assert_eq!(req.resource_logs.len(), 2, "one ResourceLogs per tenant");
    let total: usize = req
        .resource_logs
        .iter()
        .map(|r| r.scope_logs[0].log_records.len())
        .sum();
    assert_eq!(total, 3, "all three records exported");

    // Each ResourceLogs is tagged with its customer tenant.
    let mut tenants: Vec<String> = req
        .resource_logs
        .iter()
        .map(|rl| {
            let a = rl
                .resource
                .as_ref()
                .unwrap()
                .attributes
                .iter()
                .find(|a| a.key == "everr.tenant.id")
                .unwrap();
            match a.value.as_ref().unwrap().value.as_ref().unwrap() {
                AnyVal::StringValue(s) => s.clone(),
                _ => panic!("tenant attr not a string"),
            }
        })
        .collect();
    tenants.sort();
    assert_eq!(tenants, vec!["t-a".to_string(), "t-b".to_string()]);

    // All three entries acked after the successful export.
    let mut acked = bus.acked.lock().unwrap().clone();
    acked.sort();
    assert_eq!(acked, vec!["0-1", "0-2", "0-3"]);
}

#[tokio::test]
async fn failed_export_does_not_ack() {
    // Exporter points at a dead endpoint -> export errors -> entries stay unacked.
    let exporter = Arc::new(AlertLogExporter::new(
        "http://127.0.0.1:1/v1/logs",
        "s3cr3t",
    ));
    let bus = Arc::new(FakeBus {
        batch: Mutex::new(vec![EventEntry {
            id: EventId::from_raw("0-1"),
            event: ev("t-a"),
        }]),
        acked: Mutex::new(Vec::new()),
    });

    let (sd_tx, sd_rx) = tokio::sync::watch::channel(false);
    let handle = {
        let bus: Arc<dyn EventBus> = bus.clone();
        tokio::spawn(async move {
            run_events_consumer("c1".to_string(), bus, exporter, sd_rx).await;
        })
    };
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let _ = sd_tx.send(true);
    let _ = handle.await;

    assert!(
        bus.acked.lock().unwrap().is_empty(),
        "no acks when export fails (at-least-once: leave pending for redelivery)"
    );
}
