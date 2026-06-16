# Tauri Instrumentation

Use this rule for Tauri v2 apps that need error telemetry from both the Rust backend and the browser webview.

The webview cannot reach the collector directly, so Rust is an **OTLP passthrough proxy**: the browser runs normal OTel providers + exporters, serializes each batch to encoded OTLP, and hands the bytes to a Rust command that forwards them to the collector unchanged. **Rust must not decode, map, or rebuild browser telemetry.** Reconstructing log records or spans on the Rust side drops the log's trace context and leaves browser errors showing `Trace: N/A` in the UI — forwarding the encoded request verbatim preserves trace context, resource, scope, and severity, so errors stay linked to their traces.

Keep Rust's own backend telemetry (lifecycle, panics, sidecar) on its direct SDK exporter; only browser telemetry goes through the proxy.

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

Use the app's package manager for the browser dependencies. `@opentelemetry/otlp-transformer` provides the serializers that turn spans/logs into OTLP the proxy forwards; add `@opentelemetry/sdk-trace-base` if the browser emits spans:

```bash
pnpm add @opentelemetry/api @opentelemetry/api-logs @opentelemetry/core @opentelemetry/otlp-transformer @opentelemetry/resources @opentelemetry/sdk-logs @opentelemetry/sdk-trace-base @opentelemetry/semantic-conventions @tauri-apps/api
```

Use equivalent `npm install` or `yarn add` commands when the project does not use pnpm.

Rust dependencies. The proxy POSTs the forwarded bytes with an async HTTP client; the OTel deps remain for Rust's own backend telemetry:

```toml
[dependencies]
opentelemetry = { version = "0.30", features = ["logs"] }
opentelemetry_sdk = { version = "0.30", features = ["logs", "rt-tokio"] }
opentelemetry-otlp = { version = "0.30", features = ["http-proto", "logs", "reqwest-rustls", "reqwest-blocking-client"] }
opentelemetry-appender-tracing = "0.30"
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
serde = { version = "1", features = ["derive"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "registry"] }
uuid = { version = "1", features = ["v4", "serde"] }
```

## Runtime Configuration

