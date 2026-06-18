# Electron Instrumentation

Use this rule for Electron apps that need error telemetry from both the Node main process and the Chromium renderer.

An Electron app has three contexts: the **main** process (Node), the **renderer** (Chromium, sandboxed), and the **preload** script (the bridge). The renderer should not hold the ingest key or reach the collector directly, so the main process is an **OTLP passthrough proxy**: the renderer runs a normal OTel provider + exporter, serializes each log batch to encoded OTLP, and sends the bytes to the main process over IPC, which forwards them to the collector unchanged.

The main process is itself a Node process: set up its own telemetry and error capture per `nodejs.md` (`@everr/auto-otel-errors/node`), and reuse that exporter config to drive the proxy.

This rule is app-agnostic. Resolve concrete values from the app before editing code. Use placeholders in plans until the values are known:

- `<service-name>`
- `<release-version>`
- `<deployment-environment>`
- `<otlp-url-from-status>`

## Resource Attributes

The main process owns the per-app session UUID and release version. The renderer gets that context from the main process over IPC so both sides share the same session identity.

Required resource attributes on both main and renderer telemetry:

- `service.name`
- `service.version`
- `service.instance.id`
- `deployment.environment.name`
- `process.type`

Hardcode one stable `service.name` for the app (`<service-name>`) and use `process.type` (`main` or `renderer`) to distinguish where telemetry came from. The `nodejs.md` base setup does not add `process.type`, so the main SDK must add it to its resource explicitly (`process.type = main`); the renderer adds `process.type = renderer` to its own resource. Use `service.instance.id` as an opaque app/session UUID generated at app startup. Do not use an auth session, user id, machine id, tenant id, or token.

## Package Setup

Renderer dependencies — `@opentelemetry/otlp-transformer` provides the serializer that turns logs into OTLP the proxy forwards:

```bash
npm install @everr/auto-otel-errors @opentelemetry/api @opentelemetry/api-logs @opentelemetry/core @opentelemetry/otlp-transformer @opentelemetry/resources @opentelemetry/sdk-logs @opentelemetry/semantic-conventions
```

Main-process dependencies are the Node setup from `nodejs.md` (`@everr/auto-otel-errors @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node` and the OTLP exporters). The proxy itself needs no extra package — it POSTs with Electron's `net` module.

## Runtime Configuration

Only the main process reads exporter configuration. The renderer runs its own `LoggerProvider` with a custom exporter that serializes each log batch to OTLP/JSON and calls the preload-exposed `proxyOtlpLogs`. The main process forwards the encoded bytes to `{endpoint}/v1/logs` with the configured headers. The main process's own telemetry exports directly through its SDK.

```bash
# Local development
OTEL_EXPORTER_OTLP_ENDPOINT=<otlp-url-from-status>

# Production with Everr hosted ingest
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.everr.dev/
EVERR_INGEST_KEY=<secret-manager-reference>
```

## Main Process: Telemetry Context And Proxy

Create one telemetry context at startup, set up the main-process SDK + error capture (per `nodejs.md`), and register the IPC handlers. The `everr:proxy-otlp-logs` handler is transport, not an application telemetry API: it validates the payload size, attaches the configured headers, and POSTs the bytes. It never deserializes or rebuilds telemetry.

