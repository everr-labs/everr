import { randomUUID } from "node:crypto";
import {
  type Attributes,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resolveTelemetryConfig, signalUrl } from "./config";

const errorLogger = logs.getLogger("everr-app.errors");

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

export function recordTelemetryError(
  reason: unknown,
  attributes: Attributes = {},
) {
  const error = normalizeError(reason);
  const activeSpan = trace.getActiveSpan();

  activeSpan?.recordException(error);
  activeSpan?.setStatus({
    code: SpanStatusCode.ERROR,
    message: `${error.name}: ${error.message}`,
  });

  errorLogger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: "server.error",
    attributes: {
      ...attributes,
      "exception.message": error.message,
      "exception.type": error.name,
      ...(error.stack ? { "exception.stacktrace": error.stack } : {}),
    },
  });

  return error;
}

export function getTelemetryTracer(name = "everr-app.server") {
  return trace.getTracer(name);
}

export { SpanKind };

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
  installFatalErrorHandlers(state);

  return state;
}

function installShutdownHandlers(state: TelemetryState) {
  const shutdownAndExit = (exitCode: number) => {
    void shutdownTelemetry(state).finally(() => process.exit(exitCode));
  };

  process.once("SIGTERM", () => shutdownAndExit(0));
  process.once("SIGINT", () => shutdownAndExit(0));
}

function installFatalErrorHandlers(state: TelemetryState) {
  const handleFatalError = (reason: unknown, source: string) => {
    const error = recordTelemetryError(reason, {
      "error.handled": false,
      "error.source": source,
      "exception.escaped": true,
    });

    void shutdownTelemetry(state).finally(() => {
      process.off("uncaughtException", handleUncaughtException);
      process.off("unhandledRejection", handleUnhandledRejection);
      setImmediate(() => {
        throw error;
      });
    });
  };

  const handleUncaughtException = (error: Error) => {
    handleFatalError(error, "process.uncaughtException");
  };

  const handleUnhandledRejection = (reason: unknown) => {
    handleFatalError(reason, "process.unhandledRejection");
  };

  process.once("uncaughtException", handleUncaughtException);
  process.once("unhandledRejection", handleUnhandledRejection);
}

async function shutdownTelemetry(state: TelemetryState) {
  if (!state.sdk || state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  await state.sdk.shutdown();
}

function normalizeError(reason: unknown) {
  if (reason instanceof Error) {
    return reason;
  }

  return new Error(`Unhandled rejection: ${String(reason)}`);
}
