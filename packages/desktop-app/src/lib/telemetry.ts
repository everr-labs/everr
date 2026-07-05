import { init as initErrorTracking } from "@everr/auto-otel-errors/browser";
import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { invoke } from "@tauri-apps/api/core";

import { OtlpProxyLogExporter, OtlpProxySpanExporter } from "./otlp-proxy-exporter";

type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
};

const BATCH_OPTIONS = {
  maxQueueSize: 100,
  maxExportBatchSize: 32,
  scheduledDelayMillis: 5_000,
  exportTimeoutMillis: 30_000,
};

let loggerProvider: LoggerProvider | null = null;
let tracerProvider: BasicTracerProvider | null = null;

async function initBrowserTelemetry() {
  const telemetryContext = await invoke<TelemetryContext>("get_telemetry_context");

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: telemetryContext.serviceName,
    "service.version": telemetryContext.serviceVersion,
    "service.instance.id": telemetryContext.serviceInstanceId,
    "deployment.environment.name": telemetryContext.deploymentEnvironment,
  });

  loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(new OtlpProxyLogExporter(), BATCH_OPTIONS)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  // The library builds an "error.context" span (breadcrumb trail) for each
  // capture; this provider forwards it through the OTLP proxy so errors get a
  // correlated trace alongside their log. It must be set before initErrorTracking.
  tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OtlpProxySpanExporter(), BATCH_OPTIONS)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  // The library owns browser error capture: window error/unhandledrejection
  // handlers and manual captureError. Captures emit OTel logs that the proxy
  // exporters forward to Rust as encoded OTLP/JSON.
  initErrorTracking();
}

void initBrowserTelemetry();

window.addEventListener("beforeunload", () => {
  void loggerProvider?.shutdown();
  void tracerProvider?.shutdown();
});
