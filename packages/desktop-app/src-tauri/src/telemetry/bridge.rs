//! Tracing → OpenTelemetry bridge.
//!
//! Installs a global `tracing` subscriber composed of:
//! - An `EnvFilter` layer (configured via `RUST_LOG` or a sensible default)
//! - A `fmt` layer (stderr)
//! - A reload-able combined OTel layer for spans + logs (initially `None`)
//!
//! When the sidecar state becomes `Ready`, the bridge wires up OTLP exporters
//! and reloads the layer so that spans and logs flow to the collector.

use std::sync::{Mutex, OnceLock};

use opentelemetry::{trace::TracerProvider as _, KeyValue};
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporterBuilder, SpanExporterBuilder, WithExportConfig};
use opentelemetry_sdk::{logs::SdkLoggerProvider, trace::SdkTracerProvider, Resource};
use tokio::sync::watch;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{
    fmt, layer::SubscriberExt, reload, util::SubscriberInitExt, EnvFilter, Layer, Registry,
};

use crate::telemetry::sidecar::TelemetryState;

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

/// The reload-able inner layer: a boxed, optional, combined span+log layer.
/// When `None`, tracing calls pass through as no-ops (for the OTel part).
type OtelLayer = Option<Box<dyn Layer<Registry> + Send + Sync>>;

// ---------------------------------------------------------------------------
// GlobalBridge — singleton that holds the reload handle + provider slots
// ---------------------------------------------------------------------------

struct GlobalBridge {
    reload_handle: reload::Handle<OtelLayer, Registry>,
    tracer_provider: Mutex<Option<SdkTracerProvider>>,
    logger_provider: Mutex<Option<SdkLoggerProvider>>,
}

static GLOBAL_BRIDGE: OnceLock<GlobalBridge> = OnceLock::new();

/// Installs the global subscriber (idempotent via `OnceLock`) and returns
/// the reload handle + provider slots.
fn global_bridge() -> &'static GlobalBridge {
    GLOBAL_BRIDGE.get_or_init(|| {
        let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new("info,notifier=debug,h2=info,hyper=info,tower=info,reqwest=info")
        });

        let fmt_layer = fmt::layer().with_writer(std::io::stderr);

        // OTel layer — starts as None (no-op) until providers are wired.
        let (otel_layer, reload_handle) =
            reload::Layer::new(None::<Box<dyn Layer<Registry> + Send + Sync>>);

        tracing_subscriber::registry()
            .with(otel_layer)
            .with(env_filter)
            .with(fmt_layer)
            .init();

        GlobalBridge {
            reload_handle,
            tracer_provider: Mutex::new(None),
            logger_provider: Mutex::new(None),
        }
    })
}

// ---------------------------------------------------------------------------
// Resource
// ---------------------------------------------------------------------------

fn build_resource() -> Resource {
    let env = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };

    Resource::builder()
        .with_service_name("everr-desktop")
        .with_attributes([
            KeyValue::new("service.version", env!("EVERR_VERSION")),
            KeyValue::new("deployment.environment", env),
            KeyValue::new("host.os", std::env::consts::OS),
            KeyValue::new("host.arch", std::env::consts::ARCH),
        ])
        .build()
}

// ---------------------------------------------------------------------------
// wire / unwire providers
// ---------------------------------------------------------------------------

fn wire_providers(endpoint: &str, bridge: &GlobalBridge) {
    let resource = build_resource();

    // --- Span exporter + TracerProvider ---
    // with_endpoint() uses the URL as-is (no path appended), so we must
    // include the signal-specific path ourselves.
    let span_exporter = match SpanExporterBuilder::default()
        .with_http()
        .with_endpoint(format!("{endpoint}/v1/traces"))
        .build()
    {
        Ok(e) => e,
        Err(err) => {
            tracing::warn!("failed to build span exporter: {err}");
            return;
        }
    };

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(span_exporter)
        .with_resource(resource.clone())
        .build();

    let tracer = tracer_provider.tracer("everr-desktop");
    let span_layer = OpenTelemetryLayer::new(tracer);

    // --- Log exporter + LoggerProvider ---
    let log_exporter = match LogExporterBuilder::default()
        .with_http()
        .with_endpoint(format!("{endpoint}/v1/logs"))
        .build()
    {
        Ok(e) => e,
        Err(err) => {
            tracing::warn!("failed to build log exporter: {err}");
            return;
        }
    };

    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    let log_layer = OpenTelemetryTracingBridge::new(&logger_provider);

    // Combine both into a single boxed layer and reload.
    let combined: Box<dyn Layer<Registry> + Send + Sync> = Box::new(span_layer.and_then(log_layer));

    if let Err(err) = bridge.reload_handle.reload(Some(combined)) {
        tracing::warn!("failed to reload OTel layer: {err}");
    }

    *bridge.tracer_provider.lock().unwrap() = Some(tracer_provider);
    *bridge.logger_provider.lock().unwrap() = Some(logger_provider);
}

fn unwire_providers(bridge: &GlobalBridge) {
    // Set the layer back to None so tracing calls become no-ops.
    let _ = bridge.reload_handle.reload(None);

    // Shut down providers so they flush pending data.
    if let Some(tp) = bridge.tracer_provider.lock().unwrap().take() {
        if let Err(err) = tp.shutdown() {
            eprintln!("[bridge] tracer provider shutdown error: {err}");
        }
    }
    if let Some(lp) = bridge.logger_provider.lock().unwrap().take() {
        if let Err(err) = lp.shutdown() {
            eprintln!("[bridge] logger provider shutdown error: {err}");
        }
    }
}

// ---------------------------------------------------------------------------
// BridgeHandle — public API
// ---------------------------------------------------------------------------

/// Handle returned by [`install`]. Owns the background watch task and
/// provides a `shutdown()` method for orderly teardown.
pub struct BridgeHandle {
    watch_task: Option<tokio::task::JoinHandle<()>>,
}

impl BridgeHandle {
    /// Shuts down the bridge: cancels the watch task, flushes and drops
    /// the OTel providers.
    pub async fn shutdown(mut self) {
        if let Some(task) = self.watch_task.take() {
            task.abort();
            let _ = task.await;
        }
        unwire_providers(global_bridge());
    }
}

// ---------------------------------------------------------------------------
// install()
// ---------------------------------------------------------------------------

/// Installs the global `tracing` subscriber (once) and starts a background
/// task that watches `sidecar_state` for `Ready` / `Disabled` transitions.
///
/// Returns a [`BridgeHandle`] that the caller should keep alive and call
/// `shutdown()` on during app exit.
pub fn install(mut sidecar_state: watch::Receiver<TelemetryState>) -> BridgeHandle {
    let bridge = global_bridge();

    let task = tokio::spawn(async move {
        loop {
            // Wait for a state change.
            if sidecar_state.changed().await.is_err() {
                // Sender dropped — sidecar is gone.
                break;
            }

            let state = sidecar_state.borrow_and_update().clone();
            match state {
                TelemetryState::Ready { otlp_endpoint } => {
                    tracing::info!(endpoint = %otlp_endpoint, "wiring OTel providers");
                    wire_providers(&otlp_endpoint, bridge);
                }
                TelemetryState::Disabled { reason } => {
                    tracing::info!(reason = %reason, "unwiring OTel providers");
                    unwire_providers(bridge);
                }
                TelemetryState::Starting => {
                    // Nothing to do yet.
                }
            }
        }
    });

    BridgeHandle {
        watch_task: Some(task),
    }
}
