# Tauri Instrumentation

Use this rule for Tauri v2 apps that need low-noise error telemetry from both the Rust backend and the browser webview. This setup is logs-only for browser errors and Rust errors: a deliberately small starting point. Add traces, metrics, or richer logs later as the app needs them.

This rule is app-agnostic. Resolve concrete service names, release version, environment, and endpoint from the app before editing code. Use placeholders in plans until the values are known:

- `<rust-service-name>`
- `<browser-service-name>`
- `<release-version>`
- `<deployment-environment>`
- `<otlp-url-from-status>`

## Resource Attributes

Rust owns the per-process app session UUID and release version. The browser must get that context from Rust through a Tauri command so both sides share the same session identity.

Required resource attributes on both Rust and browser logs:

- `service.name`
- `service.version`
- `service.instance.id`
- `deployment.environment.name`

Use `service.instance.id` as an opaque process/session UUID generated at app startup. Do not use an auth session, user id, machine id, tenant id, or token.

Choose service names from the app, not from this rule. Use a stable backend name for Rust and a related frontend name for the browser, for example:

- Rust: `<rust-service-name>`
- Browser: `<browser-service-name>`

## Package Setup

Use the app's package manager for the browser dependencies:

```bash
pnpm add @opentelemetry/api-logs @opentelemetry/core @opentelemetry/resources @opentelemetry/sdk-logs @opentelemetry/semantic-conventions @tauri-apps/api
```

Use equivalent `npm install` or `yarn add` commands when the project does not use pnpm.

Rust dependencies:

```toml
[dependencies]
opentelemetry = { version = "0.30", features = ["logs"] }
opentelemetry_sdk = { version = "0.30", features = ["logs", "rt-tokio"] }
opentelemetry-otlp = { version = "0.30", features = ["http-proto", "logs", "reqwest-rustls", "reqwest-blocking-client"] }
opentelemetry-appender-tracing = "0.30"
serde = { version = "1", features = ["derive"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "registry"] }
uuid = { version = "1", features = ["v4", "serde"] }
```

## Runtime Configuration

Only Rust reads exporter configuration. Browser code emits through the browser OTel logger; the browser OTel exporter forwards structured log records to Rust through `relay_telemetry`; Rust re-emits those records through the Rust OTel logger; and the configured Rust OTel exporter handles collector transport.

Local development:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=<otlp-url-from-status>
```

Production with Everr hosted ingest:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.everr.dev/
EVERR_INGEST_KEY=<secret-manager-reference>
```

## Rust Context

Create one telemetry context during app startup. Keep the service names as constants or resolved configuration values for the app.

```rust
use opentelemetry::KeyValue;
use opentelemetry_sdk::Resource;
use serde::Serialize;
use uuid::Uuid;

const RUST_SERVICE_NAME: &str = "<rust-service-name>";
const BROWSER_SERVICE_NAME: &str = "<browser-service-name>";

#[derive(Clone)]
pub struct TelemetryContext {
    service_version: String,
    service_instance_id: String,
    deployment_environment: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryContextResponse {
    service_name: &'static str,
    service_version: String,
    service_instance_id: String,
    deployment_environment: String,
}

impl TelemetryContext {
    pub fn new(service_version: impl Into<String>, deployment_environment: impl Into<String>) -> Self {
        Self {
            service_version: service_version.into(),
            service_instance_id: Uuid::new_v4().to_string(),
            deployment_environment: deployment_environment.into(),
        }
    }

    pub fn resource(&self) -> Resource {
        Resource::builder()
            .with_service_name(RUST_SERVICE_NAME)
            .with_attributes([
                KeyValue::new("service.version", self.service_version.clone()),
                KeyValue::new("service.instance.id", self.service_instance_id.clone()),
                KeyValue::new("deployment.environment.name", self.deployment_environment.clone()),
            ])
            .build()
    }

    pub fn browser_response(&self) -> TelemetryContextResponse {
        TelemetryContextResponse {
            service_name: BROWSER_SERVICE_NAME,
            service_version: self.service_version.clone(),
            service_instance_id: self.service_instance_id.clone(),
            deployment_environment: self.deployment_environment.clone(),
        }
    }
}
```