Only Rust reads exporter configuration. The browser runs its own OTel providers (a `LoggerProvider`, plus a `TracerProvider` if it emits spans) with a custom exporter that serializes each batch to OTLP/JSON and calls `proxy_otlp`. Rust forwards the encoded bytes to `{endpoint}/v1/{signal}` with the configured headers, without parsing them. Rust's own backend telemetry still exports directly through its SDK.

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
) -> Result<(TelemetryGuard, OtlpProxy, TelemetryContext), Box<dyn std::error::Error + Send + Sync>> {
    // Rust's own telemetry exports directly through the SDK. Browser telemetry is
    // forwarded as opaque OTLP by proxy_otlp and never touches this pipeline.
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

    let proxy = OtlpProxy {
        target: Some(ProxyTarget {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            headers,
            client: reqwest::Client::new(),
        }),
    };

    Ok((
        TelemetryGuard {
            logger_provider: Some(logger_provider),
        },
        proxy,
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

## OTLP Passthrough Proxy

The Rust command is transport, not an application telemetry API. It receives an already-encoded OTLP request from the browser exporter and forwards the bytes to the collector. It validates the signal and size, attaches the configured headers, and POSTs — it never deserializes, maps, or rebuilds telemetry. This is what keeps trace context intact; a reconstruction path (re-emitting log records or rebuilding spans on the Rust side) loses it and produces `Trace: N/A`.

```rust
use reqwest::Client;
use std::collections::HashMap;
use tauri::State;

const MAX_OTLP_BODY_BYTES: usize = 4 * 1024 * 1024;

pub struct OtlpProxy {
    target: Option<ProxyTarget>, // None when telemetry is disabled
}

#[derive(Clone)]
struct ProxyTarget {
    endpoint: String,
    headers: HashMap<String, String>,
    client: Client,
}

#[tauri::command]
pub fn get_telemetry_context(
    context: State<'_, TelemetryContext>,
) -> Result<TelemetryContextResponse, String> {
    Ok(context.browser_response())
}

#[tauri::command]
pub async fn proxy_otlp(
    state: State<'_, OtlpProxy>,
    signal: String,
    body: String,
) -> Result<(), String> {
    if !matches!(signal.as_str(), "logs" | "traces" | "metrics") {
        return Err(format!("unsupported telemetry signal: {signal}"));
    }
    if body.len() > MAX_OTLP_BODY_BYTES {
        return Err(format!("otlp payload too large: {} bytes", body.len()));
    }

    // Clone out of managed state so nothing borrowed is held across the await.
    let Some(target) = state.target.clone() else {
        return Ok(());
    };

    let url = signal_endpoint(&target.endpoint, &signal);
    let mut request = target
        .client
        .post(&url)
        .header("content-type", "application/json")
        .body(body);
    for (name, value) in &target.headers {
        request = request.header(name, value);
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("collector returned {}", response.status()))
    }
}
```

OTLP/JSON is UTF-8 text, so `body` is passed as a string and POSTed with `content-type: application/json`. The Everr collector's OTLP/HTTP receiver accepts JSON; verify this in validation. The proxy only forwards to the Rust-resolved endpoint, never a URL from the renderer, and the ingest key stays server-side.

Custom commands registered with `invoke_handler` do not need extra Tauri permissions. Only Tauri core APIs, plugins, file system access, shell access, HTTP access, windows, and capabilities need permission entries.

## Tauri Builder

Initialize telemetry before app setup, manage the OTLP proxy state and telemetry context, register the commands, and flush on shutdown.

```rust
let telemetry_context = TelemetryContext::new("<release-version>", "<deployment-environment>");
let headers = ingest_headers_from_env();
let (telemetry_guard, otlp_proxy, telemetry_context) =
    init_telemetry(telemetry_context, "<otlp-url-from-status>", headers)
        .expect("telemetry init failed");

tauri::Builder::default()
    .manage(otlp_proxy)
    .manage(telemetry_context)
    .invoke_handler(tauri::generate_handler![
        get_telemetry_context,
        proxy_otlp,
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

The exporter serializes each batch to OTLP/JSON with `@opentelemetry/otlp-transformer` and hands the bytes to `proxy_otlp`. No body allowlist, no attribute mapping — the encoded request carries the log's body, severity, attributes, and (critically) its `trace_id`/`span_id`. The same pattern backs a `TracerProvider` if the app emits spans.

```ts
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import {
  JsonLogsSerializer,
  JsonTraceSerializer,
} from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { logs } from '@opentelemetry/api-logs';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { invoke } from '@tauri-apps/api/core';

type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
};

const decoder = new TextDecoder();

async function proxyOtlp(
  signal: 'logs' | 'traces',
  payload: Uint8Array | undefined,
  done: (result: ExportResult) => void,
) {
  if (!payload || payload.length === 0) {
    done({ code: ExportResultCode.SUCCESS });
    return;
  }
  try {
    // OTLP/JSON is UTF-8 text; pass it as a string and Rust POSTs it verbatim.
    await invoke('proxy_otlp', { signal, body: decoder.decode(payload) });
    done({ code: ExportResultCode.SUCCESS });
  } catch (error) {
    done({ code: ExportResultCode.FAILED, error: error as Error });
  }
}

class OtlpProxyLogExporter implements LogRecordExporter {
  export(records: ReadableLogRecord[], done: (result: ExportResult) => void) {
    void proxyOtlp('logs', JsonLogsSerializer.serializeRequest(records), done);
  }
  async shutdown() {}
  async forceFlush() {}
}

class OtlpProxySpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], done: (result: ExportResult) => void) {
    void proxyOtlp('traces', JsonTraceSerializer.serializeRequest(spans), done);
  }
  async shutdown() {}
}

