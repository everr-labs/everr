//! Groups buffered alert log records by CUSTOMER tenant and exports them to the
//! collector's TRUSTED OTLP ingest path as a single `ExportLogsServiceRequest` with one
//! `ResourceLogs` per tenant. The trusted pipeline trusts the per-`ResourceLogs`
//! `everr.tenant.id` resource attribute (it does NOT strip/override it).

use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use opentelemetry_proto::tonic::common::v1::{any_value, AnyValue, InstrumentationScope, KeyValue};
use opentelemetry_proto::tonic::logs::v1::{LogRecord, ResourceLogs, ScopeLogs};
use opentelemetry_proto::tonic::resource::v1::Resource;
use prost::Message;

use crate::domain::sink::{AlertLogSink, DeliveryFacts};
use crate::domain::Event;
use crate::otel::alert_log::{
    build_log_record, AlertEventType, LogExtras, SCOPE_NAME, SERVICE_NAME,
};
use async_trait::async_trait;
use std::sync::{Arc, Mutex};

/// A record paired with the customer tenant it belongs to (for per-`ResourceLogs` grouping).
#[derive(Debug, Clone)]
pub struct BufferedLog {
    pub tenant: String,
    pub record: LogRecord,
}

fn str_kv(k: &str, v: &str) -> KeyValue {
    KeyValue {
        key: k.to_string(),
        value: Some(AnyValue {
            value: Some(any_value::Value::StringValue(v.to_string())),
        }),
    }
}

/// Build the OTLP request: one `ResourceLogs` per distinct tenant, each tagged with
/// `everr.tenant.id` + `service.name=alert`, scope `everr.alerting`. Stable tenant order.
pub fn build_export_request(buffered: &[BufferedLog]) -> ExportLogsServiceRequest {
    use std::collections::BTreeMap;
    let mut by_tenant: BTreeMap<&str, Vec<LogRecord>> = BTreeMap::new();
    for b in buffered {
        by_tenant
            .entry(b.tenant.as_str())
            .or_default()
            .push(b.record.clone());
    }
    let resource_logs = by_tenant
        .into_iter()
        .map(|(tenant, records)| ResourceLogs {
            resource: Some(Resource {
                attributes: vec![
                    str_kv("everr.tenant.id", tenant),
                    str_kv("service.name", SERVICE_NAME),
                ],
                dropped_attributes_count: 0,
                entity_refs: vec![],
            }),
            scope_logs: vec![ScopeLogs {
                scope: Some(InstrumentationScope {
                    name: SCOPE_NAME.to_string(),
                    version: String::new(),
                    attributes: vec![],
                    dropped_attributes_count: 0,
                }),
                log_records: records,
                schema_url: String::new(),
            }],
            schema_url: String::new(),
        })
        .collect();
    ExportLogsServiceRequest { resource_logs }
}

#[derive(thiserror::Error, Debug)]
pub enum ExportError {
    #[error("http: {0}")]
    Http(String),
    #[error("status {0}")]
    Status(u16),
}

/// Posts protobuf-encoded `ExportLogsServiceRequest` to the trusted collector path.
/// Authenticates with `Authorization: Bearer <CC_TRUSTED_INGEST_SECRET>` (SP1's collector
/// uses `bearertokenauthextension` in server mode, which reads the `Authorization` header).
#[derive(Clone)]
pub struct AlertLogExporter {
    http: reqwest::Client,
    /// Trusted OTLP/HTTP logs endpoint, e.g. `http://collector:4418/v1/logs` in dev.
    endpoint: String,
    /// Bearer token shared with the collector's trusted receiver.
    trusted_ingest_secret: String,
}

impl AlertLogExporter {
    pub fn new(endpoint: &str, trusted_ingest_secret: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("reqwest client"),
            endpoint: endpoint.to_string(),
            trusted_ingest_secret: trusted_ingest_secret.to_string(),
        }
    }

    pub async fn export(&self, buffered: &[BufferedLog]) -> Result<(), ExportError> {
        if buffered.is_empty() {
            return Ok(());
        }
        let req = build_export_request(buffered);
        let mut buf = Vec::with_capacity(req.encoded_len());
        req.encode(&mut buf)
            .expect("prost encode into Vec is infallible");
        let resp = self
            .http
            .post(&self.endpoint)
            .header("content-type", "application/x-protobuf")
            .header(
                "authorization",
                format!("Bearer {}", self.trusted_ingest_secret),
            )
            .body(buf)
            .send()
            .await
            .map_err(|e| ExportError::Http(e.without_url().to_string()))?;
        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(ExportError::Status(status.as_u16()))
        }
    }
}

