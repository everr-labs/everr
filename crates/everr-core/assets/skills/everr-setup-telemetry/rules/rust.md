# Rust Instrumentation

Use this rule for Rust services, CLIs, workers, schedulers, and Tauri backends that need OpenTelemetry.

## Default Pattern

- Use a `telemetry_setup.rs` module and call it at the start of `main` before starting servers, workers, queues, database pools, or Tauri builders.
- Prefer `tracing` as the application instrumentation API, `tracing-subscriber` as the subscriber stack, `tracing-opentelemetry` for spans, and `opentelemetry-appender-tracing` for logs.
- Configure OTLP exporters in code so the environment stays small and production auth is attached server-side.
- Export to OTLP HTTP/protobuf for Everr local and hosted ingest unless the project already standardizes on gRPC.
- Keep provider handles alive until shutdown; dropping providers early can stop exports.
- Flush and shut down providers on normal termination, then preserve the process's normal failure behavior.

## Packages

Follow the existing workspace dependency style and keep OpenTelemetry crates on compatible versions. Typical async setup packages:

```bash
cargo add opentelemetry opentelemetry_sdk opentelemetry-otlp tracing tracing-subscriber tracing-opentelemetry opentelemetry-appender-tracing
```

Enable only the features the app needs. For OTLP HTTP traces, metrics, and logs, use the current equivalent of:

```toml
opentelemetry = { version = "...", features = ["metrics"] }
opentelemetry_sdk = { version = "...", features = ["trace", "metrics", "logs", "rt-tokio"] }
opentelemetry-otlp = { version = "...", features = ["trace", "metrics", "logs", "http-proto"] }
opentelemetry-appender-tracing = "..."
tracing = "..."
tracing-opentelemetry = "..."
tracing-subscriber = { version = "...", features = ["env-filter", "registry"] }
```

Do not add gRPC/Tonic features unless the collector endpoint and runtime require gRPC.

## Env vars

Local development or test:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=<otlp-url-from-status>
```

Production Everr ingest:

```bash
EVERR_INGEST_KEY=<secret-manager-reference>
```

Hardcode a stable `service.name` in the setup module. Use existing deployment variables for `service.version` and `deployment.environment.name` if the app already has them. Do not add exporter-selection variables just to enable signals; the setup module should choose exporters in code.

## Setup Module

Adapt this shape to the crate's error type and runtime. Resolve service values first with `resolve-values.md`.

```rust
// src/telemetry_setup.rs
use std::collections::HashMap;
use std::env;

use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

const SERVICE_NAME: &str = "app-service";

pub struct TelemetryGuard {
    tracer_provider: Option<SdkTracerProvider>,
    meter_provider: Option<SdkMeterProvider>,
    logger_provider: Option<SdkLoggerProvider>,
}

pub fn init_telemetry() -> Result<TelemetryGuard, Box<dyn std::error::Error + Send + Sync>> {
    let Some(config) = TelemetryConfig::from_env()? else {
        return Ok(TelemetryGuard::disabled());
    };

    let resource = resource(&config);

    let span_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(config.endpoint.clone())
        .with_headers(config.headers.clone())
        .build()?;
    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(resource.clone())
        .with_batch_exporter(span_exporter)
        .build();
    global::set_tracer_provider(tracer_provider.clone());

    let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(config.endpoint.clone())
        .with_headers(config.headers.clone())
        .build()?;
    let meter_provider = SdkMeterProvider::builder()
        .with_resource(resource.clone())
        .with_periodic_exporter(metric_exporter)
        .build();
    global::set_meter_provider(meter_provider.clone());

    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(config.endpoint)
        .with_headers(config.headers)
        .build()?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(log_exporter)
        .build();

    let tracer = tracer_provider.tracer(config.service_name.clone());
    let trace_layer = tracing_opentelemetry::layer().with_tracer(tracer);
    let log_layer = opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge::new(
        &logger_provider,
    );

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(trace_layer)
        .with(log_layer)
        .with(tracing_subscriber::fmt::layer())
        .try_init()?;

    Ok(TelemetryGuard {
        tracer_provider: Some(tracer_provider),
        meter_provider: Some(meter_provider),
        logger_provider: Some(logger_provider),
    })
}

impl TelemetryGuard {
    fn disabled() -> Self {
        Self {
            tracer_provider: None,
            meter_provider: None,
            logger_provider: None,
        }
    }

    pub fn shutdown(mut self) {
        if let Some(provider) = self.logger_provider.take() {
            let _ = provider.shutdown();
        }
        if let Some(provider) = self.meter_provider.take() {
            let _ = provider.shutdown();
        }
        if let Some(provider) = self.tracer_provider.take() {
            let _ = provider.shutdown();
        }
    }
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.logger_provider.take() {
            let _ = provider.shutdown();
        }
        if let Some(provider) = self.meter_provider.take() {
            let _ = provider.shutdown();
        }
        if let Some(provider) = self.tracer_provider.take() {
            let _ = provider.shutdown();
        }
    }
}

struct TelemetryConfig {
    endpoint: String,
    headers: HashMap<String, String>,
    service_name: String,
    service_version: Option<String>,
    deployment_environment: Option<String>,
}