let loggerProvider: LoggerProvider | null = null;

export async function initBrowserTelemetry() {
  const context = await invoke<TelemetryContext>('get_telemetry_context');
  const batch = {
    maxQueueSize: 100,
    maxExportBatchSize: 32,
    scheduledDelayMillis: 5_000,
    exportTimeoutMillis: 30_000,
  };

  loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: context.serviceName,
      'service.version': context.serviceVersion,
      'service.instance.id': context.serviceInstanceId,
      'deployment.environment.name': context.deploymentEnvironment,
    }),
    processors: [
      new BatchLogRecordProcessor(new OtlpProxyLogExporter(), batch),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  // If the app emits spans, register a TracerProvider the same way with a
  // BatchSpanProcessor(new OtlpProxySpanExporter(), batch) and
  // trace.setGlobalTracerProvider(...). Emit error logs inside the span's
  // context so the relayed log carries trace_id/span_id and links in the UI.
}

export function shutdownBrowserTelemetry() {
  return loggerProvider?.shutdown();
}
```

> Capture the actual errors however the app already does (`@everr/auto-otel-errors/browser` or hand-rolled `window`/React handlers below) and emit them through this `LoggerProvider`. The proxy forwards whatever OTel the providers produce, so the capture layer is independent of the transport.

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

Expected rows depend on the exercised path: browser error logs under `<browser-service-name>` only when browser errors occur, and `rust.error` only for Rust failures. Because the proxy forwards the renderer's own OTLP, browser telemetry carries the **renderer's** resource, so it lands under `<browser-service-name>` (not the Rust service name).

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

A Rust-side change (the proxy command, headers, endpoint) needs a full app rebuild — a JS reload is not enough. If the app emits an error-context span, confirm the error log links to it (the fix for `Trace: N/A` — the log carries trace context natively through the forwarded OTLP, nothing reconstructs it):

```sql
SELECT
  l.Body AS log_body,
  l.TraceId AS log_trace,
  t.TraceId AS span_trace,
  t.SpanName AS span
FROM logs l
LEFT JOIN traces t ON l.TraceId = t.TraceId
WHERE l.Timestamp > now() - INTERVAL 15 MINUTE
  AND l.ServiceName = '<browser-service-name>'
  AND notEmpty(l.TraceId)
ORDER BY l.Timestamp DESC
LIMIT 20
```

`log_trace` must be non-empty and equal `span_trace`. Empty `log_trace` means trace context was lost — the renderer must emit the log inside the span's context, and the proxy must forward the encoded request verbatim (reconstructing records in Rust strips it).

## Troubleshooting

- No browser logs: verify `initBrowserTelemetry()` runs before app rendering, the global providers are set before capture starts, `get_telemetry_context` is registered, and `proxy_otlp` accepts the `signal`.
- Proxy failures: verify the browser exporter serializes OTLP/JSON and passes it as `body`, and that `proxy_otlp` POSTs to `{endpoint}/v1/{signal}` with `content-type: application/json` (confirm the collector accepts OTLP/JSON).
- Error shows `Trace: N/A`: trace context was lost. Do not reconstruct records in Rust — forward the encoded OTLP verbatim; emit the log inside the span context so the serialized request carries `trace_id`/`span_id`.
- Missing release version or session id: verify Rust creates one telemetry context at process startup and the browser uses `get_telemetry_context`.
- Unexpected telemetry volume: remove old web auto-instrumentation, IPC wrappers, HTTP timing helpers, request wrappers, metrics readers, React instrumentation plugins, and console monkey patches.
- `unknown_service` rows: verify both logger providers initialize with `service.name`.

## Safety Rules

- Never log auth tokens, request headers, request bodies, command arguments, local file contents, user text, tenant ids, or machine identifiers.
- Prefer event bodies and structured attributes over free-form log text.
- Keep Tauri telemetry low-cardinality. The session UUID belongs in `service.instance.id`; do not add it again as a log attribute.
