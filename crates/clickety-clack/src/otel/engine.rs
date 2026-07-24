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
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{WithExportConfig, WithTonicConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

/// Targets excluded from the OTLP log bridge: the export stack's own logging.
/// Without this, exporter internals (tonic/h2/hyper, the SDK itself) would be
/// exported by the exporter they describe: a self-amplifying feedback loop.
/// They still reach stdout via the fmt layer.
fn is_bridgeable(meta: &tracing::Metadata<'_>) -> bool {
    const EXCLUDED: [&str; 4] = ["opentelemetry", "tonic", "h2", "hyper"];
    !EXCLUDED
        .iter()
        .any(|prefix| meta.target().starts_with(prefix))
}

/// The per-layer filter for the OTLP log bridge (see [`is_bridgeable`]).
pub fn log_bridge_filter(
) -> tracing_subscriber::filter::FilterFn<fn(&tracing::Metadata<'_>) -> bool> {
    tracing_subscriber::filter::FilterFn::new(is_bridgeable as fn(&tracing::Metadata<'_>) -> bool)
}

/// Held in `main`'s scope; Drop shuts the providers down so buffered spans and the final
/// metrics collection flush on exit.
pub struct EngineTelemetryGuard {
    provider: SdkTracerProvider,
    meter_provider: SdkMeterProvider,
    logger_provider: SdkLoggerProvider,
}

impl Drop for EngineTelemetryGuard {
    fn drop(&mut self) {
        // Best-effort flush on shutdown; nothing actionable if it fails during teardown.
        let _ = self.provider.shutdown();
        let _ = self.meter_provider.shutdown();
        let _ = self.logger_provider.shutdown();
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
    let log_metadata = metadata.clone();

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
        .with_resource(resource.clone())
        .build();
    let metrics = EngineMetrics::new(&meter_provider.meter("cc-engine"));

    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint.to_string())
        .with_metadata(log_metadata)
        .build()?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );

    let tracer = provider.tracer("cc-engine");
    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);
    let log_bridge =
        OpenTelemetryTracingBridge::new(&logger_provider).with_filter(log_bridge_filter());
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .with(otel_layer)
        .with(log_bridge)
        .init();

    Ok((
        EngineTelemetryGuard {
            provider,
            meter_provider,
            logger_provider,
        },
        metrics,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
    use opentelemetry_sdk::logs::{InMemoryLogExporter, SdkLoggerProvider};
    use opentelemetry_sdk::trace::InMemorySpanExporter;
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::Layer;

    /// A tracing event inside a span exports as a log record carrying that
    /// span's trace id (the correlation the whole logs design exists for).
    #[test]
    fn log_records_carry_the_active_trace_id() {
        let span_exporter = InMemorySpanExporter::default();
        let tracer_provider = SdkTracerProvider::builder()
            .with_simple_exporter(span_exporter.clone())
            .build();
        let log_exporter = InMemoryLogExporter::default();
        let logger_provider = SdkLoggerProvider::builder()
            .with_simple_exporter(log_exporter.clone())
            .build();

        let tracer = tracer_provider.tracer("test");
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .with(
                OpenTelemetryTracingBridge::new(&logger_provider).with_filter(log_bridge_filter()),
            );
        tracing::subscriber::with_default(subscriber, || {
            let span = tracing::info_span!("op");
            let _g = span.enter();
            tracing::info!("inside");
        });
        tracer_provider.force_flush().unwrap();
        logger_provider.force_flush().unwrap();

        let spans = span_exporter.get_finished_spans().unwrap();
        let logs = log_exporter.get_emitted_logs().unwrap();
        assert_eq!(spans.len(), 1);
        assert_eq!(logs.len(), 1);
        let log_trace = logs[0].record.trace_context().expect("log has trace ctx");
        assert_eq!(log_trace.trace_id, spans[0].span_context.trace_id());
    }

    /// Exporter-internal targets must never reach the log exporter: that is
    /// the self-amplifying feedback loop (exporter logs -> exported -> logs).
    #[test]
    fn bridge_filter_drops_exporter_internal_targets() {
        let log_exporter = InMemoryLogExporter::default();
        let logger_provider = SdkLoggerProvider::builder()
            .with_simple_exporter(log_exporter.clone())
            .build();
        let subscriber = tracing_subscriber::registry().with(
            OpenTelemetryTracingBridge::new(&logger_provider).with_filter(log_bridge_filter()),
        );
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(target: "opentelemetry_sdk", "internal");
            tracing::info!(target: "tonic::transport", "internal");
            tracing::info!(target: "h2::client", "internal");
            tracing::info!(target: "hyper::proto", "internal");
            tracing::info!(target: "cc::dispatcher", "real");
        });
        logger_provider.force_flush().unwrap();
        let logs = log_exporter.get_emitted_logs().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(
            logs[0].record.target().map(|t| t.as_ref()),
            Some("cc::dispatcher")
        );
    }
}
