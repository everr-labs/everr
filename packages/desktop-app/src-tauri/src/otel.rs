use std::collections::HashMap;
use std::env;

use opentelemetry::logs::{AnyValue, LogRecord as _, Logger as _, LoggerProvider as _, Severity};
use opentelemetry::Key;
use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::logs::{SdkLogger, SdkLoggerProvider};
use opentelemetry_sdk::Resource;
use serde::{Deserialize, Serialize};
use tauri::State;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const SERVICE_NAME: &str = "everr-desktop";
const FRONTEND_SERVICE_NAME: &str = "everr-desktop-frontend";

type TelemetryInitResult = Result<
    (TelemetryGuard, RelayState, TelemetryContext),
    Box<dyn std::error::Error + Send + Sync>,
>;

pub struct TelemetryGuard {
    logger_provider: Option<SdkLoggerProvider>,
}

#[derive(Debug, Clone)]
pub struct TelemetryContext {
    service_version: String,
    service_instance_id: String,
    deployment_environment: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryContextResponse {
    service_name: &'static str,
    service_version: String,
    service_instance_id: String,
    deployment_environment: String,
}

pub struct RelayState {
    browser_logger: SdkLogger,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLogRecord {
    body: String,
    attributes: HashMap<String, BrowserLogAttribute>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum BrowserLogAttribute {
    String(String),
    Bool(bool),
    Number(f64),
}

impl BrowserLogAttribute {
    fn into_any_value(self) -> AnyValue {
        match self {
            Self::String(value) => AnyValue::from(value),
            Self::Bool(value) => AnyValue::from(value),
            Self::Number(value) => AnyValue::from(value),
        }
    }
}

pub fn init_telemetry() -> TelemetryInitResult {
    let telemetry_context = TelemetryContext::new();
    let Some(config) = TelemetryConfig::from_env(telemetry_context.clone())? else {
        return Ok((
            TelemetryGuard::disabled(),
            RelayState {
                browser_logger: disabled_browser_logger(),
            },
            telemetry_context,
        ));
    };

    let resource = resource(&config);

    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(signal_endpoint(&config.endpoint, "logs"))
        .with_headers(config.headers.clone())
        .build()?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(log_exporter)
        .build();

    let log_layer =
        opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge::new(&logger_provider);

    tracing_subscriber::registry()
        .with(default_telemetry_filter())
        .with(log_layer)
        .with(tracing_subscriber::fmt::layer())
        .try_init()?;

    let relay = RelayState {
        browser_logger: logger_provider.logger(FRONTEND_SERVICE_NAME),
    };

    Ok((
        TelemetryGuard {
            logger_provider: Some(logger_provider),
        },
        relay,
        config.context,
    ))
}

fn default_telemetry_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}

#[tauri::command]
pub fn get_telemetry_context(
    state: State<'_, TelemetryContext>,
) -> Result<TelemetryContextResponse, String> {
    Ok(state.frontend_response())
}

#[tauri::command]
pub fn relay_telemetry(
    state: State<'_, RelayState>,
    signal: String,
    records: Vec<BrowserLogRecord>,
) -> Result<(), String> {
    if signal != "logs" {
        return Err(format!("unsupported telemetry signal: {signal}"));
    }

    for browser_record in records {
        let event_name = browser_event_name(&browser_record.body)?;
        let mut record = state.browser_logger.create_log_record();
        record.set_event_name(event_name);
        record.set_body(AnyValue::from(event_name));
        record.set_severity_number(Severity::Error);
        record.set_severity_text("ERROR");
        record.add_attributes(
            browser_record
                .attributes
                .into_iter()
                .map(|(key, value)| (Key::new(key), value.into_any_value())),
        );
        state.browser_logger.emit(record);
    }

    Ok(())
}

fn browser_event_name(body: &str) -> Result<&'static str, String> {
    match body {
        "everr.browser.error" => Ok("everr.browser.error"),
        "everr.browser.unhandled_rejection" => Ok("everr.browser.unhandled_rejection"),
        "everr.react.render.error" => Ok("everr.react.render.error"),
        _ => Err(format!("unsupported browser log body: {body}")),
    }
}

fn disabled_browser_logger() -> SdkLogger {
    SdkLoggerProvider::builder()
        .build()
        .logger(FRONTEND_SERVICE_NAME)
}

impl TelemetryContext {
    fn new() -> Self {
        Self {
            service_version: env!("EVERR_VERSION").to_string(),
            service_instance_id: Uuid::new_v4().to_string(),
            deployment_environment: if tauri::is_dev() {
                "development".to_string()
            } else {
                "production".to_string()
            },
        }
    }

