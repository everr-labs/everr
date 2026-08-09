import { randomUUID } from "node:crypto";
import { captureError, ErrorsInstrumentation } from "@everr/otel-errors";
import { SpanKind, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resolveTelemetryConfig, signalUrl } from "./config";

const sensitiveQueryParams = [
  "AWSAccessKeyId",
  "Signature",
  "X-Goog-Signature",
  "api_key",
  "code",
  "email",
  "password",
  "session",
  "sig",
  "token",
];

type TelemetryState = {
  sdk: NodeSDK | null;
  shuttingDown: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __everrAppTelemetry: TelemetryState | undefined;
}

const globalTelemetry = globalThis as typeof globalThis & {
  __everrAppTelemetry?: TelemetryState;
};

if (!globalTelemetry.__everrAppTelemetry) {
  globalTelemetry.__everrAppTelemetry = startTelemetry();
}

export function getTelemetryTracer(name = "everr-app.server") {
  return trace.getTracer(name);
}

export { captureError, SpanKind };

function startTelemetry(): TelemetryState {
  const config = resolveTelemetryConfig(process.env, randomUUID());

  if (!config) {
    return { sdk: null, shuttingDown: false };
  }

  const headers = config.headers;
  const sdk = new NodeSDK({
    resource: resourceFromAttributes(config.resourceAttributes),
    traceExporter: new OTLPTraceExporter({
      headers,
      url: signalUrl(config.endpoint, "traces"),
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          headers,
          url: signalUrl(config.endpoint, "metrics"),
        }),
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          headers,
          url: signalUrl(config.endpoint, "logs"),
        }),
      ),
    ],
    instrumentations: [
      // Crash handlers: uncaughtException/unhandledRejection captured as
      // exception log records, flushed with the traces and metrics, then
      // the process exits 1.
      new ErrorsInstrumentation(),
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-http": {
          disableIncomingRequestInstrumentation: true,
          redactedQueryParams: sensitiveQueryParams,
        },
      }),
    ],
  });

  sdk.start();

  const state = { sdk, shuttingDown: false };
  installShutdownHandlers(state);

  return state;
}

function installShutdownHandlers(state: TelemetryState) {
  const shutdownAndExit = (exitCode: number) => {
    void shutdownTelemetry(state).finally(() => process.exit(exitCode));
  };

  process.once("SIGTERM", () => shutdownAndExit(0));
  process.once("SIGINT", () => shutdownAndExit(0));
}

async function shutdownTelemetry(state: TelemetryState) {
  if (!state.sdk || state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  await state.sdk.shutdown();
}