```ts
// main/telemetry.ts
import { randomUUID } from 'node:crypto';
import { app, ipcMain, net } from 'electron';
import { init as initErrorTracking } from '@everr/auto-otel-errors/node';
// ... plus the NodeSDK setup from nodejs.md ...

const SERVICE_NAME = '<service-name>';
const MAX_OTLP_BODY_BYTES = 4 * 1024 * 1024;

type TelemetryConfig = { endpoint: string; headers: Record<string, string> } | null;
type ProcessType = 'main' | 'renderer';

export type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
  processType: ProcessType;
};

export function setupMainTelemetry(): void {
  const baseContext = {
    serviceName: SERVICE_NAME,
    serviceVersion: app.getVersion(),
    serviceInstanceId: randomUUID(),
    deploymentEnvironment: app.isPackaged ? 'production' : 'development',
  };

  // Main-process SDK uses the nodejs.md NodeSDK setup with SERVICE_NAME, and must
  // add process.type = main to its resource (nodejs.md does not add it by default).
  startMainSdk({ ...baseContext, processType: 'main' });
  initErrorTracking();

  const rendererContext: TelemetryContext = {
    ...baseContext,
    processType: 'renderer',
  };
  registerTelemetryIpc(resolveTelemetryConfig(process.env), rendererContext);
}

function registerTelemetryIpc(config: TelemetryConfig, context: TelemetryContext) {
  ipcMain.handle('everr:telemetry-context', () => context);

  ipcMain.handle('everr:proxy-otlp-logs', async (_event, body: string) => {
    if (!config) return; // telemetry disabled
    if (body.length > MAX_OTLP_BODY_BYTES) {
      throw new Error(`otlp payload too large: ${body.length} bytes`);
    }

    // net.fetch respects the app's proxy/cert configuration. OTLP/JSON is UTF-8
    // text, so body is forwarded as-is with content-type application/json.
    const response = await net.fetch(logsUrl(config.endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...config.headers },
      body,
    });
    if (!response.ok) {
      throw new Error(`collector returned ${response.status}`);
    }
  });
}

function logsUrl(endpoint: string) {
  const base = endpoint.replace(/\/+$/, '');
  return base.endsWith('/v1/logs') ? base : `${base}/v1/logs`;
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
  proxyOtlpLogs: (body: string) =>
    ipcRenderer.invoke('everr:proxy-otlp-logs', body),
});
```

```ts
// renderer global type
declare global {
  interface Window {
    everrTelemetry: {
      getContext(): Promise<TelemetryContext>;
      proxyOtlpLogs(body: string): Promise<void>;
    };
  }
}
```

## Renderer Exporters

The exporter serializes each log batch to OTLP/JSON with `@opentelemetry/otlp-transformer` and hands the bytes to `window.everrTelemetry.proxyOtlpLogs`. No body allowlist, no attribute mapping — the encoded request carries the log's body, severity, and attributes.

```ts
import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import { JsonLogsSerializer } from '@opentelemetry/otlp-transformer';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const decoder = new TextDecoder();

async function proxyLogs(payload: Uint8Array, done: (result: ExportResult) => void) {
  try {
    await window.everrTelemetry.proxyOtlpLogs(decoder.decode(payload));
    done({ code: ExportResultCode.SUCCESS });
  } catch (error) {
    done({ code: ExportResultCode.FAILED, error: error as Error });
  }
}

class OtlpProxyLogExporter implements LogRecordExporter {
  export(records: ReadableLogRecord[], done: (result: ExportResult) => void) {
    void proxyLogs(JsonLogsSerializer.serializeRequest(records), done);
  }
  async shutdown() {}
  async forceFlush() {}
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
      'process.type': context.processType,
    }),
    processors: [new BatchLogRecordProcessor(new OtlpProxyLogExporter(), batch)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
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

## Validation

A main-process change (proxy handler, headers, endpoint) needs an app restart. Trigger each error mechanism — add a dev-only menu item or button that throws an uncaught error, rejects a promise, and calls `captureError` — then query.

Renderer telemetry carries `process.type = renderer`; main-process telemetry carries `process.type = main`. Recent logs:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body,
       LogAttributes['process.type'] AS process_type,
       LogAttributes['exception.mechanism'] AS mechanism,
       TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
ORDER BY Timestamp DESC
LIMIT 50
```

## Troubleshooting

- No renderer logs: verify `initRendererTelemetry()` runs before capture, the global providers are set before `initErrorTracking()`, the preload exposes `everrTelemetry`, and the `everr:proxy-otlp-logs` handler is registered.
- Proxy failures: verify the renderer serializes OTLP/JSON and passes it as `body`, and that `everr:proxy-otlp-logs` POSTs to `{endpoint}/v1/logs` with `content-type: application/json` (confirm the collector accepts OTLP/JSON).
- Each error captured twice: the library's handlers are running alongside leftover hand-rolled `window`/`process` error handlers. Remove the hand-rolled ones.
- `everrTelemetry` is undefined in the renderer: the preload script is not wired to the `BrowserWindow` (`webPreferences.preload`), or `contextIsolation` is off.

## Safety Rules

- Keep `contextIsolation: true` and `nodeIntegration: false`. Expose only the narrow telemetry API through `contextBridge`; never expose `ipcRenderer` or the ingest key to the renderer.
- Never log auth tokens, request headers, request bodies, local file contents, user text, tenant ids, or machine identifiers.
