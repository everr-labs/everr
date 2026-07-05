# Tauri Instrumentation

Use this rule for Tauri v2 apps that need telemetry from both the Rust backend and the browser webview.

The webview cannot reach the collector directly, so Rust is an **OTLP passthrough proxy**: the browser runs normal OTel providers + exporters, serializes each batch to encoded OTLP, and hands the bytes to a Rust command that forwards them to the collector unchanged. **Rust must not decode, map, or rebuild browser telemetry.** Forwarding the encoded request verbatim preserves the resource, scope, severity, and attributes the renderer produced; reconstructing records on the Rust side loses that fidelity for no benefit.

The Rust backend is itself a Rust process: set up its own telemetry per `rust.md` and error tracking per `error-tracking.md`, and reuse that exporter config (endpoint + headers) to drive the proxy. Only browser telemetry goes through the proxy; Rust's own logs, traces, and metrics export directly through its SDK.

This rule is app-agnostic. Resolve concrete service names, release version, environment, and endpoint from the app before editing code. Use placeholders in plans until the values are known:

- `<rust-service-name>`
- `<browser-service-name>`
- `<release-version>`
- `<deployment-environment>`
- `<otlp-url-from-status>`

## Resource Attributes

Rust owns the per-process app session UUID and release version. The browser must get that context from Rust through a Tauri command so both sides share the same session identity.

Required resource attributes on both Rust and browser telemetry:

- `service.name`
- `service.version`
- `service.instance.id`
- `deployment.environment.name`

Use `service.instance.id` as an opaque process/session UUID generated at app startup. Do not use an auth session, user id, machine id, tenant id, or token.

Choose service names from the app, not from this rule. Use a stable backend name for Rust and a related frontend name for the browser, for example:

- Rust: `<rust-service-name>`
- Browser: `<browser-service-name>`

## Package Setup

Browser dependencies. `@opentelemetry/otlp-transformer` provides the serializers that turn each signal into OTLP the proxy forwards:

```bash
pnpm add @everr/auto-otel-errors @opentelemetry/api @opentelemetry/api-logs @opentelemetry/core @opentelemetry/otlp-transformer @opentelemetry/resources @opentelemetry/sdk-logs @opentelemetry/sdk-trace-base @opentelemetry/sdk-metrics @opentelemetry/semantic-conventions @tauri-apps/api
```

Use equivalent `npm install` or `yarn add` commands when the project does not use pnpm.

