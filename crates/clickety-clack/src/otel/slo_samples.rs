//! Ships SLO evaluation samples to the collector's TRUSTED OTLP ingest path as
//! OTLP gauges, mirroring the alert-log exporter (`otel::exporter`). Each sample
//! is one group's raw `(good, valid)` counts over one window; they become two
//! gauge metrics (`cc.slo.good`, `cc.slo.valid`) whose datapoints carry the SLO
//! identity + window + group labels as attributes. Grouped into one
//! `ResourceMetrics` per CUSTOMER tenant, tagged with `everr.tenant.id` so the
//! trusted pipeline (which does NOT strip/override it) routes each tenant's rows
//! into `app.metrics_gauge` under its own `tenant_id`.
//!
//! Burn rate and remaining budget are NOT emitted: they are pure functions of
//! `(good, valid, target)` and are derived at read time by consumers (the app
//! mirrors `engine/slo_math.rs`), so storage keeps only the raw counts.

use opentelemetry_proto::tonic::collector::metrics::v1::ExportMetricsServiceRequest;
use opentelemetry_proto::tonic::common::v1::{any_value, AnyValue, InstrumentationScope, KeyValue};
use opentelemetry_proto::tonic::metrics::v1::{
    metric, number_data_point, Gauge, Metric, NumberDataPoint, ResourceMetrics, ScopeMetrics,
};
use opentelemetry_proto::tonic::resource::v1::Resource;
use prost::Message;
use std::collections::BTreeMap;
use std::sync::Mutex;

use crate::domain::sink::{SloSample, SloSampleSink};
use crate::otel::exporter::ExportError;
use async_trait::async_trait;

/// `service.name` stamped on every SLO-sample `ResourceMetrics` (the
/// `app.metrics_gauge.ServiceName` column).
pub const SLO_SERVICE_NAME: &str = "slo";
/// Instrumentation scope for the gauges (the `ScopeName` column).
pub const SLO_SCOPE_NAME: &str = "everr.slo";

pub const METRIC_GOOD: &str = "cc.slo.good";
pub const METRIC_VALID: &str = "cc.slo.valid";

const ATTR_SLO_ID: &str = "slo.id";
const ATTR_SLO_NAME: &str = "slo.name";
const ATTR_SLO_WINDOW: &str = "slo.window";
/// Group label columns are namespaced under this prefix so they can never
/// collide with the reserved `slo.*` identity attributes.
const ATTR_GROUP_PREFIX: &str = "slo.group.";

fn str_kv(k: &str, v: &str) -> KeyValue {
    KeyValue {
        key: k.to_string(),
        value: Some(AnyValue {
            value: Some(any_value::Value::StringValue(v.to_string())),
        }),
    }
}

/// The identifying attributes of a sample's datapoint: SLO id/name, the window,
/// and each group label as `slo.group.<column>`. Both metrics of a sample share
/// this set, so the good/valid timeseries line up point for point.
fn point_attributes(s: &SloSample) -> Vec<KeyValue> {
    let mut attrs = Vec::with_capacity(3 + s.labels.len());
    attrs.push(str_kv(ATTR_SLO_ID, &s.slo_id));
    attrs.push(str_kv(ATTR_SLO_NAME, &s.slo_name));
    attrs.push(str_kv(ATTR_SLO_WINDOW, &s.window));
    for (k, v) in &s.labels {
        attrs.push(str_kv(&format!("{ATTR_GROUP_PREFIX}{k}"), v));
    }
    attrs
}

fn number_point(attributes: Vec<KeyValue>, time_unix_nanos: u64, value: f64) -> NumberDataPoint {
    NumberDataPoint {
        attributes,
        start_time_unix_nano: 0,
        time_unix_nano: time_unix_nanos,
        exemplars: vec![],
        flags: 0,
        value: Some(number_data_point::Value::AsDouble(value)),
    }
}

fn gauge_metric(name: &str, data_points: Vec<NumberDataPoint>) -> Metric {
    Metric {
        name: name.to_string(),
        description: String::new(),
        unit: String::new(),
        metadata: vec![],
        data: Some(metric::Data::Gauge(Gauge { data_points })),
    }
}