impl TelemetryConfig {
    fn from_env() -> Result<Option<Self>, Box<dyn std::error::Error + Send + Sync>> {
        let endpoint = match env::var("OTEL_EXPORTER_OTLP_ENDPOINT") {
            Ok(endpoint) => endpoint,
            Err(_) if env::var("EVERR_INGEST_KEY").is_ok() => "https://ingest.everr.dev".into(),
            Err(_) => return Ok(None),
        };

        let service_name = SERVICE_NAME.to_string();
        let headers = env::var("EVERR_INGEST_KEY")
            .map(|key| HashMap::from([("Authorization".to_string(), format!("Bearer {key}"))]))
            .unwrap_or_default();

        Ok(Some(Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            headers,
            service_name,
            service_version: env::var("SERVICE_VERSION").ok(),
            deployment_environment: env::var("DEPLOYMENT_ENVIRONMENT")
                .or_else(|_| env::var("APP_ENV"))
                .ok(),
        }))
    }
}

fn resource(config: &TelemetryConfig) -> Resource {
    let mut builder = Resource::builder().with_service_name(&config.service_name);

    if let Some(version) = &config.service_version {
        builder = builder.with_attribute(opentelemetry::KeyValue::new(
            "service.version",
            version.clone(),
        ));
    }
    if let Some(environment) = &config.deployment_environment {
        builder = builder.with_attribute(opentelemetry::KeyValue::new(
            "deployment.environment.name",
            environment.clone(),
        ));
    }

    builder.build()
}
```

Call setup first and hold the guard:

```rust
mod telemetry_setup;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let telemetry = telemetry_setup::init_telemetry()?;

    run_app().await?;

    telemetry.shutdown();
    Ok(())
}
```

For long-running servers, use the app's existing graceful shutdown path and call `shutdown()` after request handling stops. For Tauri, initialize before `tauri::Builder::default()` starts commands and shutdown from the app's normal exit path when practical.

## Endpoint Shape

For the Rust OTLP HTTP builder, pass the base endpoint and let the exporter append signal paths. Do not pass `/v1/traces`, `/v1/metrics`, or `/v1/logs` unless the specific SDK call expects a signal endpoint.

Local development uses the base endpoint from `everr local status`. Production uses `https://ingest.everr.dev` with the bearer header built from `EVERR_INGEST_KEY`.

## Traces

Use `tracing` spans for request, command, worker, and domain boundaries:

```rust
#[tracing::instrument(skip(db), fields(order.id = %order_id))]
async fn process_order(db: &Db, order_id: OrderId) -> anyhow::Result<()> {
    // Work here is attached to the current span.
    Ok(())
}
```

Span names and fields must be low-cardinality. Prefer route templates, operation names, queue names, and batch types over IDs, file paths, SQL text, or free-form messages.

Use framework middleware where available:

- `tower-http` tracing layers for Axum, Hyper, and Tower services.
- Actix, Rocket, Tonic, SQLx, or reqwest tracing integrations when the project already uses them.
- Manual spans for CLIs, cron jobs, Tauri commands, background workers, and business operations not covered by middleware.

## Logs

Emit structured `tracing` events:

```rust
tracing::error!(
    error = %error,
    order.id = %order_id,
    "order processing failed"
);
```

The `opentelemetry-appender-tracing` bridge sends those events to the OTel log pipeline. Keep the normal local `fmt` layer if developers still need terminal output, but do not duplicate high-volume logs just for telemetry.

Do not log whole requests, headers, cookies, bodies, user records, database result rows, or raw error chains that may contain user input.

## Metrics

Use OpenTelemetry metrics for counters, histograms, and gauges that answer product or SLO questions:

```rust
let meter = global::meter("billing-worker");
let processed = meter.u64_counter("billing.invoices.processed").build();
processed.add(invoices.len() as u64, &[opentelemetry::KeyValue::new("batch.type", batch_type)]);
```

Metric attributes must be bounded and low-cardinality. Do not use request IDs, user IDs, emails, URLs, paths, raw errors, or payload values.

## Errors And Panics

- Record operation failures on the current span with safe context: status `ERROR` only on the failing operation's span, and one structured event carrying the error type and message. Do not add a handled flag: mark panics and fatal failures with `FATAL` severity instead.
- Emit one structured error event at the failing boundary.
- For panic hooks, emit a redacted event, flush providers if possible, then call the previous hook or preserve the normal panic.
- Do not catch panics or convert fatal failures into successful exits just to keep telemetry alive.

## Sensitive Data

Use `sensitive-data.md` before adding fields. Rust formatting makes it easy to leak entire structs through `Debug`, so avoid `?value` and `{value:?}` for request, user, payload, and database types unless the type is explicitly safe for telemetry.

High-risk Rust defaults to check:

- `tracing` fields with `?request`, `?headers`, `?user`, `?payload`, `?error`, or `?row`.
- HTTP middleware that records full URLs with query strings.
- SQL instrumentation that records queries with literal values.
- Tauri command arguments and events that may include local file paths or user data.

Prefer explicit safe fields and source-level redaction.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No traces | `telemetry_setup::init_telemetry()` runs before work starts; `tracing_opentelemetry` layer is installed |
| No logs | `opentelemetry-appender-tracing` layer is installed and `tracing` events are emitted |
| No metrics | Meter provider is set globally and the process lives long enough for periodic export |
| Endpoint errors | Base endpoint from `everr local status`, HTTP vs gRPC features, bearer header from `EVERR_INGEST_KEY` |
| `unknown_service` | Hardcoded `service.name` missing from the resource config or setup module not loaded |
| Duplicate logs | Both app logger and bridge emit the same event more than once |
| Missing shutdown data | Provider handles dropped early or graceful shutdown path does not call `shutdown()` |

After changes, run the instrumented path and validate with `everr local query`. Filter by `ServiceName`, a recent time window, and a run/request/test marker when practical.