/// Upper bound on requeued-after-failure records. Under a sustained collector
/// outage the oldest rows are dropped (with an error log) rather than growing
/// the buffer without bound; these are observability rows, not alert state.
const MAX_BUFFERED: usize = 10_000;

/// Buffers dispatcher delivery/silenced records and flushes them per-tenant. A simple
/// mutex-guarded buffer with an eager background flush; the events-role consumer uses
/// its own batching.
pub struct ExporterSink {
    exporter: AlertLogExporter,
    buf: Arc<Mutex<Vec<BufferedLog>>>,
}

impl ExporterSink {
    pub fn new(exporter: AlertLogExporter) -> Self {
        Self {
            exporter,
            buf: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn flush(&self) {
        flush_buffer(&self.exporter, &self.buf).await;
    }
}

/// Drain the buffer and export it. On failure the batch is REQUEUED (in front, so
/// order is roughly preserved) for the next flush attempt instead of dropped; the
/// buffer is capped at [`MAX_BUFFERED`], discarding the oldest rows beyond it.
async fn flush_buffer(exporter: &AlertLogExporter, buf: &Mutex<Vec<BufferedLog>>) {
    let batch: Vec<BufferedLog> = { std::mem::take(&mut *buf.lock().unwrap()) };
    if batch.is_empty() {
        return;
    }
    if let Err(e) = exporter.export(&batch).await {
        let mut b = buf.lock().unwrap();
        let mut requeued = batch;
        requeued.append(&mut b);
        let dropped = requeued.len().saturating_sub(MAX_BUFFERED);
        if dropped > 0 {
            requeued.drain(..dropped);
        }
        *b = requeued;
        tracing::error!(error = %e, dropped, buffered = b.len(),
            "dispatcher alert-log flush failed; batch requeued for the next flush");
    }
}

#[async_trait]
impl AlertLogSink for ExporterSink {
    async fn record_delivery(&self, ev: &Event, facts: &DeliveryFacts) {
        let etype = if facts.silenced {
            AlertEventType::Silenced
        } else {
            AlertEventType::Delivery
        };
        let extras = LogExtras {
            delivery_targets: facts.delivery_targets.clone(),
            silence_id: facts.silence_id.clone(),
            silenced: Some(facts.silenced),
        };
        let nanos = time::OffsetDateTime::now_utc()
            .unix_timestamp_nanos()
            .max(0) as u64;
        let rec = build_log_record(ev, etype, &extras, nanos);
        self.buf.lock().unwrap().push(BufferedLog {
            tenant: ev.tenant.as_str().to_string(),
            record: rec,
        });
        // Eager flush for low-latency delivery records (small volume vs transitions),
        // but fire-and-forget: the dispatcher's delivery path must never stall behind
        // a slow or down collector (the export timeout is seconds). A failed export
        // requeues the batch, so the next delivery's flush retries it.
        let exporter = self.exporter.clone();
        let buf = Arc::clone(&self.buf);
        tokio::spawn(async move {
            flush_buffer(&exporter, &buf).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A failed export must requeue the drained batch (bounded) instead of dropping
    /// it: these rows are the delivery audit trail, and the next flush retries them.
    #[tokio::test]
    async fn failed_flush_requeues_the_batch() {
        // Port 1 on localhost refuses connections immediately.
        let exporter = AlertLogExporter::new("http://127.0.0.1:1/v1/logs", "secret");
        let buf = Mutex::new(vec![BufferedLog {
            tenant: "t".into(),
            record: LogRecord::default(),
        }]);
        flush_buffer(&exporter, &buf).await;
        assert_eq!(
            buf.lock().unwrap().len(),
            1,
            "record survives the failed flush"
        );
    }
}
