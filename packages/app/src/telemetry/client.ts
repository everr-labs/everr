import { init as initErrorTracking } from "@everr/auto-otel-errors/browser";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { resolveTelemetryConfig, signalUrl } from "./config";

// Browser error tracking for the web app (dogfooding): captured errors become
// OTel log records that ship to Everr over OTLP/HTTP. This mirrors the app's
// server telemetry (`node.ts`) but for the browser, and reuses the same
// endpoint/key resolution in `config.ts`.
//
// `@everr/auto-otel-errors` is transport-less: its `init()` is a no-op unless a
// global `LoggerProvider` is registered first, which is exactly what this
// module does before calling it.

const BATCH_OPTIONS = {
  maxQueueSize: 100,
  maxExportBatchSize: 32,
  scheduledDelayMillis: 5_000,
  exportTimeoutMillis: 30_000,
};

function initClientErrorTracking(): void {
  // Runs once at client bundle load (this is a side-effect module). No-op on
  // the server.
  if (typeof window === "undefined") return;

  const ingestKey = import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY?.trim();
  const endpointOverride = import.meta.env.VITE_EVERR_INGEST_ENDPOINT?.trim();

  // In production, only send when a public key (or explicit endpoint) is
  // configured, so a keyless deploy never POSTs to a collector that isn't
  // there. In dev, fall back to the local collector so developers see their
  // own browser errors with no setup.
  if (!ingestKey && !endpointOverride && !import.meta.env.DEV) return;

  const config = resolveTelemetryConfig(
    {
      EVERR_INGEST_KEY: ingestKey,
      OTEL_EXPORTER_OTLP_ENDPOINT: endpointOverride,
      DEPLOYMENT_ENVIRONMENT: import.meta.env.MODE,
    },
    crypto.randomUUID(),
  );
  if (!config) return;

  const loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes(config.resourceAttributes),
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: signalUrl(config.endpoint, "logs"),
          headers: config.headers,
        }),
        BATCH_OPTIONS,
      ),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  // Installs window `error` / `unhandledrejection` handlers and wires manual
  // `captureError` / the React `ErrorBoundary`. Each capture emits one log
  // record through the provider above.
  initErrorTracking();

  // Best-effort flush of anything still batched when the page goes away.
  window.addEventListener("beforeunload", () => {
    void loggerProvider.shutdown();
  });
}

initClientErrorTracking();
