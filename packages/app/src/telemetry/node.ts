import { randomUUID } from "node:crypto";
import { captureError, ErrorsInstrumentation } from "@everr/otel-errors";
import {
  type Profiler,
  ProfilingContextManager,
  ProfilingSpanProcessor,
  startProfiler,
} from "@everr/otel-profiler";
import { SpanKind, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { registerShutdownHook } from "#app/server/shutdown.ts";
import { profilingEnabled, resolveTelemetryConfig, signalUrl } from "./config";
import { identityLogProcessor, identitySpanProcessor } from "./identity";

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
  profiler?: Promise<Profiler | null>;
  shuttingDown: boolean;
};

declare global {
  var __everrAppTelemetry: TelemetryState | undefined;
}

const globalTelemetry: typeof globalThis & {
  __everrAppTelemetry?: TelemetryState;
} = globalThis;

if (!globalTelemetry.__everrAppTelemetry) {
  globalTelemetry.__everrAppTelemetry =
    process.env.TSS_PRERENDERING === "true" ? { sdk: null, shuttingDown: false } : startTelemetry();
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
  const profiling = profilingEnabled(process.env);
  const sdk = new NodeSDK({
    ...(profiling ? { contextManager: new ProfilingContextManager() } : {}),
    resource: resourceFromAttributes(config.resourceAttributes),
    spanProcessors: [
      ...(profiling ? [new ProfilingSpanProcessor()] : []),
      identitySpanProcessor,
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          headers,
          url: signalUrl(config.endpoint, "traces"),
        }),
      ),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          headers,
          url: signalUrl(config.endpoint, "metrics"),
        }),
      }),
    ],
    logRecordProcessors: [
      identityLogProcessor,
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          headers,
          url: signalUrl(config.endpoint, "logs"),
        }),
      ),
    ],
    instrumentations: [
      // The crash handlers. They capture an uncaughtException event and an
      // unhandledRejection event as exception log records. Then they send those
      // records with the traces and the metrics. Then the process stops with the
      // code 1.
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

  const state: TelemetryState = {
    sdk,
    shuttingDown: false,
    profiler: profiling
      ? startProfiler({
          endpoint: config.endpoint,
          headers,
          resourceAttributes: config.resourceAttributes,
          // Vite evaluates modules from memory in development; there are no maps on disk.
          ...(process.env.NODE_ENV === "development" ? { sourceMapDirs: [] } : {}),
        }).catch((error: unknown) => {
          console.warn("[telemetry] profiler failed to start", error);
          return null;
        })
      : undefined,
  };
  registerShutdownHook("telemetry", "telemetry", () => shutdownTelemetry(state));

  return state;
}

async function shutdownTelemetry(state: TelemetryState) {
  if (!state.sdk || state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  await Promise.all([
    state.sdk.shutdown(),
    state.profiler?.then((profiler) => profiler?.shutdown()),
  ]);
}
