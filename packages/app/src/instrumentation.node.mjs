import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";

const DEFAULT_COLLECTOR_ENDPOINT = "http://127.0.0.1:54318";
const instrumentationStateKey = Symbol.for("everr.web.node.otel.state");

if (!globalThis[instrumentationStateKey]) {
  globalThis[instrumentationStateKey] = startNodeInstrumentation();
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

  function handleUnhandledRejection(reason) {
    emitNodeError(reason, "process.unhandledRejection");
    crashAfterFlush(reason);
  }

  function handleUncaughtException(error, origin) {
    emitNodeError(error, "process.uncaughtException", {
      "exception.origin": origin,
    });

    crashAfterFlush(error);
  }

  function crashAfterFlush(reason) {
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

  function emitNodeError(reason, source, extraAttributes = {}) {
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

function normalizeOtlpOrigin(origin) {
  return origin.replace(/\/+$/, "");
}

function buildOtlpSignalUrl(origin, signal) {
  return `${normalizeOtlpOrigin(origin)}/v1/${signal}`;
}

function getExceptionAttributes(reason) {
  if (reason instanceof Error) {
    return removeUndefinedAttributes({
      "exception.type": reason.name || "Error",
      "exception.message": redactSensitiveText(reason.message),
      "exception.stacktrace": reason.stack
        ? redactSensitiveText(reason.stack)
        : undefined,
    });
  }

  return {
    "exception.type": "NonErrorException",
    "exception.message": redactSensitiveText(stringifyReason(reason)),
  };
}

function redactSensitiveText(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /\b(token|password|passwd|secret|api[_-]?key|authorization)=\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]");
}

function stringifyReason(reason) {
  if (typeof reason === "string") {
    return reason;
  }

  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function removeUndefinedAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  );
}
