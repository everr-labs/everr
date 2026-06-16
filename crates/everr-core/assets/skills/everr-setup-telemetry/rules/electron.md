# Electron Instrumentation

Use this rule for Electron apps that need error telemetry from both the Node main process and the Chromium renderer.

An Electron app has three contexts: the **main** process (Node), the **renderer** (Chromium, sandboxed), and the **preload** script (the bridge). The renderer should not hold the ingest key or reach the collector directly, so the main process is an **OTLP passthrough proxy**: the renderer runs normal OTel providers + exporters, serializes each batch to encoded OTLP, and sends the bytes to the main process over IPC, which forwards them to the collector unchanged. **The main process must not decode, map, or rebuild renderer telemetry** — forwarding the encoded request verbatim preserves the resource, scope, severity, and attributes the renderer produced; reconstructing records loses that fidelity for no benefit.

The main process is itself a Node process: set up its own telemetry and error capture per `nodejs.md` (`@everr/auto-otel-errors/node`), and reuse that exporter config to drive the proxy.

This rule is app-agnostic. Resolve concrete values from the app before editing code. Use placeholders in plans until the values are known:

- `<main-service-name>`
- `<renderer-service-name>`
- `<release-version>`
- `<deployment-environment>`
- `<otlp-url-from-status>`

## Resource Attributes

The main process owns the per-process session UUID and release version. The renderer gets that context from the main process over IPC so both sides share the same session identity.

Required resource attributes on both main and renderer telemetry:

- `service.name`
- `service.version`
- `service.instance.id`
- `deployment.environment.name`

Use `service.instance.id` as an opaque process/session UUID generated at app startup. Do not use an auth session, user id, machine id, tenant id, or token. Choose a stable backend name for the main process (`<main-service-name>`) and a related frontend name for the renderer (`<renderer-service-name>`).

## Package Setup

Renderer dependencies — `@opentelemetry/otlp-transformer` provides the serializers that turn spans/logs into OTLP the proxy forwards; add `@opentelemetry/sdk-trace-base` if the renderer emits spans:

```bash
npm install @everr/auto-otel-errors @opentelemetry/api @opentelemetry/api-logs @opentelemetry/core @opentelemetry/otlp-transformer @opentelemetry/resources @opentelemetry/sdk-logs @opentelemetry/sdk-trace-base @opentelemetry/semantic-conventions
```

Main-process dependencies are the Node setup from `nodejs.md` (`@everr/auto-otel-errors @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node` and the OTLP exporters). The proxy itself needs no extra package — it POSTs with Electron's `net` module.

## Runtime Configuration

Only the main process reads exporter configuration. The renderer runs its own OTel providers (a `LoggerProvider`, plus a `TracerProvider` if it emits spans) with a custom exporter that serializes each batch to OTLP/JSON and calls the preload-exposed `proxyOtlp`. The main process forwards the encoded bytes to `{endpoint}/v1/{signal}` with the configured headers, without parsing them. The main process's own telemetry exports directly through its SDK.

```bash
# Local development
OTEL_EXPORTER_OTLP_ENDPOINT=<otlp-url-from-status>

# Production with Everr hosted ingest
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.everr.dev/
EVERR_INGEST_KEY=<secret-manager-reference>
```

## Main Process: Telemetry Context And Proxy

Create one telemetry context at startup, set up the main-process SDK + error capture (per `nodejs.md`), and register the IPC handlers. The `everr:proxy-otlp` handler is transport, not an application telemetry API: it validates the signal and size, attaches the configured headers, and POSTs the bytes. It never deserializes or rebuilds telemetry.

```ts
// main/telemetry.ts
import { randomUUID } from 'node:crypto';
import { ipcMain, net } from 'electron';
import { init as initErrorTracking } from '@everr/auto-otel-errors/node';
// ... plus the NodeSDK setup from nodejs.md ...

const MAIN_SERVICE_NAME = '<main-service-name>';
const RENDERER_SERVICE_NAME = '<renderer-service-name>';
const MAX_OTLP_BODY_BYTES = 4 * 1024 * 1024;

type TelemetryConfig = { endpoint: string; headers: Record<string, string> } | null;

export type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
};

export function setupMainTelemetry(): TelemetryContext {
  const context: TelemetryContext = {
    serviceName: RENDERER_SERVICE_NAME, // resource the renderer should use
    serviceVersion: app.getVersion(),
    serviceInstanceId: randomUUID(),
    deploymentEnvironment: app.isPackaged ? 'production' : 'development',
  };

  // Main-process SDK (MAIN_SERVICE_NAME resource) + error capture, per nodejs.md.
  startMainSdk(context);
  initErrorTracking();

  registerTelemetryIpc(resolveTelemetryConfig(process.env), context);
  return context;
}

function registerTelemetryIpc(config: TelemetryConfig, context: TelemetryContext) {
  ipcMain.handle('everr:telemetry-context', () => context);

  ipcMain.handle('everr:proxy-otlp', async (_event, signal: string, body: string) => {
    if (!config) return; // telemetry disabled
    if (!['logs', 'traces', 'metrics'].includes(signal)) {
      throw new Error(`unsupported telemetry signal: ${signal}`);
    }
    if (body.length > MAX_OTLP_BODY_BYTES) {
      throw new Error(`otlp payload too large: ${body.length} bytes`);
    }

    // net.fetch respects the app's proxy/cert configuration. OTLP/JSON is UTF-8
    // text, so body is forwarded as-is with content-type application/json.
    const response = await net.fetch(signalUrl(config.endpoint, signal), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...config.headers },
      body,
    });
    if (!response.ok) {
      throw new Error(`collector returned ${response.status}`);
    }
  });
}

function signalUrl(endpoint: string, signal: string) {
  const base = endpoint.replace(/\/+$/, '');
  return base.endsWith(`/v1/${signal}`) ? base : `${base}/v1/${signal}`;
}
```

