import {
  type LogAttributes,
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import {
  buildOtlpSignalUrl,
  getExceptionAttributes,
  normalizeOtlpOrigin,
} from "./telemetry/shared.ts";

const DEFAULT_COLLECTOR_ENDPOINT = "http://127.0.0.1:54318";
const instrumentationStateKey = Symbol.for("everr.web.node.otel.state");
type NodeInstrumentationState = ReturnType<typeof startNodeInstrumentation>;

const instrumentationGlobal = globalThis as typeof globalThis & {
  [instrumentationStateKey]?: NodeInstrumentationState;
};

if (!instrumentationGlobal[instrumentationStateKey]) {
  instrumentationGlobal[instrumentationStateKey] = startNodeInstrumentation();
}

function startNodeInstrumentation() {
  const collectorEndpoint = normalizeOtlpOrigin(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      process.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ||
      DEFAULT_COLLECTOR_ENDPOINT,
  );

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME || "everr-web-node",
      "service.version": process.env.npm_package_version || "0.1.0",
      "deployment.environment": "development",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: buildOtlpSignalUrl(collectorEndpoint, "traces"),
        }),
      ),
    ],
    logRecordProcessors: [
      new SimpleLogRecordProcessor(
        new OTLPLogExporter({
          url: buildOtlpSignalUrl(collectorEndpoint, "logs"),
        }),
      ),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();

  const errorLogger = logs.getLogger("everr-web-node-errors");
  let fatalErrorInProgress = false;

  process.once("unhandledRejection", handleUnhandledRejection);
  process.once("uncaughtException", handleUncaughtException);

  function handleUnhandledRejection(reason: unknown) {
    emitNodeError(reason, "process.unhandledRejection");
    crashAfterFlush(reason);
  }

  function handleUncaughtException(
    error: Error,
    origin: NodeJS.UncaughtExceptionOrigin,
  ) {
    emitNodeError(error, "process.uncaughtException", {
      "exception.origin": origin,
    });

    crashAfterFlush(error);
  }

  function crashAfterFlush(reason: unknown) {
    if (fatalErrorInProgress) {
      return;
    }

    fatalErrorInProgress = true;
    const error =
      reason instanceof Error
        ? reason
        : new Error(`Unhandled rejection: ${String(reason)}`);

    void sdk.shutdown().finally(() => {
      process.off("uncaughtException", handleUncaughtException);
      process.off("unhandledRejection", handleUnhandledRejection);
      setImmediate(() => {
        throw error;
      });
    });
  }

  function emitNodeError(
    reason: unknown,
    source: string,
    extraAttributes: LogAttributes = {},
  ) {
    const attributes = getExceptionAttributes(reason);

    errorLogger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: attributes["exception.message"] || "Unhandled Node.js error",
      attributes: {
        ...attributes,
        ...extraAttributes,
        "error.source": source,
        "exception.escaped": true,
      },
    });
  }

  return { sdk };
}