/// Build the OTLP request: one `ResourceMetrics` per distinct tenant (stable
/// order), each carrying the `cc.slo.good` and `cc.slo.valid` gauges with one
/// datapoint per sample. Mirrors `exporter::build_export_request`.
pub fn build_metrics_request(samples: &[SloSample]) -> ExportMetricsServiceRequest {
    let mut by_tenant: BTreeMap<&str, Vec<&SloSample>> = BTreeMap::new();
    for s in samples {
        by_tenant.entry(s.tenant.as_str()).or_default().push(s);
    }
    let resource_metrics = by_tenant
        .into_iter()
        .map(|(tenant, ss)| {
            let good = ss
                .iter()
                .map(|s| number_point(point_attributes(s), s.time_unix_nanos, s.good))
                .collect();
            let valid = ss
                .iter()
                .map(|s| number_point(point_attributes(s), s.time_unix_nanos, s.valid))
                .collect();
            ResourceMetrics {
                resource: Some(Resource {
                    attributes: vec![
                        str_kv("everr.tenant.id", tenant),
                        str_kv("service.name", SLO_SERVICE_NAME),
                    ],
                    dropped_attributes_count: 0,
                    entity_refs: vec![],
                }),
                scope_metrics: vec![ScopeMetrics {
                    scope: Some(InstrumentationScope {
                        name: SLO_SCOPE_NAME.to_string(),
                        version: String::new(),
                        attributes: vec![],
                        dropped_attributes_count: 0,
                    }),
                    metrics: vec![
                        gauge_metric(METRIC_GOOD, good),
                        gauge_metric(METRIC_VALID, valid),
                    ],
                    schema_url: String::new(),
                }],
                schema_url: String::new(),
            }
        })
        .collect();
    ExportMetricsServiceRequest { resource_metrics }
}

/// Given the configured trusted logs endpoint (`.../v1/logs`), the sibling
/// metrics endpoint (`.../v1/metrics`) on the same collector. Falls back to
/// appending the signal path for a non-standard endpoint.
pub fn metrics_endpoint_from_logs(logs_endpoint: &str) -> String {
    // Trim trailing slashes BEFORE the suffix match so `.../v1/logs/` still
    // resolves to the sibling metrics path instead of `.../v1/logs/v1/metrics`.
    let trimmed = logs_endpoint.trim_end_matches('/');
    match trimmed.strip_suffix("/v1/logs") {
        Some(base) => format!("{base}/v1/metrics"),
        None => format!("{trimmed}/v1/metrics"),
    }
}

/// POSTs protobuf-encoded `ExportMetricsServiceRequest` to the trusted collector
/// metrics path, authenticating with the same `Authorization: Bearer` token as
/// the alert-log exporter.
#[derive(Clone)]
pub struct SloSampleExporter {
    http: reqwest::Client,
    endpoint: String,
    trusted_ingest_secret: String,
}

impl SloSampleExporter {
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