    fn frontend_response(&self) -> TelemetryContextResponse {
        TelemetryContextResponse {
            service_name: FRONTEND_SERVICE_NAME,
            service_version: self.service_version.clone(),
            service_instance_id: self.service_instance_id.clone(),
            deployment_environment: self.deployment_environment.clone(),
        }
    }

    pub fn service_version(&self) -> &str {
        &self.service_version
    }

    pub fn service_instance_id(&self) -> &str {
        &self.service_instance_id
    }
}

impl TelemetryGuard {
    fn disabled() -> Self {
        Self {
            logger_provider: None,
        }
    }

    pub fn shutdown(mut self) {
        if let Some(provider) = self.logger_provider.take() {
            let _ = provider.shutdown();
        }
    }
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.logger_provider.take() {
            let _ = provider.shutdown();
        }
    }
}

struct TelemetryConfig {
    endpoint: String,
    headers: HashMap<String, String>,
    context: TelemetryContext,
}

impl TelemetryConfig {
    fn from_env(
        context: TelemetryContext,
    ) -> Result<Option<Self>, Box<dyn std::error::Error + Send + Sync>> {
        let ingest_key = ingest_key();
        let endpoint = env_value("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_else(|| {
            if ingest_key.is_some() {
                "https://ingest.everr.dev".into()
            } else {
                everr_core::build::otlp_http_origin()
            }
        });

        let headers = ingest_key
            .map(|key| HashMap::from([("Authorization".to_string(), format!("Bearer {key}"))]))
            .unwrap_or_default();

        Ok(Some(Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            headers,
            context,
        }))
    }
}

fn env_value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .and_then(|value| non_empty_value(&value))
}

fn ingest_key() -> Option<String> {
    env_value("EVERR_INGEST_KEY").or_else(|| {
        if tauri::is_dev() {
            None
        } else {
            option_env!("EVERR_INGEST_KEY").and_then(non_empty_value)
        }
    })
}

fn non_empty_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resource(config: &TelemetryConfig) -> Resource {
    Resource::builder()
        .with_service_name(SERVICE_NAME)
        .with_attribute(opentelemetry::KeyValue::new(
            "service.version",
            config.context.service_version.clone(),
        ))
        .with_attribute(opentelemetry::KeyValue::new(
            "service.instance.id",
            config.context.service_instance_id.clone(),
        ))
        .with_attribute(opentelemetry::KeyValue::new(
            "deployment.environment.name",
            config.context.deployment_environment.clone(),
        ))
        .build()
}

fn signal_endpoint(base_endpoint: &str, signal: &str) -> String {
    let endpoint = base_endpoint.trim_end_matches('/');
    if endpoint.ends_with(&format!("/v1/{signal}")) {
        endpoint.to_string()
    } else {
        format!("{endpoint}/v1/{signal}")
    }
}

pub fn log_app_started(context: &TelemetryContext) {
    tracing::event!(
        target: "everr.app.lifecycle",
        tracing::Level::INFO,
        {
            event.name = "everr.app.started",
            everr.app.version = context.service_version(),
            everr.app.session.id = context.service_instance_id(),
        },
        "everr.app.started"
    );
}

pub fn log_app_stopped(context: &TelemetryContext) {
    tracing::event!(
        target: "everr.app.lifecycle",
        tracing::Level::INFO,
        {
            event.name = "everr.app.stopped",
            everr.app.version = context.service_version(),
            everr.app.session.id = context.service_instance_id(),
        },
        "everr.app.stopped"
    );
}

#[cfg(test)]
mod tests {
    use super::signal_endpoint;

    #[test]
    fn appends_signal_path_to_base_endpoint() {
        assert_eq!(
            signal_endpoint("http://127.0.0.1:54318", "logs"),
            "http://127.0.0.1:54318/v1/logs"
        );
    }

    #[test]
    fn leaves_existing_signal_path_unchanged() {
        assert_eq!(
            signal_endpoint("http://127.0.0.1:54318/v1/logs", "logs"),
            "http://127.0.0.1:54318/v1/logs"
        );
    }
}
