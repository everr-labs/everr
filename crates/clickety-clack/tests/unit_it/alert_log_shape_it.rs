use cc::domain::event::{Event, EventKind, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use cc::otel::alert_log::{build_log_record, AlertEventType, LogExtras};
use cc::otel::exporter::{build_export_request, AlertLogExporter, BufferedLog};
use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use prost::Message;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

fn ev(tenant: &str, slug: &str) -> Event {
    Event {
        tenant: TenantId::from_trusted(tenant.to_string()),
        rule: RuleId(Uuid::nil()),
        slo: None,
        name: slug.to_string(),
        instance_key: InstanceKey("fp".into()),
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
        traceparent: None,
    }
}

#[test]
fn one_resource_logs_per_tenant() {
    let buffered = vec![
        BufferedLog {
            tenant: "t-a".into(),
            record: build_log_record(
                &ev("t-a", "a"),
                AlertEventType::InstanceFired,
                &LogExtras::default(),
                0,
            ),
        },
        BufferedLog {
            tenant: "t-b".into(),
            record: build_log_record(
                &ev("t-b", "b"),
                AlertEventType::InstanceFired,
                &LogExtras::default(),
                0,
            ),
        },
        BufferedLog {
            tenant: "t-a".into(),
            record: build_log_record(
                &ev("t-a", "a"),
                AlertEventType::InstanceResolved,
                &LogExtras::default(),
                0,
            ),
        },
    ];
    let req = build_export_request(&buffered);
    assert_eq!(req.resource_logs.len(), 2, "grouped into 2 tenants");
    // Each ResourceLogs carries everr.tenant.id + service.name=alert; scope everr.alerting.
    for rl in &req.resource_logs {
        let res = rl.resource.as_ref().unwrap();
        let tenant_attr = res
            .attributes
            .iter()
            .find(|a| a.key == "everr.tenant.id")
            .unwrap();
        let svc = res
            .attributes
            .iter()
            .find(|a| a.key == "service.name")
            .unwrap();
        assert!(matches!(
            svc.value.as_ref().unwrap().value.as_ref().unwrap(),
            opentelemetry_proto::tonic::common::v1::any_value::Value::StringValue(s) if s == "alert"
        ));
        // tenant attr must be one of the two distinct tenants.
        match tenant_attr.value.as_ref().unwrap().value.as_ref().unwrap() {
            opentelemetry_proto::tonic::common::v1::any_value::Value::StringValue(s) => {
                assert!(s == "t-a" || s == "t-b")
            }
            _ => panic!(),
        }
        assert_eq!(
            rl.scope_logs[0].scope.as_ref().unwrap().name,
            "everr.alerting"
        );
    }
    // tenant t-a has 2 records, t-b has 1; total 3.
    let total: usize = req
        .resource_logs
        .iter()
        .map(|r| r.scope_logs[0].log_records.len())
        .sum();
    assert_eq!(total, 3);
    // Stable order (BTreeMap): t-a before t-b, and t-a holds both its records.
    let first = &req.resource_logs[0];
    let first_tenant = match first
        .resource
        .as_ref()
        .unwrap()
        .attributes
        .iter()
        .find(|a| a.key == "everr.tenant.id")
        .unwrap()
        .value
        .as_ref()
        .unwrap()
        .value
        .as_ref()
        .unwrap()
    {
        opentelemetry_proto::tonic::common::v1::any_value::Value::StringValue(s) => s.clone(),
        _ => panic!(),
    };
    assert_eq!(first_tenant, "t-a");
    assert_eq!(first.scope_logs[0].log_records.len(), 2);
}

struct Captured {
    body: ExportLogsServiceRequest,
    authorization: Option<String>,
    content_type: Option<String>,
}

async fn start_otlp_sink(sink: Arc<Mutex<Option<Captured>>>) -> String {
    use axum::body::Bytes;
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::post;
    use axum::Router;
    let app = Router::new().route(
        "/v1/logs",
        post(move |headers: HeaderMap, body: Bytes| {
            let sink = sink.clone();
            async move {
                let decoded = ExportLogsServiceRequest::decode(body).unwrap();
                let authorization = headers
                    .get("authorization")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let content_type = headers
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                *sink.lock().unwrap() = Some(Captured {
                    body: decoded,
                    authorization,
                    content_type,
                });
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
async fn export_posts_protobuf_to_trusted_path() {
    let sink = Arc::new(Mutex::new(None));
    let endpoint = start_otlp_sink(sink.clone()).await;
    let exporter = AlertLogExporter::new(&endpoint, "secret");
    let buffered = vec![BufferedLog {
        tenant: "cust-1".into(),
        record: build_log_record(
            &ev("cust-1", "slug"),
            AlertEventType::InstanceFired,
            &LogExtras::default(),
            0,
        ),
    }];
    exporter.export(&buffered).await.unwrap();
    let captured = sink
        .lock()
        .unwrap()
        .take()
        .expect("collector received a request");
    let got = captured.body;
    assert_eq!(got.resource_logs.len(), 1);
    let rl = &got.resource_logs[0];
    let tenant = rl
        .resource
        .as_ref()
        .unwrap()
        .attributes
        .iter()
        .find(|a| a.key == "everr.tenant.id")
        .unwrap();
    match tenant.value.as_ref().unwrap().value.as_ref().unwrap() {
        opentelemetry_proto::tonic::common::v1::any_value::Value::StringValue(s) => {
            assert_eq!(s, "cust-1")
        }
        _ => panic!(),
    }
    // The decoded record preserves the locked EventName shape end-to-end.
    assert_eq!(
        rl.scope_logs[0].log_records[0].event_name,
        "alert.slug.instance_fired"
    );
    // Locked contract: Authorization: Bearer <secret>, protobuf content-type.
    assert_eq!(
        captured.authorization.as_deref(),
        Some("Bearer secret"),
        "trusted ingest auth header"
    );
    assert_eq!(
        captured.content_type.as_deref(),
        Some("application/x-protobuf")
    );
}

#[tokio::test]
async fn empty_buffer_skips_request() {
    let sink = Arc::new(Mutex::new(None));
    let endpoint = start_otlp_sink(sink.clone()).await;
    let exporter = AlertLogExporter::new(&endpoint, "secret");
    exporter.export(&[]).await.unwrap();
    assert!(
        sink.lock().unwrap().is_none(),
        "empty export must not hit the collector"
    );
}
