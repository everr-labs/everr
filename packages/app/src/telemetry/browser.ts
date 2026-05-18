import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BatchSpanProcessor,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { getExceptionAttributes, redactSensitiveText } from "./errors";
import { buildOtlpSignalUrl, normalizeOtlpOrigin } from "./otlp";

type BrowserTelemetryConfig = {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
};

declare const __EVERR_BROWSER_OTEL__: BrowserTelemetryConfig;

const config = __EVERR_BROWSER_OTEL__;

if (config.enabled && typeof window !== "undefined") {
  const collectorOrigin = normalizeOtlpOrigin(config.endpoint);
  const ignoredCollectorUrl = new RegExp(`^${escapeRegExp(collectorOrigin)}`);
  const resource = resourceFromAttributes({
    "service.name": config.serviceName,
    "deployment.environment": "development",
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new SimpleLogRecordProcessor(
        new OTLPLogExporter({
          url: buildOtlpSignalUrl(collectorOrigin, "logs"),
        }),
      ),
    ],
  });

  logs.setGlobalLoggerProvider(loggerProvider);
  const errorLogger = logs.getLogger("everr-web-browser-errors");

  function emitErrorLog(logRecord: Parameters<typeof errorLogger.emit>[0]) {
    errorLogger.emit(logRecord);
    void loggerProvider.forceFlush().catch(() => {});
  }

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: buildOtlpSignalUrl(collectorOrigin, "traces"),
        }),
      ),
    ],
  });

  provider.register();

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        clearTimingResources: true,
        ignoreUrls: [ignoredCollectorUrl],
      }),
      new XMLHttpRequestInstrumentation({
        clearTimingResources: true,
        ignoreUrls: [ignoredCollectorUrl],
      }),
    ],
  });

  window.addEventListener("error", (event) => {
    emitErrorLog({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: redactSensitiveText(event.message || "Uncaught browser error"),
      attributes: {
        ...getExceptionAttributes(event.error || event.message),
        "error.source": "window.error",
        "exception.escaped": true,
        "url.full": window.location.href,
        "url.path": window.location.pathname,
        "code.filepath": event.filename,
        "code.lineno": event.lineno,
        "code.column": event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const attributes = getExceptionAttributes(event.reason);
    emitErrorLog({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body:
        typeof attributes["exception.message"] === "string"
          ? attributes["exception.message"]
          : "Unhandled browser promise rejection",
      attributes: {
        ...attributes,
        "error.source": "window.unhandledrejection",
        "exception.escaped": true,
        "url.full": window.location.href,
        "url.path": window.location.pathname,
      },
    });
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