Rust dependencies. The OpenTelemetry crates come from `rust.md` (they drive the backend's own telemetry). The proxy delta only adds an async HTTP client, serde for the command response, and a UUID for the session id:

```toml
# Plus the OpenTelemetry crates from rust.md.
[dependencies]
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
serde = { version = "1", features = ["derive"] }
uuid = { version = "1", features = ["v4"] }
```

## Runtime Configuration

Only Rust reads exporter configuration (per `rust.md`). The browser runs its own OTel providers (`LoggerProvider`, `TracerProvider`, `MeterProvider`) with custom exporters that serialize each batch to OTLP/JSON and call `proxy_otlp`. Rust forwards the encoded bytes to `{endpoint}/v1/{signal}` with the configured headers, without parsing them.

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

The only Tauri-specific Rust state is the shared session context. Generate the session UUID once at startup, build the resource the `rust.md` setup uses for the backend SDK, and return the same values to the browser through a command so both sides share `service.instance.id`.

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

    /// Pass this into the rust.md setup so the backend SDK and the browser
    /// share the same session identity. Extend rust.md's `resource()` to merge
    /// these attributes onto the hardcoded `service.name`.
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

## OTLP Passthrough Proxy

The Rust command is transport, not an application telemetry API. It receives an already-encoded OTLP request from a browser exporter and forwards the bytes to the collector. It validates the signal and size, attaches the configured headers, and POSTs — it never deserializes, maps, or rebuilds telemetry. The proxy only forwards to the Rust-resolved endpoint, never a URL from the renderer, and the ingest key stays server-side.

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

impl OtlpProxy {
    /// Build from the same endpoint + headers the rust.md setup resolves.
    pub fn new(endpoint: &str, headers: HashMap<String, String>) -> Self {
        Self {
            target: Some(ProxyTarget {
                endpoint: endpoint.trim_end_matches('/').to_string(),
                headers,
                client: Client::new(),
            }),
        }
    }

    pub fn disabled() -> Self {
        Self { target: None }
    }
}

fn signal_endpoint(base_endpoint: &str, signal: &str) -> String {
    let endpoint = base_endpoint.trim_end_matches('/');
    if endpoint.ends_with(&format!("/v1/{signal}")) {
        endpoint.to_string()
    } else {
        format!("{endpoint}/v1/{signal}")
    }
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

OTLP/JSON is UTF-8 text, so `body` is passed as a string and POSTed with `content-type: application/json`. The Everr collector's OTLP/HTTP receiver accepts JSON; verify this in validation.

Custom commands registered with `invoke_handler` do not need extra Tauri permissions. Only Tauri core APIs, plugins, file system access, shell access, HTTP access, windows, and capabilities need permission entries.

## Tauri Builder

Resolve the exporter endpoint + headers once, drive the `rust.md` backend setup and the proxy from the same values, manage the proxy and context, register the commands, and flush on shutdown.

```rust
// Resolve once; the same values drive backend telemetry and the proxy.
let endpoint = resolve_otlp_endpoint();   // OTEL_EXPORTER_OTLP_ENDPOINT (or hosted ingest)
let headers = ingest_headers_from_env();  // EVERR_INGEST_KEY -> Authorization: Bearer <key>

let telemetry_context = TelemetryContext::new("<release-version>", "<deployment-environment>");

// Backend telemetry via rust.md, using the shared resource so the session id matches.
let telemetry_guard =
    telemetry_setup::init_telemetry(telemetry_context.resource(), &endpoint, &headers)
        .expect("telemetry init failed");

let otlp_proxy = OtlpProxy::new(&endpoint, headers);

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

Keep `ingest_headers_from_env()` server-side. If exporting to Everr hosted ingest, it reads `EVERR_INGEST_KEY` and returns `Authorization: Bearer <key>`. When no endpoint resolves, use `OtlpProxy::disabled()` and the `rust.md` setup's disabled path.

## Rust Backend Errors

Capture Rust backend failures and panics per `error-tracking.md` and `rust.md`'s "Errors And Panics": emit one structured exception event at the failing boundary, and install a panic hook that emits a redacted event with `error.handled=false` before delegating to the previous hook. Do not log Tauri command arguments, auth tokens, request headers, request bodies, local file contents, paths from file dialogs, or user-entered text.

## Browser Exporters

Each exporter serializes its batch to OTLP/JSON with `@opentelemetry/otlp-transformer` and hands the bytes to `proxy_otlp`. No body allowlist, no attribute mapping — the encoded request carries the signal's body, severity, and attributes.

```ts
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import {
  JsonLogsSerializer,
  JsonMetricsSerializer,
  JsonTraceSerializer,
} from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { logs } from "@opentelemetry/api-logs";
import { metrics, trace } from "@opentelemetry/api";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import {
  BatchSpanProcessor,
  BasicTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { invoke } from "@tauri-apps/api/core";

type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
};

type Signal = "logs" | "traces" | "metrics";

const decoder = new TextDecoder();

async function proxyOtlp(
  signal: Signal,
  payload: Uint8Array | undefined,
  done: (result: ExportResult) => void,
) {
  if (!payload || payload.length === 0) {
    done({ code: ExportResultCode.SUCCESS });
    return;
  }
  try {
    // OTLP/JSON is UTF-8 text; pass it as a string and Rust POSTs it verbatim.
    await invoke("proxy_otlp", { signal, body: decoder.decode(payload) });
    done({ code: ExportResultCode.SUCCESS });
  } catch (error) {
    done({ code: ExportResultCode.FAILED, error: error as Error });
  }
}

class OtlpProxyLogExporter implements LogRecordExporter {
  export(records: ReadableLogRecord[], done: (result: ExportResult) => void) {
    void proxyOtlp("logs", JsonLogsSerializer.serializeRequest(records), done);
  }
  async shutdown() {}
  async forceFlush() {}
}

class OtlpProxySpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], done: (result: ExportResult) => void) {
    void proxyOtlp("traces", JsonTraceSerializer.serializeRequest(spans), done);
  }
  async shutdown() {}
}

