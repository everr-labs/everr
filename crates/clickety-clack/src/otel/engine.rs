//! CC operational self-telemetry: engine traces (eval latency, queue depth, dispatch
//! outcomes, errors) and engine metrics (see `metrics.rs`) shipped on the STANDARD PUBLIC
//! OTLP path via a single everr-internal ingest API key -> everr's internal tenant.
//! Independent of the customer-event trusted path (`AlertLogExporter`): this is
//! operational telemetry for the everr team, not customer-visible.
//!
//! The API key authenticates to everr's internal tenant; the public pipeline derives the
//! tenant from the key, so CC never sets `everr.tenant.id` here.

use crate::otel::metrics::EngineMetrics;
use opentelemetry::metrics::MeterProvider as _;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::{WithExportConfig, WithTonicConfig};
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Held in `main`'s scope; Drop shuts the providers down so buffered spans and the final
/// metrics collection flush on exit.
pub struct EngineTelemetryGuard {
    provider: SdkTracerProvider,
    meter_provider: SdkMeterProvider,
}

impl Drop for EngineTelemetryGuard {
    fn drop(&mut self) {
        // Best-effort flush on shutdown; nothing actionable if it fails during teardown.
        let _ = self.provider.shutdown();
        let _ = self.meter_provider.shutdown();
    }
}

/// Initialize the global `tracing` subscriber plus OTLP trace and metric export on the
/// public path.
///
/// `endpoint` is the public OTLP gRPC endpoint; `api_key` is the everr-internal ingest key
/// sent as `Authorization: Bearer <key>` (the collector's `everr_apikey` auth maps it to
/// everr's internal tenant). `service_name` becomes the `service.name` resource attribute.
/// Returns the guard plus the [`EngineMetrics`] handle to thread into the engine's
/// components; both exporters share the endpoint, key, and resource.
pub fn init_engine_telemetry(
    endpoint: &str,
    api_key: &str,
    service_name: &str,
) -> anyhow::Result<(EngineTelemetryGuard, EngineMetrics)> {
    let mut metadata = tonic::metadata::MetadataMap::new();
    metadata.insert("authorization", format!("Bearer {api_key}").parse()?);

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint.to_string())
        .with_metadata(metadata.clone())
        .build()?;

    let resource = Resource::builder()
        .with_attributes([KeyValue::new("service.name", service_name.to_string())])
        .build();

    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource.clone())
        .build();

    let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint.to_string())
        .with_metadata(metadata)
        .build()?;

    // PeriodicReader runs its own background thread (default 60s interval); with the
    // tonic transport it only requires that this init happens inside the tokio runtime,
    // which `main` guarantees.
    let meter_provider = SdkMeterProvider::builder()
        .with_reader(PeriodicReader::builder(metric_exporter).build())
        .with_resource(resource)
        .build();
    let metrics = EngineMetrics::new(&meter_provider.meter("cc-engine"));

    let tracer = provider.tracer("cc-engine");
    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(otel_layer)
        .init();

    Ok((
        EngineTelemetryGuard {
            provider,
            meter_provider,
        },
        metrics,
    ))
}
