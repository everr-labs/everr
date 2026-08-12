# Electron Instrumentation

Use this rule for Electron apps that need error telemetry from both the Node main process and the Chromium renderer.

The renderer should not hold the ingest key or reach the collector directly, so the main process is an **OTLP passthrough proxy**: the renderer runs `@everr/otel-web`, which builds each OTLP/JSON batch itself (no OpenTelemetry packages, no provider, no exporter) and hands the bytes to the main process over IPC, which forwards them to the collector unchanged.

The main process is itself a Node process: set up its own telemetry and error capture per `nodejs.md` (`@everr/otel-errors`), and reuse that exporter config to drive the proxy.

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

Renderer dependencies:

```bash
npm install @everr/otel-web
```

That is the whole renderer dependency list: the SDK builds OTLP itself, so the renderer carries no OpenTelemetry packages at all.

Main-process dependencies are the Node setup from `nodejs.md` (`@everr/otel-errors @opentelemetry/instrumentation @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node` and the OTLP exporters). The proxy itself needs no extra package: it POSTs with Electron's `net` module.

## Runtime Configuration

Only the main process reads exporter configuration. The renderer runs `@everr/otel-web`, which builds each OTLP/JSON payload itself and calls the preload-exposed `proxyOtlp`. The main process forwards the encoded bytes to `{endpoint}/v1/{signal}` with the configured headers. The main process's own telemetry exports directly through its SDK.

```bash
# Local development
OTEL_EXPORTER_OTLP_ENDPOINT=<otlp-url-from-status>

# Production with Everr hosted ingest
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.everr.dev/
EVERR_INGEST_KEY=<secret-manager-reference>
```

## Main Process: Telemetry Context And Proxy

Create one telemetry context at startup, set up the main-process SDK + error capture (per `nodejs.md`), and register the IPC handlers. The `everr:proxy-otlp` handler is transport, not an application telemetry API: it validates the payload size, attaches the configured headers, and POSTs the bytes. It never deserializes or rebuilds telemetry.

```ts
// main/telemetry.ts
import { randomUUID } from 'node:crypto';
import { app, ipcMain, net } from 'electron';
import { ErrorsInstrumentation } from '@everr/otel-errors';
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
  // Its `instrumentations` array carries `new ErrorsInstrumentation()` for the
  // main process's own crash handlers.
  startMainSdk({ ...baseContext, processType: 'main' });

  const rendererContext: TelemetryContext = {
    ...baseContext,
    processType: 'renderer',
  };
  registerTelemetryIpc(resolveTelemetryConfig(process.env), rendererContext);
}

function registerTelemetryIpc(config: TelemetryConfig, context: TelemetryContext) {
  ipcMain.handle('everr:telemetry-context', () => context);

  ipcMain.handle(
    'everr:proxy-otlp',
    async (_event, signal: 'logs' | 'traces', body: string) => {
      if (!config) return; // telemetry disabled
      // String length counts UTF-16 code units, not bytes; measure the UTF-8
      // payload the proxy actually forwards.
      const bytes = Buffer.byteLength(body, 'utf8');
      if (bytes > MAX_OTLP_BODY_BYTES) {
        throw new Error(`otlp payload too large: ${bytes} bytes`);
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
    },
  );
}

function signalUrl(endpoint: string, signal: 'logs' | 'traces') {
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
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
  proxyOtlp: (signal: 'logs' | 'traces', body: string) =>
    ipcRenderer.invoke('everr:proxy-otlp', signal, body),
});
```

```ts
// renderer global type
declare global {
  interface Window {
    everrTelemetry: {
      getContext(): Promise<TelemetryContext>;
      proxyOtlp(signal: 'logs' | 'traces', body: string): Promise<void>;
    };
  }
}
```

## Renderer Telemetry

`@everr/otel-web` builds the OTLP/JSON payload and hands it to the preload bridge through `send`. There is no exporter, no provider, and no serializer in the renderer.

```ts
// renderer, imported once before the app renders
import { errors, WebSDK } from '@everr/otel-web';

export async function initRendererTelemetry() {
  const context = await window.everrTelemetry.getContext();

  return new WebSDK({
    serviceName: context.serviceName,
    serviceVersion: context.serviceVersion,
    serviceInstanceId: context.serviceInstanceId,
    deploymentEnvironment: context.deploymentEnvironment,
    // The host owns delivery: ingestKey, endpoint, and dev are unused, and
    // the SDK issues no request of its own. Only the main process reads
    // exporter configuration.
    send: (signal, body) => window.everrTelemetry.proxyOtlp(signal, body),
    instrumentations: [errors()],
  });
}
```

`process.type = renderer` is not settable through the WebSDK options. Distinguish the two sides with a renderer-specific `serviceName` instead, per `resources.md`, or stamp it per record with `setAttributes({ 'everr.process.type': 'renderer' })`.

The `errors()` instrumentation owns the `window` `error`/`unhandledrejection` handlers. Do not also register your own: that double-captures. `captureError(error, attributes)` covers manual capture, and React apps wrap their root with `ErrorBoundary` from `@everr/otel-web/react`.

Add `pageviews()`, `interactions()`, `performance()`, or `network()` when the renderer is a real UI and those signals are wanted; each is opt-in.

## Validation

A main-process change (proxy handler, headers, endpoint) needs an app restart. Trigger each error mechanism (add a dev-only menu item or button that throws an uncaught error, rejects a promise, and calls `captureError`), then query.

Renderer records carry the mark you chose above: `everr.process.type = renderer`, or a renderer-specific `ServiceName`. Recent logs from both sides:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body,
       LogAttributes['everr.process.type'] AS process_type,
       LogAttributes['exception.mechanism'] AS mechanism,
       TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName IN ('<main-service-name>', '<renderer-service-name>')
ORDER BY Timestamp DESC
LIMIT 50
```

## Troubleshooting

- No renderer logs: verify `initRendererTelemetry()` runs before capture, the preload exposes `everrTelemetry`, and the `everr:proxy-otlp` handler is registered. A WebSDK with neither `send` nor a key is inert by design, so a dropped `send` looks identical to disabled telemetry.
- Proxy failures: verify the renderer's `send` passes the payload through as `body`, and that `everr:proxy-otlp` POSTs to `{endpoint}/v1/{signal}` with `content-type: application/json` (confirm the collector accepts OTLP/JSON). A throwing `send` is swallowed by design, so failures surface in the main process, not the renderer.
- Each error captured twice: the library's handlers are running alongside leftover hand-rolled `window`/`process` error handlers. Remove the hand-rolled ones.
- `everrTelemetry` is undefined in the renderer: the preload script is not wired to the `BrowserWindow` (`webPreferences.preload`), or `contextIsolation` is off.

## Safety Rules

- Keep `contextIsolation: true` and `nodeIntegration: false`. Expose only the narrow telemetry API through `contextBridge`; never expose `ipcRenderer` or the ingest key to the renderer.
- Never log auth tokens, request headers, request bodies, local file contents, user text, tenant ids, or machine identifiers.