Resolve the release version from the Tauri app/package metadata or build system. Resolve the deployment environment from the app's existing environment conventions.

## Rust Log Exporter

Install a Rust logs-only OTel provider. Bridge `tracing` events into OTel logs.

```rust
use opentelemetry::logs::LoggerProvider as _;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{Protocol, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct TelemetryGuard {
    logger_provider: Option<SdkLoggerProvider>,
}

impl TelemetryGuard {
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

pub fn init_telemetry(
    context: TelemetryContext,
    endpoint: &str,
    headers: std::collections::HashMap<String, String>,
) -> Result<(TelemetryGuard, RelayState, TelemetryContext), Box<dyn std::error::Error + Send + Sync>> {
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpBinary)
        .with_endpoint(signal_endpoint(endpoint, "logs"))
        .with_headers(headers.clone())
        .build()?;

    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(context.resource())
        .with_batch_exporter(log_exporter)
        .build();

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(OpenTelemetryTracingBridge::new(&logger_provider))
        .try_init()?;

    let relay_state = RelayState {
        browser_logger: logger_provider.logger(format!("{BROWSER_SERVICE_NAME}.browser-relay")),
    };

    Ok((
        TelemetryGuard {
            logger_provider: Some(logger_provider),
        },
        relay_state,
        context,
    ))
}

fn signal_endpoint(base_endpoint: &str, signal: &str) -> String {
    let endpoint = base_endpoint.trim_end_matches('/');
    if endpoint.ends_with(&format!("/v1/{signal}")) {
        endpoint.to_string()
    } else {
        format!("{endpoint}/v1/{signal}")
    }
}
```

## Browser Exporter Relay

Browser telemetry must go through OTel logger and exporter APIs. Do not call `relay_telemetry` directly from UI or application code to record an event. The only browser caller should be the OTel log exporter, which maps log records to an IPC payload and uses the Tauri command as transport.

The Rust relay command is transport, not an application telemetry API. It accepts only structured log records produced by the browser OTel exporter, then emits them through the Rust OTel logger. Because this is an error-only setup, the relay stamps every browser log at `ERROR` severity rather than carrying a severity from the browser.

```rust
use opentelemetry::logs::{AnyValue, LogRecord as _, Logger as _, Severity};
use opentelemetry::Key;
use opentelemetry_sdk::logs::SdkLogger;
use serde::Deserialize;
use tauri::State;

pub struct RelayState {
    browser_logger: SdkLogger,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLogRecord {
    body: String,
    attributes: std::collections::HashMap<String, BrowserLogAttribute>,
}

#[derive(Deserialize)]
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

#[tauri::command]
pub fn get_telemetry_context(
    context: State<'_, TelemetryContext>,
) -> Result<TelemetryContextResponse, String> {
    Ok(context.browser_response())
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
        "browser.error" => Ok("browser.error"),
        "browser.unhandled_rejection" => Ok("browser.unhandled_rejection"),
        "react.render.error" => Ok("react.render.error"),
        _ => Err(format!("unsupported browser log body: {body}")),
    }
}
```

Custom commands registered with `invoke_handler` do not need extra Tauri permissions. Only Tauri core APIs, plugins, file system access, shell access, HTTP access, windows, and capabilities need permission entries.

## Tauri Builder

Initialize telemetry before app setup, manage the relay state and telemetry context, register the commands, and flush on shutdown.

```rust
let telemetry_context = TelemetryContext::new("<release-version>", "<deployment-environment>");
let headers = ingest_headers_from_env();
let (telemetry_guard, relay_state, telemetry_context) =
    init_telemetry(telemetry_context, "<otlp-url-from-status>", headers)
        .expect("telemetry init failed");

tauri::Builder::default()
    .manage(relay_state)
    .manage(telemetry_context)
    .invoke_handler(tauri::generate_handler![
        get_telemetry_context,
        relay_telemetry,
    ])
    .build(tauri::generate_context!())?
    .run(|_app, _event| {});

telemetry_guard.shutdown();
```