    pub async fn export(&self, samples: &[SloSample]) -> Result<(), ExportError> {
        if samples.is_empty() {
            return Ok(());
        }
        let req = build_metrics_request(samples);
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

/// Buffers SLO samples and flushes them per consume batch. Mutex-guarded buffer,
/// like `exporter::ExporterSink`; `record` only appends (cheap in the eval loop),
/// `flush` drains and exports once.
pub struct SloSampleExporterSink {
    exporter: SloSampleExporter,
    buf: Mutex<Vec<SloSample>>,
}

impl SloSampleExporterSink {
    pub fn new(exporter: SloSampleExporter) -> Self {
        Self {
            exporter,
            buf: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl SloSampleSink for SloSampleExporterSink {
    fn record(&self, mut samples: Vec<SloSample>) {
        self.buf.lock().unwrap().append(&mut samples);
    }

    async fn flush(&self) {
        let batch: Vec<SloSample> = { std::mem::take(&mut *self.buf.lock().unwrap()) };
        if let Err(e) = self.exporter.export(&batch).await {
            tracing::error!(error = %e, "slo sample flush failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentelemetry_proto::tonic::common::v1::any_value::Value as AV;

    fn sample(tenant: &str, window: &str, good: f64, valid: f64) -> SloSample {
        SloSample {
            tenant: tenant.to_string(),
            slo_id: "11111111-2222-3333-4444-555555555555".to_string(),
            slo_name: "checkout-availability".to_string(),
            window: window.to_string(),
            labels: BTreeMap::from([("ServiceName".to_string(), "checkout".to_string())]),
            good,
            valid,
            time_unix_nanos: 1_700_000_000_000_000_000,
        }
    }

    fn str_attr(kvs: &[KeyValue], key: &str) -> Option<String> {
        kvs.iter()
            .find(|k| k.key == key)
            .and_then(|k| match k.value.as_ref()?.value.as_ref()? {
                AV::StringValue(s) => Some(s.clone()),
                _ => None,
            })
    }

    #[test]
    fn one_resource_metrics_per_tenant() {
        let req = build_metrics_request(&[
            sample("org2", "3600s", 1.0, 2.0),
            sample("org1", "3600s", 3.0, 4.0),
        ]);
        assert_eq!(req.resource_metrics.len(), 2);
        let mut tenants: Vec<_> = req
            .resource_metrics
            .iter()
            .map(|rm| {
                str_attr(&rm.resource.as_ref().unwrap().attributes, "everr.tenant.id").unwrap()
            })
            .collect();
        tenants.sort();
        assert_eq!(tenants, vec!["org1", "org2"]);
    }

    #[test]
    fn emits_good_and_valid_gauges_with_identity_and_group_attributes() {
        let req = build_metrics_request(&[sample("org1", "3600s", 9856.0, 10000.0)]);
        let metrics = &req.resource_metrics[0].scope_metrics[0].metrics;
        let names: Vec<_> = metrics.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, vec![METRIC_GOOD, METRIC_VALID]);

        // The good gauge carries the raw good count and the full attribute set.
        let good = &metrics[0];
        let metric::Data::Gauge(g) = good.data.as_ref().unwrap() else {
            panic!("expected gauge");
        };
        let dp = &g.data_points[0];
        assert_eq!(dp.value, Some(number_data_point::Value::AsDouble(9856.0)));
        assert_eq!(dp.time_unix_nano, 1_700_000_000_000_000_000);
        assert_eq!(
            str_attr(&dp.attributes, "slo.id").as_deref(),
            Some("11111111-2222-3333-4444-555555555555")
        );
        assert_eq!(
            str_attr(&dp.attributes, "slo.name").as_deref(),
            Some("checkout-availability")
        );
        assert_eq!(
            str_attr(&dp.attributes, "slo.window").as_deref(),
            Some("3600s")
        );
        // Group columns are namespaced under slo.group.*
        assert_eq!(
            str_attr(&dp.attributes, "slo.group.ServiceName").as_deref(),
            Some("checkout")
        );

        // The valid gauge carries the raw valid count.
        let metric::Data::Gauge(g) = metrics[1].data.as_ref().unwrap() else {
            panic!("expected gauge");
        };
        assert_eq!(
            g.data_points[0].value,
            Some(number_data_point::Value::AsDouble(10000.0))
        );
    }

    #[test]
    fn metrics_endpoint_swaps_logs_suffix() {
        assert_eq!(
            metrics_endpoint_from_logs("http://collector:4418/v1/logs"),
            "http://collector:4418/v1/metrics"
        );
        // Non-standard endpoint: append the signal path.
        assert_eq!(
            metrics_endpoint_from_logs("http://collector:4418/"),
            "http://collector:4418/v1/metrics"
        );
        // A trailing slash on the standard form still swaps the suffix.
        assert_eq!(
            metrics_endpoint_from_logs("http://collector:4418/v1/logs/"),
            "http://collector:4418/v1/metrics"
        );
    }
}