`resolveTelemetryConfig` reads `OTEL_EXPORTER_OTLP_ENDPOINT` and, for production, `EVERR_INGEST_KEY` → `Authorization: Bearer <key>` — exactly as in `nodejs.md`. The Everr collector's OTLP/HTTP receiver accepts `application/json`; verify in validation.

## Preload Bridge

With `contextIsolation: true` and `nodeIntegration: false` (required), expose only a narrow telemetry API through `contextBridge`. Never expose `ipcRenderer` itself or the ingest key to the renderer.

```ts
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('everrTelemetry', {
  getContext: () => ipcRenderer.invoke('everr:telemetry-context'),
  proxyOtlp: (signal: 'logs' | 'traces' | 'metrics', body: string) =>
    ipcRenderer.invoke('everr:proxy-otlp', signal, body),
});
```

```ts
// renderer global type
declare global {
  interface Window {
    everrTelemetry: {
      getContext(): Promise<TelemetryContext>;
      proxyOtlp(signal: 'logs' | 'traces' | 'metrics', body: string): Promise<void>;
    };
  }
}
```

## Renderer Exporters

The exporter serializes each batch to OTLP/JSON with `@opentelemetry/otlp-transformer` and hands the bytes to `window.everrTelemetry.proxyOtlp`. No body allowlist, no attribute mapping — the encoded request carries the log's body, severity, and attributes. The same pattern backs a `TracerProvider` if the app emits spans.

```ts
import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import { JsonLogsSerializer, JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

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
    await window.everrTelemetry.proxyOtlp(signal, decoder.decode(payload));
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

export async function initRendererTelemetry() {
  const context = await window.everrTelemetry.getContext();
  const batch = { maxQueueSize: 100, maxExportBatchSize: 32, scheduledDelayMillis: 5_000, exportTimeoutMillis: 30_000 };

  const loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: context.serviceName,
      'service.version': context.serviceVersion,
      'service.instance.id': context.serviceInstanceId,
      'deployment.environment.name': context.deploymentEnvironment,
    }),
    processors: [new BatchLogRecordProcessor(new OtlpProxyLogExporter(), batch)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  // If the renderer emits spans, register a TracerProvider the same way with a
  // BatchSpanProcessor(new OtlpProxySpanExporter(), batch) and
  // trace.setGlobalTracerProvider(...) before capture starts.
}
```

## Renderer Error Capture

Capture renderer errors with `@everr/auto-otel-errors/browser` (and `/react` for React), emitting through the `LoggerProvider` above. Set the global providers, then call `init()`:

```ts
import { init as initErrorTracking } from '@everr/auto-otel-errors/browser';

await initRendererTelemetry();
initErrorTracking();
```

`init()` installs the `window` `error`/`unhandledrejection` handlers and exposes `captureError` for manual capture. Do not also register your own `window` error listeners — that double-captures. Wrap React apps with `ErrorBoundary` from `@everr/auto-otel-errors/react`.

## Native Crashes

The library's JS handlers cannot see native crashes. In the main process, log renderer/child-process crashes through the main OTel logger, and enable `crashReporter` if you need native minidumps:

```ts
app.on('render-process-gone', (_event, _webContents, details) => {
  // emit an OTel log: event.name 'electron.render_process_gone', reason details.reason
});
app.on('child-process-gone', (_event, details) => {
  // emit an OTel log: event.name 'electron.child_process_gone', type/reason from details
});
```

## Validation

A main-process change (proxy handler, headers, endpoint) needs an app restart. Trigger each error mechanism — add a dev-only menu item or button that throws an uncaught error, rejects a promise, and calls `captureError` — then query.

Renderer telemetry carries the renderer's resource, so it lands under `<renderer-service-name>` (not the main service name). Recent logs:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body,
       LogAttributes['exception.mechanism'] AS mechanism, TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<main-service-name>', '<renderer-service-name>')
ORDER BY Timestamp DESC
LIMIT 50
```

## Troubleshooting

- No renderer logs: verify `initRendererTelemetry()` runs before capture, the global providers are set before `initErrorTracking()`, the preload exposes `everrTelemetry`, and the `everr:proxy-otlp` handler is registered.
- Proxy failures: verify the renderer serializes OTLP/JSON and passes it as `body`, and that `everr:proxy-otlp` POSTs to `{endpoint}/v1/{signal}` with `content-type: application/json` (confirm the collector accepts OTLP/JSON).
- Each error captured twice: the library's handlers are running alongside leftover hand-rolled `window`/`process` error handlers. Remove the hand-rolled ones.
- `everrTelemetry` is undefined in the renderer: the preload script is not wired to the `BrowserWindow` (`webPreferences.preload`), or `contextIsolation` is off.

## Safety Rules

- Keep `contextIsolation: true` and `nodeIntegration: false`. Expose only the narrow telemetry API through `contextBridge`; never expose `ipcRenderer` or the ingest key to the renderer.
- The `everr:proxy-otlp` handler forwards only to the main-resolved endpoint, never a URL from the renderer. Validate the signal and cap the body size.
- Never log auth tokens, request headers, request bodies, local file contents, user text, tenant ids, or machine identifiers.
- Keep `service.instance.id` as the session UUID; do not also add it as a log attribute.