Keep `ingest_headers_from_env()` server-side. If exporting to Everr hosted ingest, it should read `EVERR_INGEST_KEY` and return `Authorization: Bearer <key>`.

## Rust Error Logs

Use one helper so Rust failures emit consistent exception fields.

```rust
pub fn log_rust_error(error: &(dyn std::error::Error + 'static), handled: bool) {
    tracing::error!(
        "event.name" = "rust.error",
        "exception.type" = std::any::type_name_of_val(error),
        "exception.message" = %error,
        "error.handled" = handled,
        "rust.error",
    );
}
```

Install a panic hook that emits `rust.error` with `error.handled=false` before delegating to the previous hook.

Do not log Tauri command arguments, auth tokens, request headers, request bodies, local file contents, paths from file dialogs, or user-entered text.

## Browser Log Exporter

The browser keeps a logs-only OTel provider. Its custom OTel exporter converts browser log records into a small IPC payload and lets Rust emit those records through the Rust OTel logger/exporter pipeline.

```ts
import { logs, SeverityNumber, type Logger } from '@opentelemetry/api-logs';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { invoke } from '@tauri-apps/api/core';

type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
};

type ErrorLogBody =
  | 'browser.error'
  | 'browser.unhandled_rejection'
  | 'react.render.error';

type PendingErrorLog = {
  body: ErrorLogBody;
  attributes: Record<string, string | boolean | number | undefined>;
  exception?: Error;
};

type RelayLogRecord = {
  body: ErrorLogBody;
  attributes: Record<string, string | boolean | number>;
};

function isErrorLogBody(body: string): body is ErrorLogBody {
  return (
    body === 'browser.error' ||
    body === 'browser.unhandled_rejection' ||
    body === 'react.render.error'
  );
}

function relayAttributeValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  return undefined;
}

function toRelayLogRecord(record: ReadableLogRecord): RelayLogRecord | null {
  const body = String(record.body ?? '');
  if (!isErrorLogBody(body)) {
    return null;
  }

  const attributes: RelayLogRecord['attributes'] = {};
  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    const relayValue = relayAttributeValue(value);
    if (relayValue !== undefined) {
      attributes[key] = relayValue;
    }
  }

  return { body, attributes };
}

class TauriLogExporter implements LogRecordExporter {
  async export(records: ReadableLogRecord[], done: (result: ExportResult) => void) {
    const relayRecords = records
      .map(toRelayLogRecord)
      .filter((record): record is RelayLogRecord => record !== null);

    if (relayRecords.length === 0) {
      done({ code: ExportResultCode.SUCCESS });
      return;
    }

    try {
      await invoke('relay_telemetry', { signal: 'logs', records: relayRecords });
      done({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      done({ code: ExportResultCode.FAILED, error: error as Error });
    }
  }

  async shutdown() {}
  async forceFlush() {}
}

let loggerProvider: LoggerProvider | null = null;
let browserErrorLogger: Logger | null = null;
const pendingErrorLogs: PendingErrorLog[] = [];

function emitErrorLog(log: PendingErrorLog) {
  if (!browserErrorLogger) {
    pendingErrorLogs.push(log);
    return;
  }

  browserErrorLogger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: log.body,
    attributes: log.attributes,
    exception: log.exception,
  });
}

export async function initBrowserTelemetry() {
  const context = await invoke<TelemetryContext>('get_telemetry_context');

  loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: context.serviceName,
      'service.version': context.serviceVersion,
      'service.instance.id': context.serviceInstanceId,
      'deployment.environment.name': context.deploymentEnvironment,
    }),
    processors: [
      new BatchLogRecordProcessor(new TauriLogExporter(), {
        maxQueueSize: 100,
        maxExportBatchSize: 32,
        scheduledDelayMillis: 5_000,
        exportTimeoutMillis: 30_000,
      }),
    ],
  });

  logs.setGlobalLoggerProvider(loggerProvider);
  browserErrorLogger = logs.getLogger(`${context.serviceName}.browser-errors`);

  for (const log of pendingErrorLogs.splice(0)) {
    emitErrorLog(log);
  }
}

export function shutdownBrowserTelemetry() {
  return loggerProvider?.shutdown();
}

export function logBrowserException(
  body: ErrorLogBody,
  error: unknown,
  attributes: Record<string, string | boolean | number | undefined> = {},
) {
  const exception =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown browser error');

  emitErrorLog({
    body,
    exception,
    attributes: {
      'event.name': body,
      'exception.type': exception.name || 'Error',
      'exception.message': exception.message,
      'exception.stacktrace': exception.stack ?? '',
      'error.handled': false,
      ...attributes,
    },
  });
}
```