class OtlpProxyMetricExporter implements PushMetricExporter {
  export(data: ResourceMetrics, done: (result: ExportResult) => void) {
    void proxyOtlp("metrics", JsonMetricsSerializer.serializeRequest(data), done);
  }
  selectAggregationTemporality() {
    return AggregationTemporality.DELTA;
  }
  async forceFlush() {}
  async shutdown() {}
}

let loggerProvider: LoggerProvider | null = null;
let tracerProvider: BasicTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;

export async function initBrowserTelemetry() {
  const context = await invoke<TelemetryContext>("get_telemetry_context");
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: context.serviceName,
    "service.version": context.serviceVersion,
    "service.instance.id": context.serviceInstanceId,
    "deployment.environment.name": context.deploymentEnvironment,
  });
  const batch = {
    maxQueueSize: 100,
    maxExportBatchSize: 32,
    scheduledDelayMillis: 5_000,
    exportTimeoutMillis: 30_000,
  };

  loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(new OtlpProxyLogExporter(), batch)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OtlpProxySpanExporter(), batch)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OtlpProxyMetricExporter(),
        exportIntervalMillis: 30_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
}

export async function shutdownBrowserTelemetry() {
  await Promise.allSettled([
    loggerProvider?.shutdown(),
    tracerProvider?.shutdown(),
    meterProvider?.shutdown(),
  ]);
}
```

## Browser Error Capture

Capture renderer errors with `@everr/auto-otel-errors/browser` (and `/react` for React), emitting through the providers above. Set the global providers, then call `init()`:

```ts
import { init as initErrorTracking } from "@everr/auto-otel-errors/browser";

await initBrowserTelemetry();
initErrorTracking();
```

`init()` installs the `window` `error`/`unhandledrejection` handlers and exposes `captureError` for manual capture. Do not also register your own `window` error listeners — that double-captures. Wrap React apps with `ErrorBoundary` from `@everr/auto-otel-errors/react`.

Flush on exit so buffered batches are sent:

```ts
window.addEventListener("beforeunload", () => {
  void shutdownBrowserTelemetry();
});
```

## Validation

After rebuilding and running the app, query recent telemetry by the resolved service names. Because the proxy forwards the renderer's own OTLP, browser telemetry carries the **renderer's** resource, so it lands under `<browser-service-name>` (not the Rust service name).

Recent logs:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body, ResourceAttributes, LogAttributes
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<rust-service-name>', '<browser-service-name>')
ORDER BY Timestamp DESC
LIMIT 50
```

Recent spans and metrics (confirm both sides export all signals):

```sql
SELECT Timestamp, ServiceName, SpanName, TraceId
FROM traces
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<rust-service-name>', '<browser-service-name>')
ORDER BY Timestamp DESC
LIMIT 50;

SELECT MetricName, ServiceName, max(TimeUnix) AS last_seen
FROM metrics_sum
WHERE TimeUnix > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<rust-service-name>', '<browser-service-name>')
GROUP BY MetricName, ServiceName
ORDER BY last_seen DESC
LIMIT 50
```

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

A Rust-side change (the proxy command, headers, endpoint, backend setup) needs a full app rebuild — a JS reload is not enough.

## Troubleshooting

- No browser telemetry: verify `initBrowserTelemetry()` runs before capture, the global providers are set before `initErrorTracking()`, `get_telemetry_context` is registered, and `proxy_otlp` accepts the `signal`.
- Proxy failures: verify the browser exporter serializes OTLP/JSON and passes it as `body`, and that `proxy_otlp` POSTs to `{endpoint}/v1/{signal}` with `content-type: application/json` (confirm the collector accepts OTLP/JSON).
- Each error captured twice: the library's handlers are running alongside leftover hand-rolled `window` error handlers. Remove the hand-rolled ones.
- Missing release version or session id: verify Rust creates one telemetry context at process startup, passes `context.resource()` into the backend setup, and the browser uses `get_telemetry_context`.
- `unknown_service` rows: verify the backend resource and the browser providers all initialize with `service.name`.

## Safety Rules

- Never log auth tokens, request headers, request bodies, command arguments, local file contents, user text, tenant ids, or machine identifiers.
- Prefer event bodies and structured attributes over free-form log text.
- Keep Tauri telemetry low-cardinality. The session UUID belongs in `service.instance.id`; do not add it again as a log attribute.