Install browser error listeners before rendering the app so early errors are buffered or emitted.

```ts
window.addEventListener('error', (event) => {
  logBrowserException('browser.error', event.error ?? event.message, {
    'browser.error.filename': event.filename,
    'browser.error.lineno': event.lineno,
    'browser.error.colno': event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  logBrowserException('browser.unhandled_rejection', event.reason);
});

window.addEventListener('beforeunload', () => {
  void shutdownBrowserTelemetry();
});
```

Runtime errors, promise rejections, and framework error-boundary failures are the browser error sources for this setup.

## React Error Boundary

For React apps, keep React handling as a normal error boundary that emits one log and renders fallback UI. Skip this section for non-React Tauri apps.

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logBrowserException } from './telemetry';

export class ReactErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logBrowserException('react.render.error', error, {
      'react.component_stack': info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}
```

## Validation

After rebuilding and running the app, query recent logs by the resolved service names:

```sql
SELECT
  Timestamp,
  ServiceName,
  SeverityText,
  Body,
  ResourceAttributes,
  LogAttributes
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<rust-service-name>', '<browser-service-name>')
ORDER BY Timestamp DESC
LIMIT 50
```

Expected rows depend on the exercised path:

- `browser.error`, `browser.unhandled_rejection`, or `react.render.error` only when browser errors occur
- `rust.error` only for Rust failures

Confirm all rows include the required resource attributes:

```sql
SELECT
  ServiceName,
  ResourceAttributes['service.version'] AS service_version,
  ResourceAttributes['service.instance.id'] AS service_instance_id,
  ResourceAttributes['deployment.environment.name'] AS environment
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<rust-service-name>', '<browser-service-name>')
LIMIT 20
```

Confirm this logs-only setup did not create Tauri traces:

```sql
SELECT
  Timestamp,
  ServiceName,
  SpanName
FROM traces
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<rust-service-name>', '<browser-service-name>')
LIMIT 20
```

Expected result: no new rows for these Tauri services.

## Troubleshooting

- No browser logs: verify `initBrowserTelemetry()` runs before app rendering, `get_telemetry_context` is registered, and `relay_telemetry` accepts `signal: 'logs'`.
- Browser relay failures: verify the browser exporter sends `records`, the Rust relay command emits them through `browser_logger.emit`, and the Rust OTel exporter is configured with the OTLP endpoint.
- Missing release version or session id: verify Rust creates one telemetry context at process startup and the browser uses `get_telemetry_context`.
- Unexpected telemetry volume: remove old web auto-instrumentation, IPC wrappers, HTTP timing helpers, request wrappers, metrics readers, React instrumentation plugins, and console monkey patches.
- `unknown_service` rows: verify both logger providers initialize with `service.name`.

## Safety Rules

- Never log auth tokens, request headers, request bodies, command arguments, local file contents, user text, tenant ids, or machine identifiers.
- Prefer event bodies and structured attributes over free-form log text.
- Keep Tauri telemetry low-cardinality. The session UUID belongs in `service.instance.id`; do not add it again as a log attribute.
